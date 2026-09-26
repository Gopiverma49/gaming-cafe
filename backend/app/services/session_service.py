import asyncio
import functools
import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Dict, Any, List, Set

from fastapi import HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import DBAPIError

from app.core.config import settings
from app.models.entities import Station, Session, Order, OrderItem, Payment, PhysicalDevice, User
from app.models.enums import (
    StationStatus,
    SessionStatus,
    OrderStatus,
    PaymentStatus,
    PaymentMethod,
)
from app.services.billing_engine import calculate_station_charge, generate_upi_qr_string
from app.services.order_service import ensure_utc, CURRENCY_QUANTIZATION, sum_order_charges
from app.services.ws_notifier import buffer_ws_event

logger = logging.getLogger("session_service")


# ---------------------------------------------------------------------------
# Private Billing Helpers  (DRY — shared by check_in, start_category_session,
# settle_checkout, get_fleet_matrix, get_live_stations, customer desk view)
# ---------------------------------------------------------------------------

def _resolve_tier_price(
    tier_price: Optional[Decimal],
    allocated_minutes: int,
    pricing_tiers: list,
    hourly_rate: Decimal,
) -> Decimal:
    """Determine the locked-in tier price for a new session.

    Priority: explicit ``tier_price`` > matching pricing-tier entry >
    proportional hourly fallback.
    """
    if tier_price is not None:
        return Decimal(str(tier_price)).quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP)

    matching = next(
        (t for t in (pricing_tiers or []) if t.get("duration_min") == allocated_minutes),
        None,
    )
    if matching and "price" in matching:
        return Decimal(str(matching["price"])).quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP)

    return (
        (Decimal(str(allocated_minutes)) / Decimal("60")) * hourly_rate
    ).quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP)


def _compute_time_charge(
    tier_price: Optional[Decimal],
    elapsed_minutes: int,
    allocated_minutes: int,
    hourly_rate: Decimal,
    started_at: datetime,
    reference_time: datetime,
) -> Decimal:
    """Calculate the current time-based charge for an active session.

    * Within allocation: return locked-in ``tier_price``.
    * Over allocation: tier_price + prorated overtime at ``hourly_rate``.
    * No tier_price: use the billing-engine minute-accurate formula.
    """
    if tier_price is not None:
        if elapsed_minutes > allocated_minutes:
            overtime_min = elapsed_minutes - allocated_minutes
            overtime = (
                (Decimal(str(overtime_min)) / Decimal("60")) * hourly_rate
            ).quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP)
            return (tier_price + overtime).quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP)
        return tier_price

    return calculate_station_charge(started_at, reference_time, hourly_rate)


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
    customer_name: Optional[str] = None,
    customer_phone: Optional[str] = None,
    user_id: Optional[uuid.UUID] = None,
    tier_price: Optional[Decimal] = None,
    device_id: Optional[str] = None,
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

    # Resolve console room / device
    assigned_device: str = station.name
    st_lower = station.name.lower()
    active_dev_res = await db.execute(
        select(Session.device_name).where(
            Session.status == SessionStatus.ACTIVE.value,
            Session.device_name.is_not(None),
        )
    )
    occupied_devs = {str(d).upper() for d in active_dev_res.scalars().all() if d}

    if device_id:
        dev_req = str(device_id).strip().upper()
        if dev_req in occupied_devs:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Device '{dev_req}' currently in use.",
            )
        assigned_device = dev_req
    elif "car" in st_lower:
        assigned_device = "PS3"
        if "PS3" in occupied_devs:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Device 'PS3' currently in use.",
            )
    elif "vr" in st_lower:
        assigned_device = "VR1"
        if "VR1" in occupied_devs:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Device 'VR1' currently in use.",
            )
    elif "solo" in st_lower or "multi" in st_lower:
        avail = [d for d in ["PS1", "PS2", "PS3"] if d not in occupied_devs]
        if not avail:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"All consoles for {station.name} are currently occupied.",
            )
        assigned_device = avail[0]

    # 2. Transition station to OCCUPIED
    station.status = StationStatus.OCCUPIED.value

    # Determine exact tier price from admin-configured tiers or provided tier_price
    resolved_tier_price: Decimal = _resolve_tier_price(
        tier_price=tier_price,
        allocated_minutes=allocated_minutes,
        pricing_tiers=station.pricing_tiers or [],
        hourly_rate=station.hourly_rate,
    )

    # Resolve user_id if string or lookup by phone
    valid_user_uuid: Optional[uuid.UUID] = None
    if user_id:
        try:
            valid_user_uuid = uuid.UUID(str(user_id))
        except (ValueError, TypeError):
            valid_user_uuid = None
    if not valid_user_uuid and customer_phone:
        stmt_u = select(User).where(User.phone == customer_phone.strip())
        existing_u = (await db.execute(stmt_u)).scalar_one_or_none()
        if existing_u:
            valid_user_uuid = existing_u.id

    # 3. Initialize ACTIVE session with customer linkage and locked-in tier pricing
    new_session = Session(
        station_id=station.id,
        station_name=station.name,
        device_name=assigned_device,
        console_room=assigned_device,
        user_id=valid_user_uuid,
        customer_name=customer_name or "Gamer",
        customer_phone=customer_phone,
        started_at=datetime.now(timezone.utc),
        status=SessionStatus.ACTIVE.value,
        total_amount=resolved_tier_price,
        allocated_minutes=allocated_minutes,
        tier_price=resolved_tier_price,
    )
    db.add(new_session)
    await db.flush()  # Populates new_session.id

    # Update PhysicalDevice in devices table if present
    pdev = await db.get(PhysicalDevice, assigned_device)
    if pdev:
        pdev.status = StationStatus.OCCUPIED.value
        pdev.current_session_id = new_session.id

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
            "device_name": assigned_device,
            "console": assigned_device,
            "room": assigned_device,
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
    buffer_ws_event(
        db,
        channel="customer",
        event_type="SESSION_STARTED",
        payload={
            "session_id": str(new_session.id),
            "station_id": str(station.id),
            "station_name": station.name,
        },
    )

    await db.commit()
    await db.refresh(new_session)
    return new_session


