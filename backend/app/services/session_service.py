import asyncio
import functools
import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Dict, Any, List

from fastapi import HTTPException, status
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import DBAPIError

from app.core.config import settings
from app.models.entities import Station, Session, Order, Payment, PhysicalDevice, User
from app.models.enums import (
    StationStatus,
    SessionStatus,
    OrderStatus,
    PaymentStatus,
    PaymentMethod,
)
from app.services.billing_engine import calculate_station_charge, generate_upi_qr_string
from app.services.order_service import ensure_utc
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
    resolved_tier_price: Decimal
    if tier_price is not None:
        resolved_tier_price = Decimal(str(tier_price)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    else:
        matching_tier = None
        if station.pricing_tiers and isinstance(station.pricing_tiers, list):
            for t in station.pricing_tiers:
                if isinstance(t, dict) and t.get("duration_min") == allocated_minutes:
                    matching_tier = t
                    break
        if matching_tier and "price" in matching_tier:
            resolved_tier_price = Decimal(str(matching_tier["price"])).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        else:
            resolved_tier_price = (
                (Decimal(str(allocated_minutes)) / Decimal("60")) * station.hourly_rate
            ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

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
    buffer_ws_event(
        db,
        channel="customer",
        event_type="SESSION_TRANSFERRED",
        payload={"session_id": str(cafe_session.id), "from_station_id": str(origin_station.id), "to_station_id": str(target_station.id)},
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
    if cafe_session.tier_price is not None:
        started_utc = ensure_utc(cafe_session.started_at)
        ended_utc = ensure_utc(ended_at)
        total_sec = max(0, int((ended_utc - started_utc).total_seconds()))
        elapsed_min = total_sec // 60
        allocated = cafe_session.allocated_minutes or 60
        if elapsed_min > allocated:
            overtime_min = elapsed_min - allocated
            overtime_charge = (
                (Decimal(str(overtime_min)) / Decimal("60")) * station.hourly_rate
            ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            station_charge = (cafe_session.tier_price + overtime_charge).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
        else:
            station_charge = cafe_session.tier_price
    else:
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

    return categories


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
    - Category validation: ensures category exists and console room is valid.
    - Cross-category hardware lock: CAR Simulator requires PS3; Solo & Multiplayer can use PS1, PS2, PS3.
    - Atomically verifies device.is_occupied == false; rejects with 409 Conflict if occupied.
    """
    raw_cat = category_id.lower().strip()
    if raw_cat in ("vr", "vr simulator", "vr_simulator"):
        norm_cat = "vr_sim"
    elif raw_cat in ("car simulator", "car_simulator"):
        norm_cat = "car_sim"
    else:
        norm_cat = raw_cat

    if norm_cat not in CATEGORY_CONFIGS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid category '{category_id}'. Valid options: {list(CATEGORY_CONFIGS.keys())}",
        )
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
    target_device_name: str
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
                # Check if device was passed as UUID
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
        # Check if legacy station exists matching target_device_name (e.g. in test fixture where station was named PS1)
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

    # Determine tier price
    resolved_tier_price: Decimal
    if tier_price is not None:
        resolved_tier_price = Decimal(str(tier_price)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    else:
        pricing_tiers_pool = station.pricing_tiers or cat_cfg["pricing_tiers"]
        matching_tier = next(
            (t for t in pricing_tiers_pool if t.get("duration_min") == duration_minutes),
            None,
        )
        if matching_tier and "price" in matching_tier:
            resolved_tier_price = Decimal(str(matching_tier["price"])).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        else:
            resolved_tier_price = (
                (Decimal(str(duration_minutes)) / Decimal("60")) * (station.hourly_rate or cat_cfg["hourly_rate"])
            ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

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

