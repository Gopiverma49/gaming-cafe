import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, verify_customer_token
from app.core.config import settings
from app.core.security import create_customer_token
from app.models.entities import Session, MenuItem, Order, OrderItem, Station, PhysicalDevice
from app.models.enums import OrderStatus, SessionStatus, StationStatus
from app.schemas.api_schemas import (
    CustomerDeskSession,
    MenuItemResponse,
    OrderCreateRequest,
    OrderResponse,
    OrderItemResponse,
    TokenResponse,
    CustomerTokenRequest,
    InSeatOrderPayload,
)
from app.services.order_service import serialize_order, ensure_utc, CURRENCY_QUANTIZATION
from app.services.session_service import start_category_session, _compute_time_charge
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
    time_charge = _compute_time_charge(
        tier_price=cafe_session.tier_price,
        elapsed_minutes=elapsed_min,
        allocated_minutes=allocated_mins,
        hourly_rate=station.hourly_rate,
        started_at=started_at,
        reference_time=now,
    )

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


@router.post("/in-seat-order", response_model=InSeatOrderPayload)
async def place_in_seat_order(
    payload: InSeatOrderPayload,
    db: AsyncSession = Depends(get_db),
):
    """
    Public in-seat food & drink order endpoint (QR scan / direct URL entry).
    Requires customer name and substation restricted strictly to PS1, PS2, or PS3.
    Automatically assigns order to the station's active session if present.
    """
    raw_mode = (getattr(payload, "mode", None) or "solo").strip().lower()
    if raw_mode in ("car", "car_sim", "car simulator", "carsimulator"):
        target_mode = "car_sim"
    elif raw_mode in ("multi", "multiplayer", "multi-player"):
        target_mode = "multiplayer"
    elif raw_mode in ("vr", "vr_sim", "vr simulator"):
        target_mode = "vr_sim"
    else:
        target_mode = raw_mode

    # Car simulator is strictly fixed to PS3
    if target_mode == "car_sim":
        st_name = "PS3"
    else:
        st_name = payload.stationId.strip().upper()

    if st_name not in ("PS1", "PS2", "PS3"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Substation must be strictly restricted to PS1, PS2, or PS3.",
        )

    # 1. Match active session on this device/substation (e.g. PS1, PS2, PS3)
    sess_stmt = (
        select(Session)
        .where(
            Session.status == SessionStatus.ACTIVE.value,
            or_(
                func.upper(Session.device_name) == st_name,
                func.upper(Session.console_room) == st_name,
            ),
        )
        .options(selectinload(Session.station))
    )
    cafe_session = (await db.execute(sess_stmt)).scalars().first()

    # 2. If no active session exists on this station, create one cleanly using start_category_session
    # so that the session gets the exact defined rates/tiers for the chosen mode (Solo: 180, Multiplayer: 220, Car: 250)
    # and gets dynamically allocated to the chosen matrix cell (Mode row + Station column).
    if not cafe_session:
        cafe_session = await start_category_session(
            db=db,
            category_id=target_mode,
            device_id=st_name,
            duration_minutes=60,
            customer_name=payload.customerName,
        )

    # 4. Attach new Order to the active session
    new_order = Order(
        session_id=cafe_session.id if cafe_session else None,
        customer_name=payload.customerName,
        status=OrderStatus.QUEUED.value,
        created_at=datetime.now(timezone.utc),
    )
    db.add(new_order)
    await db.flush()

    # 5. Process order items: batch fetch menu items to eliminate N+1 queries
    uuids_to_lookup = []
    names_to_lookup = []
    for itm in payload.items:
        try:
            uuids_to_lookup.append(uuid.UUID(str(itm.id)))
        except (ValueError, TypeError):
            pass
        names_to_lookup.append(itm.name.strip().lower())

    lookup_conditions = []
    if uuids_to_lookup:
        lookup_conditions.append(MenuItem.id.in_(uuids_to_lookup))
    if names_to_lookup:
        lookup_conditions.append(func.lower(MenuItem.name).in_(names_to_lookup))

    existing_items: List[MenuItem] = []
    if lookup_conditions:
        batch_stmt = select(MenuItem).where(or_(*lookup_conditions))
        existing_items = (await db.execute(batch_stmt)).scalars().all()

    menu_by_id = {m.id: m for m in existing_items}
    menu_by_name = {m.name.strip().lower(): m for m in existing_items}

    order_items_to_add: List[OrderItem] = []
    for itm in payload.items:
        menu_res = None
        try:
            itm_uuid = uuid.UUID(str(itm.id))
            menu_res = menu_by_id.get(itm_uuid)
        except (ValueError, TypeError):
            pass

        if not menu_res:
            menu_res = menu_by_name.get(itm.name.strip().lower())

        # If not present in database, create record to maintain strict foreign key integrity
        if not menu_res:
            menu_res = MenuItem(
                name=itm.name.strip(),
                category="Food",
                price=Decimal(str(itm.price)),
                stock=0,
                is_available=True,
            )
            db.add(menu_res)
            await db.flush()
            menu_by_id[menu_res.id] = menu_res
            menu_by_name[menu_res.name.strip().lower()] = menu_res

        db_order_item = OrderItem(
            id=uuid.uuid4(),
            order_id=new_order.id,
            menu_item_id=menu_res.id,
            quantity=itm.qty,
            unit_price=Decimal(str(itm.price)),
        )
        order_items_to_add.append(db_order_item)

        # Deduct inventory only if present in inventory list with positive stock
        if menu_res.stock is not None and menu_res.stock > 0:
            menu_res.stock = max(0, menu_res.stock - itm.qty)

    db.add_all(order_items_to_add)

    # Update customer name on session if anonymous
    if cafe_session and (not cafe_session.customer_name or cafe_session.customer_name in ("Gamer", "Walk-in Gamer")):
        cafe_session.customer_name = payload.customerName

    # 6. Broadcast real-time WebSocket events to admin channels
    # Informs Kitchen Kanban and Orders Dispatcher
    buffer_ws_event(
        db,
        channel="admin",
        event_type="ORDER_CREATED",
        payload={
            "order_id": str(new_order.id),
            "station_name": st_name,
            "customer_name": payload.customerName,
        },
    )
    # Informs Console Matrix station column badge & audio chime
    buffer_ws_event(
        db,
        channel="admin",
        event_type="CUSTOMER_IN_SEAT_ORDER",
        payload={
            "orderId": payload.orderId,
            "stationId": st_name,
            "customerName": payload.customerName,
            "items": [it.model_dump() for it in payload.items],
            "totalAmount": float(payload.totalAmount),
            "status": payload.status,
            "createdAt": payload.createdAt or datetime.now(timezone.utc).isoformat(),
        },
    )

    await db.commit()
    payload.stationId = st_name
    payload.mode = target_mode
    return payload


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
        hourly_rate = float(s.station.hourly_rate) if s.station else settings.DEFAULT_HOURLY_RATE

        if s.status == SessionStatus.ACTIVE.value and s.station:
            started_s = ensure_utc(s.started_at)
            time_charge = float(_compute_time_charge(
                tier_price=s.tier_price,
                elapsed_minutes=elapsed_min,
                allocated_minutes=s.allocated_minutes or 60,
                hourly_rate=s.station.hourly_rate,
                started_at=started_s,
                reference_time=now,
            ))
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

    # Free physical device in devices registry
    if session.device_name:
        pdev = await db.get(PhysicalDevice, session.device_name)
        if pdev and pdev.current_session_id == session.id:
            pdev.status = StationStatus.AVAILABLE.value
            pdev.current_session_id = None

    if session.station:
        # Check if station has any other active sessions before marking AVAILABLE
        other_active = await db.execute(
            select(Session).where(
                Session.station_id == session.station.id,
                Session.status == SessionStatus.ACTIVE.value,
                Session.id != session.id,
            )
        )
        if not other_active.scalars().first():
            session.station.status = StationStatus.AVAILABLE.value

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