@with_transaction_retry()
async def transfer_station(
    db: AsyncSession,
    session_id: uuid.UUID,
    target_station_id: Optional[uuid.UUID] = None,
    target_device: Optional[str] = None,
) -> Session:
    """
    Deterministic row-locking transfer:
    Supports transferring to a different physical device (e.g. PS1 -> PS2)
    and/or transferring to a different Station row in database.
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
    old_device_name = cafe_session.device_name or cafe_session.console_room or "Console"

    # If target device is specified (e.g. "PS2")
    if target_device:
        t_dev = target_device.strip().upper()
        if t_dev == (old_device_name or "").upper():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Session is already running on device '{target_device}'.",
            )
        # Check active session conflict on target device
        conflict_stmt = select(Session).where(
            Session.status == SessionStatus.ACTIVE.value,
            func.upper(Session.device_name) == t_dev,
            Session.id != cafe_session.id,
        )
        conflict = (await db.execute(conflict_stmt)).scalars().first()
        if conflict:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Target console '{target_device}' is currently occupied.",
            )
        cafe_session.device_name = t_dev
        cafe_session.console_room = t_dev

        # Update PhysicalDevice status records
        old_pdev = await db.get(PhysicalDevice, old_device_name)
        if old_pdev:
            old_pdev.status = StationStatus.AVAILABLE.value
            old_pdev.current_session_id = None
        new_pdev = await db.get(PhysicalDevice, t_dev)
        if new_pdev:
            new_pdev.status = StationStatus.OCCUPIED.value
            new_pdev.current_session_id = cafe_session.id

    # If target_station_id is provided and different from origin
    origin_station = None
    target_station = None
    if target_station_id and target_station_id != origin_station_id:
        sorted_ids = sorted([origin_station_id, target_station_id], key=lambda x: str(x))
        stmt_first = select(Station).where(Station.id == sorted_ids[0]).with_for_update()
        first_station = (await db.execute(stmt_first)).scalar_one_or_none()
        stmt_second = select(Station).where(Station.id == sorted_ids[1]).with_for_update()
        second_station = (await db.execute(stmt_second)).scalar_one_or_none()

        if not first_station or not second_station:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more stations not found")

        origin_station = first_station if first_station.id == origin_station_id else second_station
        target_station = second_station if second_station.id == target_station_id else first_station

        if target_station.status != StationStatus.AVAILABLE.value:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Target station '{target_station.name}' is not available (status: {target_station.status}).",
            )

        origin_station.status = StationStatus.AVAILABLE.value
        target_station.status = StationStatus.OCCUPIED.value
        cafe_session.station_id = target_station.id

    # Buffer notifications
    from_name = origin_station.name if origin_station else old_device_name
    to_name = target_station.name if target_station else (target_device or old_device_name)

    buffer_ws_event(
        db,
        channel="admin",
        event_type="SESSION_TRANSFERRED",
        payload={
            "action": "TRANSFER",
            "session_id": str(cafe_session.id),
            "from_station_id": str(origin_station_id),
            "to_station_id": str(target_station_id or origin_station_id),
            "from_station_name": from_name,
            "to_station_name": to_name,
            "device_name": cafe_session.device_name,
        },
    )
    buffer_ws_event(
        db,
        channel="customer",
        event_type="SESSION_TRANSFERRED",
        payload={
            "session_id": str(cafe_session.id),
            "from_station_id": str(origin_station_id),
            "to_station_id": str(target_station_id or origin_station_id),
            "device_name": cafe_session.device_name,
        },
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
    discount_percent: Optional[Decimal] = None,
    discount_amount: Optional[Decimal] = None,
) -> Dict[str, Any]:
    """
    Checkout handler:
    - Locks session row.
    - Blocks checkout (HTTP 409 Conflict) if any related food orders are QUEUED or PREPARING.
    - Computes exact station charge using billing_engine (Decimal + ROUND_HALF_UP).
    - Aggregates completed SERVED kitchen orders.
    - Applies optional operator discount (e.g. 5%, 10%, 15%, 20%).
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
    started_utc = ensure_utc(cafe_session.started_at)
    ended_utc = ensure_utc(ended_at)
    total_sec = max(0, int((ended_utc - started_utc).total_seconds()))
    elapsed_min_checkout = total_sec // 60
    allocated_checkout = cafe_session.allocated_minutes or 60
    station_charge = _compute_time_charge(
        tier_price=cafe_session.tier_price,
        elapsed_minutes=elapsed_min_checkout,
        allocated_minutes=allocated_checkout,
        hourly_rate=station.hourly_rate,
        started_at=started_utc,
        reference_time=ended_utc,
    )

    orders_charge = Decimal("0.00")
    for order in cafe_session.orders:
        if order.status == OrderStatus.SERVED.value:
            for item in order.items:
                orders_charge += (item.unit_price * Decimal(str(item.quantity))).quantize(
                    CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP
                )

    raw_subtotal = (station_charge + orders_charge).quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP)
    if discount_amount is not None and Decimal(str(discount_amount)) > Decimal("0"):
        disc_amt = min(raw_subtotal, Decimal(str(discount_amount)).quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP))
        total_amount = max(Decimal("0.00"), (raw_subtotal - disc_amt).quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP))
    elif discount_percent and Decimal(str(discount_percent)) > Decimal("0"):
        disc_pct = Decimal(str(discount_percent))
        disc_amt = (raw_subtotal * (disc_pct / Decimal("100"))).quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP)
        total_amount = max(Decimal("0.00"), (raw_subtotal - disc_amt).quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP))
    else:
        total_amount = raw_subtotal

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

    # Free device in PhysicalDevice table
    if cafe_session.device_name:
        pdev = await db.get(PhysicalDevice, cafe_session.device_name)
        if pdev:
            pdev.status = StationStatus.AVAILABLE.value
            pdev.current_session_id = None

    # Check if station has any other active sessions
    other_st_sess = await db.execute(
        select(Session).where(
            Session.station_id == station.id,
            Session.status == SessionStatus.ACTIVE.value,
            Session.id != cafe_session.id,
        )
    )
    if not other_st_sess.scalars().first():
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
    buffer_ws_event(
        db,
        channel="customer",
        event_type="SESSION_COMPLETED",
        payload={
            "session_id": str(cafe_session.id),
            "station_id": str(station.id),
            "status": "COMPLETED",
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


# ---------------------------------------------------------------------------
# Shared-Resource Device Allocation & Experience Tier State Management
# ---------------------------------------------------------------------------

CATEGORY_CONFIGS: Dict[str, Dict[str, Any]] = {
    "solo": {
        "id": "solo",
        "name": "Solo",
        "tier": "CONSOLE",
        "supported_devices": ["PS1", "PS2", "PS3"],
        "hourly_rate": Decimal("180.00"),
        "pricing_tiers": [
            {"duration_min": 30, "price": 100.0, "label": "30 mins"},
            {"duration_min": 60, "price": 180.0, "label": "1 hr"},
            {"duration_min": 120, "price": 320.0, "label": "2 hrs"},
        ],
    },
    "multiplayer": {
        "id": "multiplayer",
        "name": "Multiplayer",
        "tier": "CONSOLE",
        "supported_devices": ["PS1", "PS2", "PS3"],
        "hourly_rate": Decimal("220.00"),
        "pricing_tiers": [
            {"duration_min": 30, "price": 120.0, "label": "30 mins"},
            {"duration_min": 60, "price": 220.0, "label": "1 hr"},
            {"duration_min": 120, "price": 390.0, "label": "2 hrs"},
        ],
    },
    "car_sim": {
        "id": "car_sim",
        "name": "Car Simulator",
        "tier": "SIMULATOR",
        "supported_devices": ["PS3"],
        "hourly_rate": Decimal("250.00"),
        "pricing_tiers": [
            {"duration_min": 30, "price": 140.0, "label": "30 mins"},
            {"duration_min": 60, "price": 250.0, "label": "1 hr"},
            {"duration_min": 120, "price": 450.0, "label": "2 hrs"},
        ],
    },
    "vr_sim": {
        "id": "vr_sim",
        "name": "VR",
        "tier": "VR",
        "supported_devices": ["VR1"],
        "hourly_rate": Decimal("300.00"),
        "pricing_tiers": [
            {"duration_min": 30, "price": 160.0, "label": "30 mins"},
            {"duration_min": 60, "price": 300.0, "label": "1 hr"},
            {"duration_min": 120, "price": 520.0, "label": "2 hrs"},
        ],
    },
}

REGISTERED_CONSOLES: Dict[str, Dict[str, Any]] = {
    "PS1": {"id": "PS1", "name": "PS1", "device_type": "CONSOLE"},
    "PS2": {"id": "PS2", "name": "PS2", "device_type": "CONSOLE"},
    "PS3": {"id": "PS3", "name": "PS3", "device_type": "CONSOLE"},
    "VR1": {"id": "VR1", "name": "VR1", "device_type": "VR"},
}


async def get_fleet_categories(db: AsyncSession) -> List[Dict[str, Any]]:
    """
    Returns the 4 top-level Experience Categories with aggregate hardware availability.
    Underlying physical units: PS1, PS2, PS3, VR1.
    """
    # Active sessions indicate which physical devices/consoles are occupied
    active_stmt = select(Session).where(Session.status == SessionStatus.ACTIVE.value)
    active_res = await db.execute(active_stmt)
    active_sessions = active_res.scalars().all()

    device_session_map: Dict[str, Session] = {}
    for s in active_sessions:
        dev_key = (s.device_name or s.console_room or "").strip().upper()
        if dev_key:
            device_session_map[dev_key] = s

    # Query stations to get live pricing / rates if admin has customized them
    st_stmt = select(Station)
    st_res = await db.execute(st_stmt)
    stations = st_res.scalars().all()
    station_by_name = {st.name.lower(): st for st in stations}

    now = datetime.now(timezone.utc)
    categories = []
    canonical_handled_station_ids: Set[Any] = set()

    canonical_cat_keys = ["solo", "multiplayer", "car_sim", "vr_sim"]
    for cat_id in canonical_cat_keys:
        cfg = CATEGORY_CONFIGS[cat_id]
        supported = cfg["supported_devices"]
        devices_list = []
        for dev_name in supported:
            dev_upper = dev_name.upper()
            active_s = device_session_map.get(dev_upper)
            is_occupied = active_s is not None
            rem_min = None
            if active_s:
                elapsed = int((now - ensure_utc(active_s.started_at)).total_seconds() / 60)
                rem_min = max(0, (active_s.allocated_minutes or 60) - elapsed)

            devices_list.append({
                "id": dev_name,
                "name": dev_name,
                "is_occupied": is_occupied,
                "current_session_id": str(active_s.id) if active_s else None,
                "remaining_minutes": rem_min,
            })

        total_units = len(devices_list)
        available_units = sum(1 for d in devices_list if not d["is_occupied"])
        is_available = available_units > 0

        # Read hourly_rate and pricing_tiers directly from the database station record if available
        station_record = (
            station_by_name.get(cfg["name"].lower())
            or station_by_name.get(cfg["id"].lower())
            or next((st for st in stations if st.name.upper() == supported[0].upper()), None)
        )
        if station_record:
            canonical_handled_station_ids.add(station_record.id)

        cat_hourly_rate = station_record.hourly_rate if station_record else cfg["hourly_rate"]
        cat_pricing_tiers = (
            station_record.pricing_tiers
            if (station_record and station_record.pricing_tiers)
            else cfg["pricing_tiers"]
        )

        categories.append({
            "id": cfg["id"],
            "name": cfg["name"],
            "tier": cfg["tier"],
            "supported_device_ids": supported,
            "devices": devices_list,
            "total_units": total_units,
            "available_units": available_units,
            "is_available": is_available,
            "hourly_rate": cat_hourly_rate,
            "pricing_tiers": cat_pricing_tiers,
        })

    # Include all other stations configured in the database by the admin
    canonical_names = {"solo", "multiplayer", "car simulator", "vr"}
    for st in stations:
        if st.id in canonical_handled_station_ids or st.name.lower() in canonical_names:
            continue

        active_s = next(
            (s for s in active_sessions if s.station_id == st.id or (s.station_name and s.station_name.lower() == st.name.lower())),
            None,
        )
        if not active_s:
            active_s = device_session_map.get(st.name.strip().upper())

        is_occupied = active_s is not None or st.status == StationStatus.OCCUPIED.value
        rem_min = None
        if active_s:
            elapsed = int((now - ensure_utc(active_s.started_at)).total_seconds() / 60)
            rem_min = max(0, (active_s.allocated_minutes or 60) - elapsed)

        categories.append({
            "id": str(st.id),
            "name": st.name,
            "tier": st.tier or "CONSOLE",
            "supported_device_ids": [st.name],
            "devices": [{
                "id": st.name,
                "name": st.name,
                "is_occupied": is_occupied,
                "current_session_id": str(active_s.id) if active_s else None,
                "remaining_minutes": rem_min,
            }],
            "total_units": 1,
            "available_units": 0 if is_occupied else 1,
            "is_available": not is_occupied,
            "hourly_rate": st.hourly_rate,
            "pricing_tiers": st.pricing_tiers or [],
        })

    return categories


@with_transaction_retry()
async def extend_session(
    db: AsyncSession,
    session_id: uuid.UUID,
    minutes: int = 30,
) -> Session:
    """
    Extends an active session's allocated duration by `minutes` and recalculates tier pricing.
    Buffers WebSocket notifications.
    """
    stmt = (
        select(Session)
        .options(
            selectinload(Session.station),
            selectinload(Session.orders).selectinload(Order.items),
        )
        .where(Session.id == session_id)
        .with_for_update()
    )
    result = await db.execute(stmt)
    cafe_session = result.scalar_one_or_none()
    if not cafe_session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    if cafe_session.status != SessionStatus.ACTIVE.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot extend session with status {cafe_session.status}",
        )

    prev_alloc = cafe_session.allocated_minutes or 60
    new_alloc = prev_alloc + minutes
    cafe_session.allocated_minutes = new_alloc

    hourly_rate = (
        cafe_session.station.hourly_rate
        if cafe_session.station and cafe_session.station.hourly_rate
        else Decimal(str(settings.DEFAULT_HOURLY_RATE))
    )
    add_price = ((Decimal(str(minutes)) / Decimal("60")) * hourly_rate).quantize(
        CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP
    )
    if cafe_session.tier_price is not None:
        cafe_session.tier_price = cafe_session.tier_price + add_price
    if cafe_session.total_amount is not None:
        cafe_session.total_amount = cafe_session.total_amount + add_price

    buffer_ws_event(
        db,
        channel="admin",
        event_type="SESSION_UPDATED",
        payload={
            "session_id": str(cafe_session.id),
            "allocated_minutes": new_alloc,
            "extended_by": minutes,
            "device_name": cafe_session.device_name,
        },
    )
    buffer_ws_event(
        db,
        channel="customer",
        event_type="SESSION_UPDATED",
        payload={
            "session_id": str(cafe_session.id),
            "allocated_minutes": new_alloc,
        },
    )
    await db.commit()
    await db.refresh(cafe_session)
    return cafe_session


async def get_fleet_matrix(db: AsyncSession) -> Dict[str, Any]:
    """
    Returns the 2D Station Allocation Matrix data:
    - Rows: Game Modes ("Solo", "Multiplayer", "Car Simulator", "VR")
    - Columns: Physical Stations ("PS1", "PS2", "PS3", etc.) with live active session metrics.
    """
    now = datetime.now(timezone.utc)

    # 1. Query all active sessions with order relationships loaded
    active_stmt = (
        select(Session)
        .options(
            selectinload(Session.station),
            selectinload(Session.orders)
            .selectinload(Order.items)
            .selectinload(OrderItem.menu_item),
        )
        .where(Session.status == SessionStatus.ACTIVE.value)
    )
    active_sessions = (await db.execute(active_stmt)).scalars().all()

    # Map active sessions by device_name
    device_session_map: Dict[str, Session] = {}
    for s in active_sessions:
        dev_key = (s.device_name or s.console_room or "").strip().upper()
        if dev_key:
            device_session_map[dev_key] = s
        elif s.station:
            device_session_map[s.station.name.strip().upper()] = s

    # 2. Query configured Station records for live custom rates/tiers
    st_stmt = select(Station)
    stations_db = (await db.execute(st_stmt)).scalars().all()
    station_by_name = {st.name.lower(): st for st in stations_db}

    # 3. Construct Modes (Rows)
    canonical_cat_keys = ["solo", "multiplayer", "car_sim", "vr_sim"]
    modes_list = []
    all_supported_devices_set: Set[str] = set()

    for cat_id in canonical_cat_keys:
        cfg = CATEGORY_CONFIGS[cat_id]
        if cat_id == "vr_sim":
            supported = ["PS1"]  # Independent VR station represented in Column 1 per spec
        else:
            supported = cfg["supported_devices"]

        for d in supported:
            all_supported_devices_set.add(d.upper())

        station_record = (
            station_by_name.get(cfg["name"].lower())
            or station_by_name.get(cfg["id"].lower())
        )
        hourly_rate = station_record.hourly_rate if station_record else cfg["hourly_rate"]
        pricing_tiers = (
            station_record.pricing_tiers
            if (station_record and station_record.pricing_tiers)
            else cfg["pricing_tiers"]
        )

        modes_list.append({
            "id": cfg["id"],
            "name": cfg["name"],
            "tier": cfg["tier"],
            "hourly_rate": hourly_rate,
            "pricing_tiers": pricing_tiers,
            "supported_stations": supported,
        })

    # Include any custom stations created by admin as additional row modes (NOT new columns)
    canonical_names = {"solo", "multiplayer", "car simulator", "vr"}
    for st in stations_db:
        if st.name.lower() in canonical_names or st.name.upper() in ("PS1", "PS2", "PS3", "VR1"):
            continue
        modes_list.append({
            "id": str(st.id),
            "name": st.name,
            "tier": st.tier or "CONSOLE",
            "hourly_rate": st.hourly_rate,
            "pricing_tiers": st.pricing_tiers or [],
            "supported_stations": ["PS1", "PS2", "PS3"],
        })

    # 4. Construct Physical Stations (Columns): STRICTLY 3 COLUMNS ALL THE TIME (PS1, PS2, PS3)
    pdev_stmt = select(PhysicalDevice).where(PhysicalDevice.id.in_(["PS1", "PS2", "PS3"])).order_by(PhysicalDevice.id)
    pdev_res = await db.execute(pdev_stmt)
    db_pdevs = pdev_res.scalars().all()
    pdev_map = {p.id.strip().upper(): p for p in db_pdevs}

    ordered_devices = ["PS1", "PS2", "PS3"]

    stations_list = []
    for dev_name in ordered_devices:
        dev_upper = dev_name.upper()
        active_s = device_session_map.get(dev_upper)
        is_occupied = active_s is not None

        # Determine device type dynamically from PhysicalDevice record
        pdev = pdev_map.get(dev_upper)
        if pdev and pdev.device_type:
            device_type = pdev.device_type
        elif "SIM" in dev_upper or "CAR" in dev_upper:
            device_type = "SIMULATOR"
        else:
            device_type = "CONSOLE"

        supported_modes_for_station = [
            m["id"] for m in modes_list if any(s.upper() == dev_upper for s in m["supported_stations"])
        ]

        active_detail = None
        if active_s:
            started_at = ensure_utc(active_s.started_at)
            elapsed_sec = (now - started_at).total_seconds()
            elapsed_min = max(0, int(elapsed_sec // 60))
            alloc_min = active_s.allocated_minutes or 60
            rem_min = max(0, alloc_min - elapsed_min)

            st_rate = active_s.station.hourly_rate if active_s.station else Decimal(str(settings.DEFAULT_HOURLY_RATE))
            time_charge = _compute_time_charge(
                tier_price=active_s.tier_price,
                elapsed_minutes=elapsed_min,
                allocated_minutes=alloc_min,
                hourly_rate=st_rate,
                started_at=started_at,
                reference_time=now,
            )

            orders_charge = sum_order_charges(active_s.orders, statuses=["SERVED"])

            active_orders_count = sum(
                1 for o in active_s.orders
                if o.status in (OrderStatus.QUEUED.value, OrderStatus.PREPARING.value)
            )

            running_total = (time_charge + orders_charge).quantize(CURRENCY_QUANTIZATION)

            cat_id_raw = (active_s.category_id or "").lower()
            if "car" in cat_id_raw:
                mode_key = "car_sim"
                mode_name = "Car Simulator"
            elif "multi" in cat_id_raw:
                mode_key = "multiplayer"
                mode_name = "Multiplayer"
            elif "vr" in cat_id_raw:
                mode_key = "vr_sim"
                mode_name = "VR"
            elif cat_id_raw == "solo":
                mode_key = "solo"
                mode_name = "Solo"
            else:
                mode_key = cat_id_raw or "solo"
                mode_name = active_s.station_name or "Solo"

            pricing_tiers = []
            if active_s.station and active_s.station.pricing_tiers:
                pricing_tiers = active_s.station.pricing_tiers

            active_detail = {
                "session_id": active_s.id,
                "station_id": dev_name,
                "mode": mode_key,
                "mode_name": mode_name,
                "customer_name": active_s.customer_name or "Gamer",
                "customer_phone": active_s.customer_phone,
                "started_at": started_at,
                "elapsed_minutes": elapsed_min,
                "remaining_minutes": rem_min,
                "allocated_minutes": alloc_min,
                "time_charge": time_charge,
                "orders_charge": orders_charge,
                "running_total": running_total,
                "active_orders_count": active_orders_count,
                "hourly_rate": st_rate,
                "pricing_tiers": pricing_tiers,
            }

        stations_list.append({
            "id": dev_name,
            "name": dev_name,
            "device_type": device_type,
            "status": "OCCUPIED" if is_occupied else "AVAILABLE",
            "supported_modes": supported_modes_for_station,
            "active_session": active_detail,
        })

    # 5. Extract active VR session independently (independent headset, not tying up PS1/PS2/PS3)
    vr_active_s = (
        device_session_map.get("VR1")
        or device_session_map.get("VR")
        or next((s for s in active_sessions if "vr" in (s.category_id or "").lower() or (s.device_name and "vr" in s.device_name.lower()) or (s.station and "vr" in s.station.name.lower())), None)
    )
    vr_detail = None
    if vr_active_s:
        vr_started_at = ensure_utc(vr_active_s.started_at)
        vr_elapsed_sec = (now - vr_started_at).total_seconds()
        vr_elapsed_min = max(0, int(vr_elapsed_sec // 60))
        vr_alloc_min = vr_active_s.allocated_minutes or 60
        vr_rem_min = max(0, vr_alloc_min - vr_elapsed_min)

        vr_rate = vr_active_s.station.hourly_rate if vr_active_s.station else Decimal(str(settings.DEFAULT_HOURLY_RATE))
        vr_time_charge = _compute_time_charge(
            tier_price=vr_active_s.tier_price,
            elapsed_minutes=vr_elapsed_min,
            allocated_minutes=vr_alloc_min,
            hourly_rate=vr_rate,
            started_at=vr_started_at,
            reference_time=now,
        )

        vr_orders_charge = sum_order_charges(vr_active_s.orders, statuses=["SERVED"])

        vr_active_orders_count = sum(
            1 for o in vr_active_s.orders
            if o.status in (OrderStatus.QUEUED.value, OrderStatus.PREPARING.value)
        )

        vr_running_total = (vr_time_charge + vr_orders_charge).quantize(CURRENCY_QUANTIZATION)

        vr_pricing_tiers = []
        if vr_active_s.station and vr_active_s.station.pricing_tiers:
            vr_pricing_tiers = vr_active_s.station.pricing_tiers

        vr_detail = {
            "session_id": vr_active_s.id,
            "station_id": vr_active_s.device_name or "VR1",
            "mode": "vr_sim",
            "mode_name": "VR",
            "customer_name": vr_active_s.customer_name or "Gamer",
            "customer_phone": vr_active_s.customer_phone,
            "started_at": vr_started_at,
            "elapsed_minutes": vr_elapsed_min,
            "remaining_minutes": vr_rem_min,
            "allocated_minutes": vr_alloc_min,
            "time_charge": vr_time_charge,
            "orders_charge": vr_orders_charge,
            "running_total": vr_running_total,
            "active_orders_count": vr_active_orders_count,
            "hourly_rate": vr_rate,
            "pricing_tiers": vr_pricing_tiers,
        }

    return {
        "modes": modes_list,
        "stations": stations_list,
        "vr_session": vr_detail,
    }


async def start_category_session(
    db: AsyncSession,
    category_id: str,
    device_id: Optional[str] = None,
    duration_minutes: int = 60,
    customer_name: Optional[str] = None,
    customer_phone: Optional[str] = None,
    user_id: Optional[uuid.UUID] = None,
    tier_price: Optional[Decimal] = None,
) -> Session:
    """
    Enforces shared-resource device allocation and atomic conflict rejection.
    Supports both canonical shared categories (Solo, Multiplayer, Car Simulator, VR)
    and custom stations created by the administrator.
    """
    raw_cat = category_id.lower().strip()
    if raw_cat in ("vr", "vr simulator", "vr_simulator"):
        norm_cat = "vr_sim"
    elif raw_cat in ("car simulator", "car_simulator"):
        norm_cat = "car_sim"
    else:
        norm_cat = raw_cat

    if norm_cat in CATEGORY_CONFIGS:
        cat_cfg = CATEGORY_CONFIGS[norm_cat]

        # Query currently occupied devices across all active sessions
        active_dev_res = await db.execute(
            select(Session.device_name).where(
                Session.status == SessionStatus.ACTIVE.value,
                Session.device_name.is_not(None),
            )
        )
        occupied_devs = {str(d).upper() for d in active_dev_res.scalars().all() if d}

        # Resolve target console room / device
        if norm_cat == "car_sim":
            target_device_name = "PS3"
        elif norm_cat == "vr_sim":
            target_device_name = "VR1"
        else:
            # Solo or Multiplayer: device_id can be 'PS1', 'PS2', 'PS3'
            if not device_id:
                avail = [d for d in cat_cfg["supported_devices"] if d.upper() not in occupied_devs]
                if not avail:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"All consoles for {cat_cfg['name']} are currently occupied.",
                    )
                target_device_name = avail[0]
            else:
                dev_str = str(device_id).strip().upper()
                matched = next((d for d in cat_cfg["supported_devices"] if d.upper() == dev_str), None)
                if not matched:
                    try:
                        dev_uuid = uuid.UUID(str(device_id))
                        st_lookup = await db.get(Station, dev_uuid)
                        if st_lookup and st_lookup.name.upper() in [d.upper() for d in cat_cfg["supported_devices"]]:
                            matched = st_lookup.name.upper()
                    except ValueError:
                        pass

                if not matched:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Device '{device_id}' is not supported by category '{cat_cfg['name']}'. Supported: {cat_cfg['supported_devices']}",
                    )
                target_device_name = matched

        # Verify device occupancy atomically: check for any active session on target_device_name
        if target_device_name.upper() in occupied_devs:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Device '{target_device_name}' currently in use.",
            )

        # Double check database row lock on existing active sessions for this device
        active_stmt = (
            select(Session)
            .where(
                func.upper(Session.device_name) == target_device_name.upper(),
                Session.status == SessionStatus.ACTIVE.value,
            )
            .with_for_update()
        )
        active_conflict = (await db.execute(active_stmt)).scalars().first()
        if active_conflict:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Device '{target_device_name}' currently in use.",
            )

        # Resolve Station entity (Canonical Station: Solo, Multiplayer, Car Simulator, VR)
        station_stmt = select(Station).where(func.lower(Station.name) == cat_cfg["name"].lower())
        station = (await db.execute(station_stmt)).scalar_one_or_none()
        if not station:
            st_legacy = (await db.execute(select(Station).where(Station.name == target_device_name))).scalar_one_or_none()
            if st_legacy:
                station = st_legacy
            else:
                station = Station(
                    name=cat_cfg["name"],
                    tier=cat_cfg["tier"],
                    hourly_rate=cat_cfg["hourly_rate"],
                    pricing_tiers=cat_cfg["pricing_tiers"],
                    status=StationStatus.AVAILABLE.value,
                )
                db.add(station)
                await db.flush()

        pricing_tiers_pool = station.pricing_tiers or cat_cfg["pricing_tiers"]
        fallback_hourly_rate = station.hourly_rate or cat_cfg["hourly_rate"]
    else:
        # Custom station added by admin
        custom_station = None
        try:
            cat_uuid = uuid.UUID(category_id)
            custom_station = await db.get(Station, cat_uuid)
        except (ValueError, TypeError):
            pass

        if not custom_station:
            stmt_st = select(Station).where(func.lower(Station.name) == raw_cat)
            custom_station = (await db.execute(stmt_st)).scalar_one_or_none()

        if not custom_station:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid category or station '{category_id}'. Valid options include: {list(CATEGORY_CONFIGS.keys())}",
            )

        station = custom_station
        target_device_name = station.name

        # Verify station occupancy atomically
        active_stmt = (
            select(Session)
            .where(
                Session.station_id == station.id,
                Session.status == SessionStatus.ACTIVE.value,
            )
            .with_for_update()
        )
        active_conflict = (await db.execute(active_stmt)).scalars().first()
        if active_conflict or station.status == StationStatus.OCCUPIED.value:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Station '{station.name}' currently in use.",
            )

        pricing_tiers_pool = station.pricing_tiers or []
        fallback_hourly_rate = station.hourly_rate or Decimal(str(settings.DEFAULT_HOURLY_RATE))

    # Determine tier price
    resolved_tier_price: Decimal = _resolve_tier_price(
        tier_price=tier_price,
        allocated_minutes=duration_minutes,
        pricing_tiers=pricing_tiers_pool,
        hourly_rate=fallback_hourly_rate,
    )

    # Resolve user_id if string or lookup by phone
    valid_user_uuid: Optional[uuid.UUID] = None
    if user_id:
        try:
            valid_user_uuid = uuid.UUID(str(user_id))
        except (ValueError, TypeError):
            valid_user_uuid = None
    if not valid_user_uuid and customer_phone:
        stmt_u = select(User).where(User.phone == customer_phone.strip())
        existing_u = (await db.execute(stmt_u)).scalar_one_or_none()
        if existing_u:
            valid_user_uuid = existing_u.id

    new_session = Session(
        station_id=station.id,
        station_name=station.name,
        device_name=target_device_name,
        console_room=target_device_name,
        user_id=valid_user_uuid,
        customer_name=customer_name or "Gamer",
        customer_phone=customer_phone,
        started_at=datetime.now(timezone.utc),
        status=SessionStatus.ACTIVE.value,
        total_amount=resolved_tier_price,
        allocated_minutes=duration_minutes,
        tier_price=resolved_tier_price,
        category_id=norm_cat,
    )
    db.add(new_session)
    await db.flush()

    # Transition PhysicalDevice to OCCUPIED if present
    pdev = await db.get(PhysicalDevice, target_device_name)
    if pdev:
        pdev.status = StationStatus.OCCUPIED.value
        pdev.current_session_id = new_session.id

    # Transition Station status to OCCUPIED
    station.status = StationStatus.OCCUPIED.value

    # Buffer WebSocket event
    buffer_ws_event(
        db,
        channel="admin",
        event_type="SESSION_STARTED",
        payload={
            "session_id": str(new_session.id),
            "station_id": str(station.id),
            "station_name": station.name,
            "device_name": target_device_name,
            "console": target_device_name,
            "room": target_device_name,
            "category_id": norm_cat,
            "status": StationStatus.OCCUPIED.value,
            "customer_name": new_session.customer_name,
            "tier_price": str(resolved_tier_price),
            "allocated_minutes": duration_minutes,
        },
    )
    buffer_ws_event(
        db,
        channel="customer",
        event_type="SESSION_STARTED",
        payload={
            "session_id": str(new_session.id),
            "station_id": str(station.id),
            "status": "ACTIVE",
            "category_id": norm_cat,
        },
    )

    await db.commit()
    await db.refresh(new_session)
    return new_session

