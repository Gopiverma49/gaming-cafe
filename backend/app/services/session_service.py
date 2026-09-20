import asyncio
import functools
import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Dict, Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import DBAPIError

from app.core.config import settings
from app.models.entities import Station, Session, Order, Payment
from app.models.enums import (
    StationStatus,
    SessionStatus,
    OrderStatus,
    PaymentStatus,
    PaymentMethod,
)
from app.services.billing_engine import calculate_station_charge, generate_upi_qr_string
from app.services.ws_notifier import buffer_ws_event

logger = logging.getLogger("session_service")


def with_transaction_retry(max_retries: int = 3, base_delay: float = 0.05):
    """
    Transaction retry decorator handling PostgreSQL transient errors:
    40001 (serialization failure) and 40P01 (deadlock detected).
    Uses exponential backoff up to max_retries attempts.
    """
    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            retries = 0
            while True:
                try:
                    return await func(*args, **kwargs)
                except DBAPIError as exc:
                    orig = getattr(exc, "orig", None)
                    pgcode = getattr(orig, "pgcode", None) or getattr(orig, "sqlstate", None) or ""
                    err_msg = str(exc)

                    # Check for 40001 or 40P01
                    is_transient = (
                        pgcode in ("40001", "40P01")
                        or "40001" in err_msg
                        or "40P01" in err_msg
                        or "deadlock detected" in err_msg.lower()
                        or "serialization failure" in err_msg.lower()
                    )

                    if is_transient and retries < max_retries:
                        retries += 1
                        backoff = base_delay * (2 ** (retries - 1))
                        logger.warning(
                            f"Transient DB concurrency error ({pgcode or 'deadlock/serialization'}), "
                            f"retrying {retries}/{max_retries} after {backoff:.3f}s. Function: {func.__name__}"
                        )
                        # Rollback current session if passed in kwargs/args
                        db_session: Optional[AsyncSession] = kwargs.get("db")
                        if not db_session and len(args) > 0 and isinstance(args[0], AsyncSession):
                            db_session = args[0]
                        elif not db_session and len(args) > 1 and isinstance(args[1], AsyncSession):
                            db_session = args[1]

                        if db_session:
                            await db_session.rollback()

                        await asyncio.sleep(backoff)
                        continue

                    # Non-retryable or max retries exceeded
                    raise
        return wrapper
    return decorator


@with_transaction_retry()
async def check_in(
    db: AsyncSession,
    station_id: uuid.UUID,
    allocated_minutes: int = settings.DEFAULT_SESSION_DURATION_MINUTES,
) -> Session:
    """
    Check-in handler acquiring exclusive FOR UPDATE lock on the station.
    Validates AVAILABLE status, transitions to OCCUPIED, and starts ACTIVE session.
    """
    # 1. Exclusive row lock on Station
    stmt = select(Station).where(Station.id == station_id).with_for_update()
    result = await db.execute(stmt)
    station = result.scalar_one_or_none()

    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")

    if station.status != StationStatus.AVAILABLE.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Station '{station.name}' is currently {station.status} and cannot be checked in.",
        )

    # 2. Transition station to OCCUPIED
    station.status = StationStatus.OCCUPIED.value

    # 3. Initialize ACTIVE session
    new_session = Session(
        station_id=station.id,
        started_at=datetime.now(timezone.utc),
        status=SessionStatus.ACTIVE.value,
        total_amount=Decimal("0.00"),
    )
    db.add(new_session)
    await db.flush()  # Populates new_session.id

    # 4. Buffer WebSocket event (dispatches post-commit)
    buffer_ws_event(
        db,
        channel="admin",
        event_type="SESSION_UPDATED",
        payload={
            "action": "CHECK_IN",
            "station_id": str(station.id),
            "session_id": str(new_session.id),
            "station_name": station.name,
            "status": StationStatus.OCCUPIED.value,
        },
    )
    buffer_ws_event(
        db,
        channel=f"customer:{station.id}",
        event_type="SESSION_STARTED",
        payload={
            "session_id": str(new_session.id),
            "station_id": str(station.id),
            "station_name": station.name,
            "started_at": new_session.started_at.isoformat(),
            "allocated_minutes": allocated_minutes,
        },
    )

    await db.commit()
    await db.refresh(new_session)
    return new_session


