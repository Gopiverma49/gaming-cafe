import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, verify_customer_token
from app.core.config import settings
from app.core.security import create_customer_token
from app.models.entities import Session, MenuItem, Order, OrderItem
from app.models.enums import OrderStatus, SessionStatus
from app.schemas.api_schemas import (
    CustomerDeskSession,
    MenuItemResponse,
    OrderCreateRequest,
    OrderResponse,
    OrderItemResponse,
    TokenResponse,
    CustomerTokenRequest,
)
from app.services.billing_engine import calculate_station_charge
from app.services.order_service import serialize_order, ensure_utc, CURRENCY_QUANTIZATION
from app.services.ws_notifier import buffer_ws_event

router = APIRouter(prefix="/customer", tags=["Customer Operations"])


@router.post("/auth/token", response_model=TokenResponse)
async def get_desk_token(
    payload: CustomerTokenRequest,
):
    """
    Simulates desk-side QR code scan or auto-login, generating an ephemeral, desk-scoped JWT.
    """
    token = create_customer_token(str(payload.desk_id), str(payload.session_id))
    expires_in_seconds = settings.CUSTOMER_TOKEN_EXPIRE_MINUTES * 60
    return TokenResponse(access_token=token, scope="customer", expires_in=expires_in_seconds)


@router.get("/menu", response_model=List[MenuItemResponse])
async def get_menu_items(db: AsyncSession = Depends(get_db)):
    """
    Lists available menu items categorized for customer food and beverage ordering.
    """
    stmt = select(MenuItem).where(MenuItem.is_available == True).order_by(MenuItem.category, MenuItem.name)
    result = await db.execute(stmt)
    items = result.scalars().all()
    return items


@router.get("/desk/session", response_model=CustomerDeskSession)
async def get_desk_session(
    token_data: dict = Depends(verify_customer_token),
    db: AsyncSession = Depends(get_db),
):
    """
    Fetches active desk session, remaining duration, and running bill.
    Strictly desk-isolated: desk_id is derived exclusively from the verified token.
    """
    desk_id: uuid.UUID = token_data["desk_id"]

    stmt = (
        select(Session)
        .where(Session.station_id == desk_id, Session.status == SessionStatus.ACTIVE.value)
        .options(
            selectinload(Session.station),
            selectinload(Session.orders).selectinload(Order.items).selectinload(OrderItem.menu_item),
        )
    )
    result = await db.execute(stmt)
    cafe_session = result.scalar_one_or_none()

    if not cafe_session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active session found for this desk.",
        )

    now = datetime.now(timezone.utc)
    started_at = ensure_utc(cafe_session.started_at)
    elapsed_sec = (now - started_at).total_seconds()
    elapsed_min = max(0, int(elapsed_sec // 60))
    allocated_mins = cafe_session.allocated_minutes or settings.DEFAULT_SESSION_DURATION_MINUTES
    remaining_min = max(0, allocated_mins - elapsed_min)

    station = cafe_session.station
    if cafe_session.tier_price is not None:
        if elapsed_min > allocated_mins:
            overtime_min = elapsed_min - allocated_mins
            overtime_charge = (
                (Decimal(str(overtime_min)) / Decimal("60")) * station.hourly_rate
            ).quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP)
            time_charge = (cafe_session.tier_price + overtime_charge).quantize(
                CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP
            )
        else:
            time_charge = cafe_session.tier_price
    else:
        time_charge = calculate_station_charge(started_at, now, station.hourly_rate)

    orders_charge = Decimal("0.00")
    orders_out: List[OrderResponse] = []
    for order in cafe_session.orders:
        serialized = serialize_order(order)
        if order.status == OrderStatus.SERVED.value:
            orders_charge += serialized.total_amount
        orders_out.append(serialized)

    running_total = (time_charge + orders_charge).quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP)

    return CustomerDeskSession(
        session_id=cafe_session.id,
        station_id=station.id,
        station_name=station.name,
        tier=station.tier,
        hourly_rate=station.hourly_rate,
        started_at=cafe_session.started_at,
        elapsed_minutes=elapsed_min,
        allocated_minutes=allocated_mins,
        remaining_minutes=remaining_min,
        time_charge=time_charge,
        orders_charge=orders_charge,
        running_total=running_total,
        active_orders=orders_out,
    )


