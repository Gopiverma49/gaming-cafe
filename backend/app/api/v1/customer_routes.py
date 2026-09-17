import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, verify_customer_token
from app.core.security import create_customer_token
from app.models.entities import Station, Session, MenuItem, Order, OrderItem
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
from app.services.ws_notifier import buffer_ws_event

router = APIRouter(prefix="/customer", tags=["Customer Operations"])


@router.post("/auth/token", response_model=TokenResponse)
async def get_desk_token(
    payload: CustomerTokenRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Simulates desk-side QR code scan or auto-login, generating an ephemeral, desk-scoped JWT.
    """
    token = create_customer_token(str(payload.desk_id), str(payload.session_id))
    return TokenResponse(access_token=token, scope="customer", expires_in=60 * 6 * 60)


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
        .where(Session.station_id == desk_id, Session.status == "ACTIVE")
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
    elapsed_sec = (now - cafe_session.started_at).total_seconds()
    elapsed_min = max(0, int(elapsed_sec // 60))
    allocated_mins = 60
    remaining_min = max(0, allocated_mins - elapsed_min)

    station = cafe_session.station
    time_charge = calculate_station_charge(cafe_session.started_at, now, station.hourly_rate)

    orders_charge = Decimal("0.00")
    orders_out: List[OrderResponse] = []
    for order in cafe_session.orders:
        order_total = Decimal("0.00")
        items_out: List[OrderItemResponse] = []
        for item in order.items:
            subtotal = (item.unit_price * Decimal(str(item.quantity))).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            order_total += subtotal
            items_out.append(
                OrderItemResponse(
                    id=item.id,
                    menu_item_id=item.menu_item_id,
                    menu_item_name=item.menu_item.name if item.menu_item else "Item",
                    quantity=item.quantity,
                    unit_price=item.unit_price,
                    subtotal=subtotal,
                )
            )

        if order.status == "SERVED":
            orders_charge += order_total

        orders_out.append(
            OrderResponse(
                id=order.id,
                session_id=order.session_id,
                station_name=station.name,
                status=order.status,
                created_at=order.created_at,
                items=items_out,
                total_amount=order_total,
            )
        )

    running_total = (time_charge + orders_charge).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

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
        .where(Session.station_id == desk_id, Session.status == "ACTIVE")
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
        status="QUEUED",
        created_at=datetime.now(timezone.utc),
    )
    db.add(new_order)
    await db.flush()

    order_total = Decimal("0.00")
    order_items_out: List[OrderItemResponse] = []

    for it in payload.items:
        menu_item = menu_map[it.menu_item_id]
        unit_price = menu_item.price
        subtotal = (unit_price * Decimal(str(it.quantity))).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        order_total += subtotal

        db_order_item = OrderItem(
            order_id=new_order.id,
            menu_item_id=menu_item.id,
            quantity=it.quantity,
            unit_price=unit_price,
        )
        db.add(db_order_item)
        await db.flush()

        order_items_out.append(
            OrderItemResponse(
                id=db_order_item.id,
                menu_item_id=menu_item.id,
                menu_item_name=menu_item.name,
                quantity=it.quantity,
                unit_price=unit_price,
                subtotal=subtotal,
            )
        )

    # Post-commit notification for Kitchen KDS and Customer
    buffer_ws_event(
        db,
        channel="admin",
        event_type="ORDER_CREATED",
        payload={
            "order_id": str(new_order.id),
            "session_id": str(cafe_session.id),
            "station_name": cafe_session.station.name,
            "status": "QUEUED",
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
            "status": "QUEUED",
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