@with_transaction_retry()
async def transfer_station(
    db: AsyncSession,
    session_id: uuid.UUID,
    target_station_id: uuid.UUID,
) -> Session:
    """
    Deterministic row-locking transfer:
    Sorts origin and target station IDs lexicographically to prevent circular wait deadlocks.
    Locks both rows via SELECT ... FOR UPDATE, validates availability, and reassigns session.
    """
    # 1. Fetch current active session
    session_stmt = select(Session).where(Session.id == session_id).with_for_update()
    sess_res = await db.execute(session_stmt)
    cafe_session = sess_res.scalar_one_or_none()

    if not cafe_session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    if cafe_session.status != SessionStatus.ACTIVE.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot transfer session with status {cafe_session.status}",
        )

    origin_station_id = cafe_session.station_id
    if origin_station_id == target_station_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Target station is the same as current origin station.",
        )

    # 2. Lexicographical ID sorting: min(id_a, id_b) then max(id_a, id_b)
    sorted_ids = sorted([origin_station_id, target_station_id], key=lambda x: str(x))

    # Deterministic sequential locking
    stmt_first = select(Station).where(Station.id == sorted_ids[0]).with_for_update()
    first_station = (await db.execute(stmt_first)).scalar_one_or_none()

    stmt_second = select(Station).where(Station.id == sorted_ids[1]).with_for_update()
    second_station = (await db.execute(stmt_second)).scalar_one_or_none()

    if not first_station or not second_station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more stations not found")

    origin_station = first_station if first_station.id == origin_station_id else second_station
    target_station = second_station if second_station.id == target_station_id else first_station

    # 3. Validate target station availability
    if target_station.status != StationStatus.AVAILABLE.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Target station '{target_station.name}' is not available (status: {target_station.status}).",
        )

    # 4. Atomic transfer swap
    origin_station.status = StationStatus.AVAILABLE.value
    target_station.status = StationStatus.OCCUPIED.value
    cafe_session.station_id = target_station.id

    # 5. Buffer post-commit notifications
    buffer_ws_event(
        db,
        channel="admin",
        event_type="STATION_LOCKED",
        payload={
            "action": "TRANSFER",
            "session_id": str(cafe_session.id),
            "from_station_id": str(origin_station.id),
            "to_station_id": str(target_station.id),
            "from_station_name": origin_station.name,
            "to_station_name": target_station.name,
        },
    )
    buffer_ws_event(
        db,
        channel=f"customer:{origin_station.id}",
        event_type="SESSION_TRANSFERRED",
        payload={"session_id": str(cafe_session.id), "new_station_id": str(target_station.id)},
    )
    buffer_ws_event(
        db,
        channel=f"customer:{target_station.id}",
        event_type="SESSION_STARTED",
        payload={"session_id": str(cafe_session.id), "station_id": str(target_station.id)},
    )

    await db.commit()
    await db.refresh(cafe_session)
    return cafe_session