@router.post("/order", response_model=OrderResponse)
async def place_order(
    payload: OrderCreateRequest,
    token_data: dict = Depends(verify_customer_token),
    db: AsyncSession = Depends(get_db),
):
    """
    Places food and beverage items directly onto the active desk tab.
    Strictly desk-isolated: session is derived from verified token desk_id.
    """
    desk_id: uuid.UUID = token_data["desk_id"]

    # Verify active session for desk
    session_stmt = (
        select(Session)
        .where(Session.station_id == desk_id, Session.status == SessionStatus.ACTIVE.value)
        .options(selectinload(Session.station))
    )
    sess_res = await db.execute(session_stmt)
    cafe_session = sess_res.scalar_one_or_none()

    if not cafe_session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cannot place order: desk has no active session.",
        )

    # Validate items and price snapshot
    item_ids = [it.menu_item_id for it in payload.items]
    items_stmt = select(MenuItem).where(MenuItem.id.in_(item_ids), MenuItem.is_available == True)
    menu_map = {m.id: m for m in (await db.execute(items_stmt)).scalars().all()}

    for it in payload.items:
        if it.menu_item_id not in menu_map:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Menu item {it.menu_item_id} is unavailable or invalid",
            )

    new_order = Order(
        session_id=cafe_session.id,
        status=OrderStatus.QUEUED.value,
        created_at=datetime.now(timezone.utc),
    )
    db.add(new_order)
    await db.flush()  # Generates new_order.id

    order_total = Decimal("0.00")
    order_items_out: List[OrderItemResponse] = []
    order_items_to_add: List[OrderItem] = []

    for it in payload.items:
        menu_item = menu_map[it.menu_item_id]
        unit_price = menu_item.price
        subtotal = (unit_price * Decimal(str(it.quantity))).quantize(
            CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP
        )
        order_total += subtotal

        item_id = uuid.uuid4()
        db_order_item = OrderItem(
            id=item_id,
            order_id=new_order.id,
            menu_item_id=menu_item.id,
            quantity=it.quantity,
            unit_price=unit_price,
        )
        order_items_to_add.append(db_order_item)

        order_items_out.append(
            OrderItemResponse(
                id=item_id,
                menu_item_id=menu_item.id,
                menu_item_name=menu_item.name,
                quantity=it.quantity,
                unit_price=unit_price,
                subtotal=subtotal,
            )
        )

    # Batch add all order items in a single flush instead of N flushes in a loop
    db.add_all(order_items_to_add)
    await db.flush()

    # Post-commit notification for Kitchen KDS and Customer
    buffer_ws_event(
        db,
        channel="admin",
        event_type="ORDER_CREATED",
        payload={
            "order_id": str(new_order.id),
            "session_id": str(cafe_session.id),
            "station_name": cafe_session.station.name,
            "status": OrderStatus.QUEUED.value,
            "items_count": len(payload.items),
            "total_amount": str(order_total),
        },
    )
    buffer_ws_event(
        db,
        channel=f"customer:{desk_id}",
        event_type="ORDER_CREATED",
        payload={
            "order_id": str(new_order.id),
            "status": OrderStatus.QUEUED.value,
            "total_amount": str(order_total),
        },
    )

    await db.commit()
    await db.refresh(new_order)

    return OrderResponse(
        id=new_order.id,
        session_id=new_order.session_id,
        station_name=cafe_session.station.name,
        status=new_order.status,
        created_at=new_order.created_at,
        items=order_items_out,
        total_amount=order_total,
    )


