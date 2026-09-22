from collections import defaultdict
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, get_optional_auth_user, get_required_auth_user
from app.core.config import settings
from app.core.security import create_admin_token
from app.models.entities import Station, Session, Order, OrderItem, MenuItem, User
from app.models.enums import SessionStatus, OrderStatus
from app.schemas.api_schemas import (
    StationLiveResponse,
    StationCreate,
    StationResponse,
    UpdateStationRequest,
    CheckInRequest,
    TransferRequest,
    CheckoutRequest,
    CheckoutResponse,
    OrderStatusUpdateRequest,
    OrderResponse,
    TokenResponse,
    LoginRequest,
    MenuItemCreate,
    MenuItemUpdate,
    MenuItemResponse,
    InventoryRestockRequest,
    CustomerProfileResponse,
    StationOrderCreateRequest,
    CategoryAvailabilityResponse,
    SessionStartRequest,
    SessionResponse,
)
from app.services.billing_engine import calculate_station_charge
from app.services.order_service import serialize_order, ensure_utc, calculate_order_subtotals, CURRENCY_QUANTIZATION
from app.services.session_service import (
    check_in,
    transfer_station,
    settle_checkout,
    with_transaction_retry,
    get_fleet_categories,
    start_category_session,
)
from app.services.ws_notifier import buffer_ws_event

router = APIRouter(prefix="/admin", tags=["Admin Operations"])


@router.get("/fleet/categories", response_model=List[CategoryAvailabilityResponse])
async def get_fleet_experience_categories(db: AsyncSession = Depends(get_db)):
    """
    Returns the 4 top-level Experience Categories (Solo, Multiplayer, CAR Simulator, VR Simulator)
    with real-time aggregate device availability.
    """
    return await get_fleet_categories(db)