@with_transaction_retry()
async def settle_checkout(
    db: AsyncSession,
    session_id: uuid.UUID,
    payment_method: str,
    idempotency_key: str,
) -> Dict[str, Any]:
    """
    Checkout handler:
    - Locks session row.
    - Blocks checkout (HTTP 409 Conflict) if any related food orders are QUEUED or PREPARING.
    - Computes exact station charge using billing_engine (Decimal + ROUND_HALF_UP).
    - Aggregates completed SERVED kitchen orders.
    - Inserts Payment record and sets station to AVAILABLE.
    """
    # 1. Lock Session row
    session_stmt = (
        select(Session)
        .where(Session.id == session_id)
        .options(selectinload(Session.orders).selectinload(Order.items))
        .with_for_update()
    )
    res = await db.execute(session_stmt)
    cafe_session = res.scalar_one_or_none()

    if not cafe_session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    if cafe_session.status != SessionStatus.ACTIVE.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Session is already closed (status: {cafe_session.status})",
        )

    # 2. Block checkout if any food orders are active in QUEUED or PREPARING
    pending_orders = [
        o for o in cafe_session.orders
        if o.status in (OrderStatus.QUEUED.value, OrderStatus.PREPARING.value)
    ]
    if pending_orders:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot checkout: {len(pending_orders)} food/beverage order(s) are still QUEUED or PREPARING in the kitchen.",
        )

    # 3. Lock Station row
    station_stmt = select(Station).where(Station.id == cafe_session.station_id).with_for_update()
    station = (await db.execute(station_stmt)).scalar_one_or_none()

    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")

    # 4. Compute exact charges
    ended_at = datetime.now(timezone.utc)
    station_charge = calculate_station_charge(cafe_session.started_at, ended_at, station.hourly_rate)

    orders_charge = Decimal("0.00")
    for order in cafe_session.orders:
        if order.status == OrderStatus.SERVED.value:
            for item in order.items:
                orders_charge += (item.unit_price * Decimal(str(item.quantity))).quantize(
                    Decimal("0.01"), rounding=ROUND_HALF_UP
                )

    total_amount = (station_charge + orders_charge).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    # 5. Check if payment already exists for this idempotency_key
    existing_payment_stmt = select(Payment).where(Payment.idempotency_key == idempotency_key)
    existing_payment = (await db.execute(existing_payment_stmt)).scalar_one_or_none()

    if existing_payment:
        payment = existing_payment
    else:
        payment_method_str = (
            payment_method.value if isinstance(payment_method, PaymentMethod) else str(payment_method)
        )
        payment = Payment(
            session_id=cafe_session.id,
            amount=total_amount,
            method=payment_method_str,
            status=PaymentStatus.COMPLETED.value,
            idempotency_key=idempotency_key,
        )
        db.add(payment)
        await db.flush()

    # 6. Update session and station
    cafe_session.ended_at = ended_at
    cafe_session.status = SessionStatus.COMPLETED.value
    cafe_session.total_amount = total_amount
    station.status = StationStatus.AVAILABLE.value

    # 7. Generate UPI QR string if UPI
    upi_qr_string = None
    if payment_method == "UPI":
        upi_qr_string = generate_upi_qr_string(
            merchant_vpa=settings.UPI_MERCHANT_VPA,
            merchant_name=settings.UPI_MERCHANT_NAME,
            amount=total_amount,
            session_id=cafe_session.id,
        )

    # 8. Buffer WebSocket notifications
    buffer_ws_event(
        db,
        channel="admin",
        event_type="SESSION_UPDATED",
        payload={
            "action": "CHECKOUT",
            "session_id": str(cafe_session.id),
            "station_id": str(station.id),
            "station_name": station.name,
            "total_amount": str(total_amount),
            "payment_method": payment_method,
        },
    )
    buffer_ws_event(
        db,
        channel=f"customer:{station.id}",
        event_type="SESSION_COMPLETED",
        payload={
            "session_id": str(cafe_session.id),
            "total_amount": str(total_amount),
            "station_charge": str(station_charge),
            "orders_charge": str(orders_charge),
        },
    )

    await db.commit()

    return {
        "session_id": cafe_session.id,
        "payment_id": payment.id,
        "station_charge": station_charge,
        "orders_charge": orders_charge,
        "total_amount": total_amount,
        "payment_method": payment_method,
        "payment_status": payment.status,
        "upi_qr_string": upi_qr_string,
    }