# ---------------------------------------------------------------------------
# Direct Database Real-time Customer Active Sessions / Bookings
# ---------------------------------------------------------------------------

@router.get("/sessions")
async def get_customer_sessions(
    phone: Optional[str] = None,
    name: Optional[str] = None,
    user_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Fetches real active and recent sessions for customer booking cards directly from database.
    Zero localStorage reliance.
    """
    stmt = (
        select(Session)
        .options(
            selectinload(Session.station),
            selectinload(Session.orders).selectinload(Order.items),
        )
        .order_by(Session.started_at.desc())
    )
    conditions = []
    if phone:
        conditions.append(Session.customer_phone == phone)
    if name:
        conditions.append(Session.customer_name == name)
    if user_id:
        try:
            u_uuid = uuid.UUID(user_id)
            conditions.append(Session.user_id == u_uuid)
        except ValueError:
            pass

    if conditions:
        stmt = stmt.where(or_(*conditions))

    result = await db.execute(stmt)
    sessions = result.scalars().all()

    out = []
    now = datetime.now(timezone.utc)
    for s in sessions:
        started_at = ensure_utc(s.started_at)
        elapsed_min = max(0, int((now - started_at).total_seconds() // 60))
        station_name = s.station.name if s.station else "Station"
        hourly_rate = float(s.station.hourly_rate) if s.station else 180.0

        if s.status == SessionStatus.ACTIVE.value and s.station:
            if s.tier_price is not None:
                alloc = s.allocated_minutes or 60
                if elapsed_min > alloc:
                    extra = elapsed_min - alloc
                    overtime = (Decimal(str(extra)) / Decimal("60")) * s.station.hourly_rate
                    time_charge = float(s.tier_price + overtime)
                else:
                    time_charge = float(s.tier_price)
            else:
                time_charge = float(calculate_station_charge(started_at, now, s.station.hourly_rate))
        else:
            time_charge = float(s.total_amount or 0)

        orders_charge = sum(
            float(itm.unit_price * Decimal(str(itm.quantity)))
            for o in s.orders if o.status != OrderStatus.CANCELLED.value
            for itm in o.items
        )
        total_cost = time_charge + orders_charge

        out.append({
            "id": str(s.id),
            "stationId": str(s.station_id),
            "stationName": station_name,
            "customerName": s.customer_name or "Gamer",
            "customerPhone": s.customer_phone,
            "status": s.status,
            "startedAt": started_at.isoformat(),
            "elapsedMinutes": elapsed_min,
            "durationMinutes": max(60, ((elapsed_min // 60) + 1) * 60) if s.status == SessionStatus.ACTIVE.value else max(30, elapsed_min),
            "hourlyRate": hourly_rate,
            "timeCharge": time_charge,
            "ordersCharge": orders_charge,
            "totalCost": total_cost,
        })
    return out


@router.post("/sessions/{session_id}/cancel")
async def cancel_customer_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Cancels an active session and frees the station in database.
    """
    stmt = (
        select(Session)
        .where(Session.id == session_id)
        .options(selectinload(Session.station))
        .with_for_update()
    )
    res = await db.execute(stmt)
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    if session.status != SessionStatus.ACTIVE.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session is not active")

    session.status = SessionStatus.CANCELLED.value
    session.ended_at = datetime.now(timezone.utc)
    if session.station:
        session.station.status = "AVAILABLE"

    buffer_ws_event(
        db,
        channel="admin",
        event_type="SESSION_CANCELLED",
        payload={"session_id": str(session.id), "station_id": str(session.station_id)},
    )
    buffer_ws_event(
        db,
        channel="customer",
        event_type="SESSION_CANCELLED",
        payload={"session_id": str(session.id), "station_id": str(session.station_id)},
    )

    await db.commit()
    return {"message": "Session cancelled successfully", "session_id": str(session.id)}