@router.post("/sessions/start", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def start_experience_session_endpoint(
    payload: SessionStartRequest,
    auth_user: Optional[User] = Depends(get_optional_auth_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Starts an experience session on a shared physical device.
    Enforces atomic conflict rejection if device (e.g. PS3 across Solo/Multiplayer/CAR) is busy.
    """
    user_id = auth_user.id if auth_user else None
    customer_name = payload.customer_name or (auth_user.name if auth_user else "Gamer")
    customer_phone = payload.customer_phone or (auth_user.phone if auth_user else None)

    return await start_category_session(
        db=db,
        category_id=payload.category_id,
        device_id=payload.device_id,
        duration_minutes=payload.duration_minutes,
        customer_name=customer_name,
        customer_phone=customer_phone,
        user_id=user_id,
        tier_price=payload.tier_price,
    )


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
    auth_user: Optional[User] = Depends(get_optional_auth_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Live matrix showing station statuses, remaining times, and running totals.
    Sanitizes private billing data for stations not owned by caller.
    """
    stmt = (
        select(Station)
        .options(
            selectinload(Station.sessions)
            .selectinload(Session.orders)
            .selectinload(Order.items)
            .selectinload(OrderItem.menu_item)
        )
        .order_by(Station.name)
    )
    result = await db.execute(stmt)
    stations = result.scalars().all()

    now = datetime.now(timezone.utc)
    live_data: List[StationLiveResponse] = []
    is_admin = bool(auth_user and getattr(auth_user, "role", "").upper() == "ADMIN")

    # If canonical stations exist, keep top-level fleet distinct by excluding physical console rooms
    has_canonical = any(s.name.lower() in ("solo", "multiplayer", "car simulator", "vr") for s in stations)
    if has_canonical:
        stations = [s for s in stations if s.name.upper() not in ("PS1", "PS2", "PS3", "VR1")]

    for station in stations:
        # Find active session (match by station_id or station_name)
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
                    default_hourly_rate=station.hourly_rate,
                    pricing_tiers=station.pricing_tiers or [],
                    status=station.status,
                    is_occupied=False,
                    is_my_session=False,
                    user_id=None,
                    active_session_id=None,
                    started_at=None,
                    elapsed_minutes=0,
                    remaining_minutes=None,
                    time_charge=Decimal("0.00"),
                    orders_charge=Decimal("0.00"),
                    running_total=Decimal("0.00"),
                    active_orders_count=0,
                    device_name=None,
                    allocated_console=None,
                )
            )
        else:
            started_at = ensure_utc(active_session.started_at)
            elapsed_sec = (now - started_at).total_seconds()
            elapsed_min = max(0, int(elapsed_sec // 60))
            allocated_mins = active_session.allocated_minutes or settings.DEFAULT_SESSION_DURATION_MINUTES
            remaining_min = max(0, allocated_mins - elapsed_min)

            matches_user_id = bool(
                auth_user is not None
                and active_session.user_id is not None
                and auth_user.id == active_session.user_id
            )
            matches_phone = bool(
                auth_user is not None
                and auth_user.phone
                and active_session.customer_phone
                and auth_user.phone.strip() == active_session.customer_phone.strip()
            )
            is_my_session = is_admin or matches_user_id or matches_phone

            if not is_my_session:
                # Sanitize response for non-owner: strip private billing details and session ID
                live_data.append(
                    StationLiveResponse(
                        id=station.id,
                        name=station.name,
                        tier=station.tier,
                        hourly_rate=station.hourly_rate,
                        default_hourly_rate=station.hourly_rate,
                        pricing_tiers=station.pricing_tiers or [],
                        status=station.status,
                        is_occupied=True,
                        is_my_session=False,
                        user_id=None,
                        active_session_id=None,
                        started_at=None,
                        elapsed_minutes=0,
                        remaining_minutes=remaining_min,
                        time_charge=Decimal("0.00"),
                        orders_charge=Decimal("0.00"),
                        running_total=Decimal("0.00"),
                        active_orders_count=0,
                        device_name=active_session.device_name,
                        allocated_console=active_session.device_name,
                        customer_phone=None,
                        customer_name=None,
                    )
                )
            else:
                if active_session.tier_price is not None:
                    if elapsed_min > allocated_mins:
                        overtime_min = elapsed_min - allocated_mins
                        overtime_charge = (
                            (Decimal(str(overtime_min)) / Decimal("60")) * station.hourly_rate
                        ).quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP)
                        time_charge = (active_session.tier_price + overtime_charge).quantize(
                            CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP
                        )
                    else:
                        time_charge = active_session.tier_price
                else:
                    time_charge = calculate_station_charge(
                        started_at, now, station.hourly_rate
                    )

                orders_charge = Decimal("0.00")
                active_orders_count = 0
                for o in active_session.orders:
                    if o.status != OrderStatus.CANCELLED.value:
                        if o.status in (OrderStatus.QUEUED.value, OrderStatus.PREPARING.value):
                            active_orders_count += 1
                        subtotal, _ = calculate_order_subtotals(o.items)
                        orders_charge += subtotal

                running_total = (time_charge + orders_charge).quantize(
                    CURRENCY_QUANTIZATION
                )

                live_data.append(
                    StationLiveResponse(
                        id=station.id,
                        name=station.name,
                        tier=station.tier,
                        hourly_rate=station.hourly_rate,
                        default_hourly_rate=station.hourly_rate,
                        pricing_tiers=station.pricing_tiers or [],
                        status=station.status,
                        is_occupied=True,
                        is_my_session=True,
                        user_id=active_session.user_id,
                        active_session_id=active_session.id,
                        started_at=active_session.started_at,
                        elapsed_minutes=elapsed_min,
                        remaining_minutes=remaining_min,
                        time_charge=time_charge,
                        orders_charge=orders_charge,
                        running_total=running_total,
                        active_orders_count=active_orders_count,
                        device_name=active_session.device_name,
                        allocated_console=active_session.device_name,
                        customer_phone=active_session.customer_phone,
                        customer_name=active_session.customer_name,
                    )
                )

    return live_data


@router.post("/stations", response_model=StationResponse, status_code=201)
async def create_station(
    payload: StationCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new gaming station. Name must be unique.
    """
    # Check name uniqueness
    existing = await db.execute(select(Station).where(Station.name == payload.name))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A station named '{payload.name}' already exists.",
        )

    rate = payload.hourly_rate or payload.default_hourly_rate
    if rate is None:
        if payload.pricing_tiers:
            first_tier = payload.pricing_tiers[0]
            rate = Decimal(str(first_tier.price)) * Decimal(str(60 / first_tier.duration_min))
        else:
            rate = Decimal("150.00")

    tiers_data = [t.model_dump(mode="json") for t in payload.pricing_tiers] if payload.pricing_tiers else []
    station = Station(
        name=payload.name,
        tier=payload.tier,
        hourly_rate=rate,
        pricing_tiers=tiers_data,
    )
    db.add(station)
    await db.commit()
    await db.refresh(station)
    return station


@router.patch("/stations/{station_id}", response_model=StationResponse)
async def update_station(
    station_id: uuid.UUID,
    payload: UpdateStationRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Update station name, tier, hourly rate, pricing tiers or status.
    """
    result = await db.execute(select(Station).where(Station.id == station_id).with_for_update())
    station = result.scalar_one_or_none()
    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")

    if payload.name is not None:
        # Check name uniqueness (exclude self)
        dup = await db.execute(select(Station).where(Station.name == payload.name, Station.id != station_id))
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Name '{payload.name}' is already taken.")
        station.name = payload.name
    if payload.tier is not None:
        station.tier = payload.tier
    if payload.hourly_rate is not None:
        station.hourly_rate = payload.hourly_rate
    elif payload.default_hourly_rate is not None:
        station.hourly_rate = payload.default_hourly_rate
    if payload.pricing_tiers is not None:
        station.pricing_tiers = [t.model_dump(mode="json") for t in payload.pricing_tiers]
    if payload.status is not None:
        allowed_statuses = {"AVAILABLE", "MAINTENANCE", "RESERVED"}
        if payload.status not in allowed_statuses:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Status must be one of {allowed_statuses}")
        station.status = payload.status

    await db.commit()
    await db.refresh(station)
    return station


@router.delete("/stations/{station_id}", status_code=204)
async def delete_station(
    station_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a station. Blocked if there is an active session.
    """
    result = await db.execute(
        select(Station)
        .options(selectinload(Station.sessions))
        .where(Station.id == station_id)
        .with_for_update()
    )
    station = result.scalar_one_or_none()
    if not station:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Station not found")

    active = any(s.status == "ACTIVE" for s in station.sessions)
    if active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete a station with an active session. Check out first.",
        )

    await db.delete(station)
    await db.commit()


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
        customer_name=payload.customer_name,
        customer_phone=payload.customer_phone,
        user_id=payload.user_id,
        tier_price=payload.tier_price,
        device_id=payload.device_id,
    )
    return {
        "message": "Station checked in successfully",
        "session_id": str(session.id),
        "station_id": str(session.station_id),
        "device_name": session.device_name,
        "console": session.device_name,
        "room": session.device_name,
    }


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
@with_transaction_retry()
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
    )
    res = await db.execute(stmt)
    order = res.scalar_one_or_none()

    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    old_status = order.status
    new_status = payload.status.value if hasattr(payload.status, "value") else str(payload.status)

    # 1. On Accept (transitioning from QUEUED to PREPARING/SERVED): Deduct inventory stock
    if old_status == OrderStatus.QUEUED.value and new_status in (OrderStatus.PREPARING.value, OrderStatus.SERVED.value):
        for itm in order.items:
            if itm.menu_item:
                itm.menu_item.stock = max(0, itm.menu_item.stock - itm.quantity)
    # 2. On Cancel after having been accepted: Restore inventory stock
    elif old_status in (OrderStatus.PREPARING.value, OrderStatus.SERVED.value) and new_status == OrderStatus.CANCELLED.value:
        for itm in order.items:
            if itm.menu_item:
                itm.menu_item.stock = itm.menu_item.stock + itm.quantity

    order.status = new_status

    customer_message = (
        "Order Accepted — Food is being prepared"
        if new_status == OrderStatus.PREPARING.value
        else "Order Served"
        if new_status == OrderStatus.SERVED.value
        else "Order Rejected"
        if new_status == OrderStatus.CANCELLED.value
        else f"Order {new_status}"
    )

    # Buffer WebSocket event (ws_notifier automatically broadcasts to admin and customer)
    station_id = str(order.session.station_id) if order.session else None
    station_name = order.session.station.name if order.session and order.session.station else None

    buffer_ws_event(
        db,
        channel="admin",
        event_type="ORDER_STATUS_CHANGED",
        payload={
            "order_id": str(order.id),
            "status": order.status,
            "station_name": station_name,
            "message": customer_message,
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
                "station_id": station_id,
                "message": customer_message,
            },
        )

    response_data = serialize_order(order)
    await db.commit()
    return response_data


# ---------------------------------------------------------------------------
# Menu & Inventory Operations
# ---------------------------------------------------------------------------

@router.get("/menu", response_model=List[MenuItemResponse])
async def get_admin_menu(db: AsyncSession = Depends(get_db)):
    """
    Fetch all menu items with active inventory stock levels.
    """
    stmt = select(MenuItem).order_by(MenuItem.category, MenuItem.name)
    items = (await db.execute(stmt)).scalars().all()
    return items


@router.post("/menu", response_model=MenuItemResponse, status_code=status.HTTP_201_CREATED)
async def create_menu_item(
    payload: MenuItemCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Add a new item to the menu & inventory catalogue.
    """
    stmt = select(MenuItem).where(MenuItem.name == payload.name.strip())
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"An item named '{payload.name}' already exists in the menu.",
        )

    item = MenuItem(
        name=payload.name.strip(),
        category=payload.category,
        price=payload.price,
        stock=payload.stock,
        min_stock_alert=payload.min_stock_alert,
        is_available=payload.is_available,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/menu/{item_id}", response_model=MenuItemResponse)
async def update_menu_item(
    item_id: uuid.UUID,
    payload: MenuItemUpdate,
    db: AsyncSession = Depends(get_db),
):
    """
    Update item name, category, price, stock, or availability.
    """
    item = await db.get(MenuItem, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu item not found")

    if payload.name is not None:
        item.name = payload.name.strip()
    if payload.category is not None:
        item.category = payload.category
    if payload.price is not None:
        item.price = payload.price
    if payload.stock is not None:
        item.stock = payload.stock
    if payload.min_stock_alert is not None:
        item.min_stock_alert = payload.min_stock_alert
    if payload.is_available is not None:
        item.is_available = payload.is_available

    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/menu/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_menu_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Remove an item from the menu and inventory catalogue.
    """
    item = await db.get(MenuItem, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu item not found")

    # Clean up any order items referencing this menu item to prevent FK violation
    await db.execute(delete(OrderItem).where(OrderItem.menu_item_id == item_id))
    await db.delete(item)
    await db.commit()


@router.post("/inventory/restock", response_model=MenuItemResponse)
async def restock_inventory_item(
    payload: InventoryRestockRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Restock item quantity in inventory.
    """
    item = await db.get(MenuItem, payload.item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu item not found")

    item.stock += payload.amount
    await db.commit()
    await db.refresh(item)
    return item


# ---------------------------------------------------------------------------
# Station Food Ordering (with real-time stock deduction)
# ---------------------------------------------------------------------------

@router.post("/orders/station-order", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
async def place_station_food_order(
    payload: StationOrderCreateRequest,
    auth_user: Optional[User] = Depends(get_optional_auth_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Places food order from station, atomically deducts stock in DB,
    attaches to active session, and broadcasts ORDER_CREATED event to Kitchen Kanban.
    Enforces server-side authorization: caller must be an admin or the session owner.
    """
    stmt = (
        select(Session)
        .where(Session.station_id == payload.station_id, Session.status == SessionStatus.ACTIVE.value)
        .options(selectinload(Session.station))
    )
    cafe_session = (await db.execute(stmt)).scalar_one_or_none()
    if not cafe_session:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active playing session on this station. Please start a session before ordering snacks.",
        )

    # Authorization Check: Caller must be authenticated, and either ADMIN or session owner
    if not auth_user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Authentication required to order food for a station session.",
        )

    is_admin = bool(getattr(auth_user, "role", "").upper() == "ADMIN")
    if not is_admin:
        if cafe_session.user_id is None or cafe_session.user_id != auth_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: You cannot order food for a station session you do not own.",
            )

    # 1. Create order
    order = Order(
        session_id=cafe_session.id,
        customer_name=payload.customer_name or cafe_session.customer_name or "Station Player",
        status=OrderStatus.QUEUED.value,
    )
    db.add(order)
    await db.flush()

    # 2. Deduct stock atomically and build order items
    for itm in payload.items:
        menu_item = await db.get(MenuItem, itm.menu_item_id)
        if not menu_item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Menu item '{itm.menu_item_id}' not found",
            )
        if menu_item.stock < itm.quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Insufficient stock for '{menu_item.name}'. Only {menu_item.stock} left in inventory.",
            )

        menu_item.stock -= itm.quantity
        order_item = OrderItem(
            order_id=order.id,
            menu_item_id=menu_item.id,
            quantity=itm.quantity,
            unit_price=menu_item.price,
        )
        db.add(order_item)

    await db.flush()

    # 3. Broadcast WebSocket event to kitchen
    buffer_ws_event(
        db,
        channel="admin",
        event_type="ORDER_CREATED",
        payload={
            "order_id": str(order.id),
            "station_name": cafe_session.station.name if cafe_session.station else "Gaming Station",
            "customer_name": order.customer_name,
        },
    )

    await db.commit()

    # 4. Fetch hydrated order for response
    order_stmt = (
        select(Order)
        .where(Order.id == order.id)
        .options(
            selectinload(Order.items).selectinload(OrderItem.menu_item),
            selectinload(Order.session).selectinload(Session.station),
        )
    )
    hydrated_order = (await db.execute(order_stmt)).scalar_one()
    return serialize_order(hydrated_order)


# ---------------------------------------------------------------------------
# Customer Directory & Footfall Logs
# ---------------------------------------------------------------------------

@router.get("/customers", response_model=List[CustomerProfileResponse])
async def get_customer_directory(db: AsyncSession = Depends(get_db)):
    """
    Live aggregated customer directory querying registered players and sessions.
    Computes total visits, last visit timestamp, and lifetime revenue in O(U + S) time.
    """
    users_stmt = select(User).where(User.role == "CUSTOMER").order_by(User.created_at.desc())
    users = (await db.execute(users_stmt)).scalars().all()

    sessions_stmt = select(Session).options(
        selectinload(Session.orders).selectinload(Order.items)
    )
    all_sessions = (await db.execute(sessions_stmt)).scalars().all()

    # Pre-index sessions by user_id and customer_phone in O(S) time
    sessions_by_user: defaultdict[str, List[Session]] = defaultdict(list)
    sessions_by_phone: defaultdict[str, List[Session]] = defaultdict(list)
    for s in all_sessions:
        if s.user_id:
            sessions_by_user[str(s.user_id)].append(s)
        if s.customer_phone:
            sessions_by_phone[s.customer_phone].append(s)

    out: List[CustomerProfileResponse] = []
    seen_phones = set()

    for u in users:
        seen_phones.add(u.phone)
        # Combine sessions linked by user_id or phone without duplicates
        user_sess_map = {}
        for s in sessions_by_user.get(str(u.id), []):
            user_sess_map[s.id] = s
        for s in sessions_by_phone.get(u.phone, []):
            user_sess_map[s.id] = s
        u_sessions = list(user_sess_map.values())

        visit_count = len(u_sessions)
        last_visit_str = None
        total_spent = Decimal("0.00")

        if u_sessions:
            sorted_s = sorted(u_sessions, key=lambda s: s.started_at, reverse=True)
            last_visit_str = sorted_s[0].started_at.strftime("%d %b, %I:%M %p")
            for s in u_sessions:
                if s.total_amount:
                    total_spent += s.total_amount
                for o in s.orders:
                    if o.status != OrderStatus.CANCELLED.value:
                        for itm in o.items:
                            total_spent += itm.unit_price * Decimal(str(itm.quantity))

        out.append(
            CustomerProfileResponse(
                id=str(u.id),
                name=u.name,
                phone=u.phone,
                visit_count=max(visit_count, 1),
                last_visit=last_visit_str or u.created_at.strftime("%d %b, %I:%M %p"),
                total_spent=float(total_spent),
                notes="Registered Gamer",
            )
        )

    # Capture walk-in customers with distinct phone numbers not yet registered
    for phone, s_list in sessions_by_phone.items():
        if phone in seen_phones or len(phone) < 10:
            continue
        name = s_list[0].customer_name or "Walk-in Gamer"
        total_spent = Decimal("0.00")
        for s in s_list:
            if s.total_amount:
                total_spent += s.total_amount
            for o in s.orders:
                if o.status != OrderStatus.CANCELLED.value:
                    for itm in o.items:
                        total_spent += itm.unit_price * Decimal(str(itm.quantity))
        sorted_walkin = sorted(s_list, key=lambda s: s.started_at, reverse=True)
        last_visit_str = sorted_walkin[0].started_at.strftime("%d %b, %I:%M %p")

        out.append(
            CustomerProfileResponse(
                id=f"walkin_{phone}",
                name=name,
                phone=phone,
                visit_count=len(s_list),
                last_visit=last_visit_str,
                total_spent=float(total_spent),
                notes="Walk-in Guest",
            )
        )

    return out


# ---------------------------------------------------------------------------
# Real-time Financial & Revenue Analytics (Direct Database Aggregation)
# ---------------------------------------------------------------------------

@router.get("/analytics/revenue")
async def get_revenue_analytics(
    period: str = "DAY",  # DAY, WEEK, MONTH
    db: AsyncSession = Depends(get_db),
):
    """
    Computes real-time revenue analytics directly from database sessions, payments, and orders.
    Zero localStorage or mock data.
    """
    now = datetime.now(timezone.utc)
    if period.upper() == "DAY":
        cutoff = now.replace(hour=0, minute=0, second=0, microsecond=0)
        days_to_show = 1
    elif period.upper() == "WEEK":
        cutoff = now - timedelta(days=7)
        days_to_show = 7
    else:
        cutoff = now - timedelta(days=30)
        days_to_show = 14

    stmt = (
        select(Session)
        .where(Session.started_at >= cutoff)
        .options(
            selectinload(Session.orders).selectinload(Order.items).selectinload(OrderItem.menu_item),
            selectinload(Session.payments),
        )
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()

    total_revenue = Decimal("0.00")
    gaming_revenue = Decimal("0.00")
    food_revenue = Decimal("0.00")
    sessions_count = len(sessions)
    item_counts: dict[str, int] = defaultdict(int)

    daily_stats: dict[str, dict[str, Decimal]] = defaultdict(
        lambda: {"total": Decimal("0.00"), "gaming": Decimal("0.00"), "food": Decimal("0.00")}
    )

    for s in sessions:
        started_at = ensure_utc(s.started_at)
        day_key = started_at.strftime("%Y-%m-%d")

        s_time_charge = s.total_amount or Decimal("0.00")
        s_food_charge = Decimal("0.00")
        for o in s.orders:
            if o.status != OrderStatus.CANCELLED.value:
                for itm in o.items:
                    s_food_charge += itm.unit_price * Decimal(str(itm.quantity))
                    name = itm.menu_item.name if itm.menu_item else "Item"
                    item_counts[name] += itm.quantity

        s_total = s_time_charge + s_food_charge

        gaming_revenue += s_time_charge
        food_revenue += s_food_charge
        total_revenue += s_total

        daily_stats[day_key]["gaming"] += s_time_charge
        daily_stats[day_key]["food"] += s_food_charge
        daily_stats[day_key]["total"] += s_total

    average_session_bill = (
        float(total_revenue / Decimal(str(sessions_count))) if sessions_count > 0 else 0.0
    )

    top_item = "None"
    if item_counts:
        top_item = max(item_counts.items(), key=lambda x: x[1])[0]

    chart_data = []
    for i in range(days_to_show - 1, -1, -1):
        d = now - timedelta(days=i)
        d_key = d.strftime("%Y-%m-%d")
        label = d.strftime("%a, %b %d") if days_to_show > 1 else "Today"
        day_stat = daily_stats.get(d_key, {"total": Decimal("0.00"), "gaming": Decimal("0.00"), "food": Decimal("0.00")})
        chart_data.append({
            "label": label,
            "total": float(day_stat["total"]),
            "gaming": float(day_stat["gaming"]),
            "food": float(day_stat["food"]),
        })

    return {
        "totalRevenue": float(total_revenue),
        "gamingRevenue": float(gaming_revenue),
        "foodRevenue": float(food_revenue),
        "sessionsCount": sessions_count,
        "averageSessionBill": round(average_session_bill, 2),
        "topSellingItem": top_item,
        "chartData": chart_data,
    }

