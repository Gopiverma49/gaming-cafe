import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db
from app.core.config import settings
from app.core.security import create_admin_token
from app.models.entities import Station, Session, Order, OrderItem
from app.models.enums import StationStatus, SessionStatus, OrderStatus
from app.schemas.api_schemas import (
    StationLiveResponse,
    CheckInRequest,
    TransferRequest,
    CheckoutRequest,
    CheckoutResponse,
    OrderStatusUpdateRequest,
    OrderResponse,
    OrderItemResponse,
    TokenResponse,
    LoginRequest,
)
from app.services.billing_engine import calculate_station_charge
from app.services.order_service import serialize_order, ensure_utc, CURRENCY_QUANTIZATION
from app.services.session_service import check_in, transfer_station, settle_checkout
from app.services.ws_notifier import buffer_ws_event

router = APIRouter(prefix="/admin", tags=["Admin Operations"])


@router.post("/auth/login", response_model=TokenResponse)
async def admin_login(creds: LoginRequest):
    """
    Admin authentication route generating an admin-scoped Bearer token.
    """
    if creds.username != settings.ADMIN_USERNAME or creds.password != settings.ADMIN_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin credentials",
        )
    token = create_admin_token(username=creds.username)
    expires_in_seconds = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    return TokenResponse(access_token=token, scope="admin", expires_in=expires_in_seconds)


@router.get("/stations/live", response_model=List[StationLiveResponse])
async def get_live_stations(
    db: AsyncSession = Depends(get_db),
):
    """
    Live matrix showing station statuses, remaining times, and running totals.
    """
    stmt = (
        select(Station)
        .options(
            selectinload(Station.sessions).selectinload(Session.orders).selectinload(Order.items)
        )
        .order_by(Station.name)
    )
    result = await db.execute(stmt)
    stations = result.scalars().all()

    now = datetime.now(timezone.utc)
    live_data: List[StationLiveResponse] = []

    for station in stations:
        # Find active session
        active_session: Optional[Session] = None
        for s in station.sessions:
            if s.status == SessionStatus.ACTIVE.value:
                active_session = s
                break

        if not active_session:
            live_data.append(
                StationLiveResponse(
                    id=station.id,
                    name=station.name,
                    tier=station.tier,
                    hourly_rate=station.hourly_rate,
                    status=station.status,
                    active_session_id=None,
                    started_at=None,
                    elapsed_minutes=0,
                    remaining_minutes=None,
                    time_charge=Decimal("0.00"),
                    orders_charge=Decimal("0.00"),
                    running_total=Decimal("0.00"),
                    active_orders_count=0,
                )
            )
        else:
            started_at = ensure_utc(active_session.started_at)
            elapsed_sec = (now - started_at).total_seconds()
            elapsed_min = max(0, int(elapsed_sec // 60))
            time_charge = calculate_station_charge(
                started_at, now, station.hourly_rate
            )

            orders_charge = Decimal("0.00")
            active_orders_count = 0
            for o in active_session.orders:
                if o.status in (OrderStatus.QUEUED.value, OrderStatus.PREPARING.value):
                    active_orders_count += 1
                if o.status == OrderStatus.SERVED.value:
                    for item in o.items:
                        orders_charge += (item.unit_price * Decimal(str(item.quantity))).quantize(
                            CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP
                        )

            allocated_mins = settings.DEFAULT_SESSION_DURATION_MINUTES
            remaining_min = max(0, allocated_mins - elapsed_min)

            running_total = (time_charge + orders_charge).quantize(
                CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP
            )

            live_data.append(
                StationLiveResponse(
                    id=station.id,
                    name=station.name,
                    tier=station.tier,
                    hourly_rate=station.hourly_rate,
                    status=station.status,
                    active_session_id=active_session.id,
                    started_at=active_session.started_at,
                    elapsed_minutes=elapsed_min,
                    remaining_minutes=remaining_min,
                    time_charge=time_charge,
                    orders_charge=orders_charge,
                    running_total=running_total,
                    active_orders_count=active_orders_count,
                )
            )

    return live_data


@router.post("/sessions/check-in")
async def admin_check_in(
    payload: CheckInRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Station check-in handler. Acquires exclusive FOR UPDATE lock and starts ACTIVE session.
    """
    session = await check_in(
        db=db,
        station_id=payload.station_id,
        allocated_minutes=payload.allocated_minutes or settings.DEFAULT_SESSION_DURATION_MINUTES,
    )
    return {"message": "Station checked in successfully", "session_id": session.id, "station_id": session.station_id}


@router.post("/sessions/transfer")
async def admin_transfer_station(
    payload: TransferRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Lexicographically locked station transfer to eliminate deadlocks.
    """
    session = await transfer_station(
        db=db,
        session_id=payload.session_id,
        target_station_id=payload.target_station_id,
    )
    return {
        "message": "Session transferred successfully",
        "session_id": session.id,
        "new_station_id": session.station_id,
    }


@router.post("/sessions/checkout", response_model=CheckoutResponse)
async def admin_checkout(
    payload: CheckoutRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
):
    """
    Settle running balance and output UPI QR payload or confirm cash payment.
    Enforces idempotency and verifies no pending kitchen orders.
    """
    resolved_idempotency_key = idempotency_key or f"checkout-{payload.session_id}-{int(datetime.now().timestamp())}"
    result = await settle_checkout(
        db=db,
        session_id=payload.session_id,
        payment_method=payload.payment_method,
        idempotency_key=resolved_idempotency_key,
    )
    return CheckoutResponse(**result)


@router.get("/kitchen/orders", response_model=List[OrderResponse])
async def get_kitchen_orders(db: AsyncSession = Depends(get_db)):
    """
    Fetch all kitchen orders across active swimlanes (QUEUED, PREPARING, SERVED).
    """
    stmt = (
        select(Order)
        .options(
            selectinload(Order.items).selectinload(OrderItem.menu_item),
            selectinload(Order.session).selectinload(Session.station),
        )
        .order_by(Order.created_at.desc())
    )
    result = await db.execute(stmt)
    orders = result.scalars().all()
    return [serialize_order(o) for o in orders]


@router.patch("/kitchen/orders/{order_id}/status", response_model=OrderResponse)
async def update_kitchen_order_status(
    order_id: uuid.UUID,
    payload: OrderStatusUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Updates KDS status (QUEUED ➔ PREPARING ➔ SERVED ➔ CANCELLED).
    Buffers WebSocket events post-commit.
    """
    stmt = (
        select(Order)
        .where(Order.id == order_id)
        .options(
            selectinload(Order.items).selectinload(OrderItem.menu_item),
            selectinload(Order.session).selectinload(Session.station),
        )
        .with_for_update()
    )
    res = await db.execute(stmt)
    order = res.scalar_one_or_none()

    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    order.status = payload.status.value if hasattr(payload.status, "value") else str(payload.status)

    # Buffer WebSocket event
    station_id = str(order.session.station_id) if order.session else None
    buffer_ws_event(
        db,
        channel="admin",
        event_type="ORDER_STATUS_CHANGED",
        payload={
            "order_id": str(order.id),
            "status": order.status,
            "station_name": order.session.station.name if order.session and order.session.station else None,
        },
    )
    if station_id:
        buffer_ws_event(
            db,
            channel=f"customer:{station_id}",
            event_type="ORDER_STATUS_CHANGED",
            payload={
                "order_id": str(order.id),
                "status": order.status,
            },
        )

    await db.commit()
    await db.refresh(order)

    return serialize_order(order)
