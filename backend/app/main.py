from contextlib import asynccontextmanager
from datetime import datetime, timezone
from decimal import Decimal
import logging
import re
import time
from typing import List, Optional

BOOT_TIME = time.time()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import engine, Base, async_session_factory
from app.core.rate_limiter import RateLimiter
from app.models.entities import Station, Session, User, PhysicalDevice, MenuItem
from app.models.enums import StationStatus, SessionStatus
from app.api.deps import IdempotencyMiddleware, get_db, get_optional_auth_user
from app.api.v1.admin_routes import router as admin_router, admin_check_in
from app.api.v1.customer_routes import router as customer_router
from app.api.v1.auth_routes import router as auth_router
from app.api.v1.booking_routes import router as booking_router, create_advance_booking, BookingPayload
from app.api.v1.payment_routes import router as payment_router
from app.schemas.api_schemas import (
    CategoryAvailabilityResponse,
    SessionStartRequest,
    SessionResponse,
    StationMatrixResponse,
    CheckInRequest,
)
from app.services.session_service import get_fleet_categories, start_category_session, get_fleet_matrix
from app.services.ws_notifier import manager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("main")


async def run_schema_migrations():
    """Safe schema column additions for local SQLite / PostgreSQL without wiping or seeding."""
    async with async_session_factory() as db:
        migration_stmts = [
            "ALTER TABLE stations ADD COLUMN pricing_tiers JSON",
            "ALTER TABLE menu_items ADD COLUMN stock INTEGER DEFAULT 50",
            "ALTER TABLE menu_items ADD COLUMN min_stock_alert INTEGER DEFAULT 10",
            "ALTER TABLE sessions ADD COLUMN customer_name VARCHAR(100)",
            "ALTER TABLE sessions ADD COLUMN customer_phone VARCHAR(20)",
            "ALTER TABLE sessions ADD COLUMN user_id VARCHAR(36)",
            "ALTER TABLE sessions ADD COLUMN allocated_minutes INTEGER DEFAULT 60",
            "ALTER TABLE sessions ADD COLUMN tier_price NUMERIC(10, 2)",
            "ALTER TABLE sessions ADD COLUMN category_id VARCHAR(50)",
            "ALTER TABLE sessions ADD COLUMN device_name VARCHAR(50)",
            "ALTER TABLE sessions ADD COLUMN station_name VARCHAR(50)",
            "ALTER TABLE sessions ADD COLUMN console_room VARCHAR(50)",
            "ALTER TABLE orders ADD COLUMN customer_name VARCHAR(100)",
            "DROP INDEX IF EXISTS uq_active_station_session",
            "CREATE TABLE IF NOT EXISTS advance_bookings ("
            "  id VARCHAR(50) PRIMARY KEY,"
            "  customer_name VARCHAR(100) NOT NULL,"
            "  phone_number VARCHAR(20),"
            "  station_id VARCHAR(50) NOT NULL,"
            "  session_mode VARCHAR(50) DEFAULT 'Solo' NOT NULL,"
            "  booking_date VARCHAR(20) NOT NULL,"
            "  start_time VARCHAR(10) NOT NULL,"
            "  duration_minutes INTEGER DEFAULT 60 NOT NULL,"
            "  end_time VARCHAR(10) NOT NULL,"
            "  advance_paid NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,"
            "  total_amount NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,"
            "  remaining_balance NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,"
            "  status VARCHAR(20) DEFAULT 'CONFIRMED' NOT NULL,"
            "  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL"
            ")",
        ]
        for stmt_str in migration_stmts:
            try:
                await db.execute(text(stmt_str))
                await db.commit()
            except Exception as exc:
                await db.rollback()
                logger.debug(f"Migration statement skipped or already applied: {stmt_str} ({exc})")


async def ensure_canonical_domain_hierarchy():
    """
    Enforces the permanent, rock-solid domain hierarchy:
    1. Top-Level Stations: Exactly four primary stations:
       - 'Solo'
       - 'Multiplayer'
       - 'Car Simulator'
       - 'VR'
    2. Physical Console Rooms (Hardware Allocation):
       - 'PS1'
       - 'PS2'
       - 'PS3'
       - 'VR1'
    Auto-heals rogue records (e.g. pseudo-station 'PS3' or misspelled 'multiplyer')
    so that lookup errors never recur.
    """
    async with async_session_factory() as db:
        logger.info("Verifying canonical domain hierarchy and physical device registry...")

        # 1. Registered Physical Consoles
        canonical_consoles = [
            {"id": "PS1", "name": "PS1", "device_type": "CONSOLE"},
            {"id": "PS2", "name": "PS2", "device_type": "CONSOLE"},
            {"id": "PS3", "name": "PS3", "device_type": "CONSOLE"},
            {"id": "VR1", "name": "VR1", "device_type": "VR"},
        ]
        for dev_data in canonical_consoles:
            existing_dev = await db.get(PhysicalDevice, dev_data["id"])
            if not existing_dev:
                db.add(PhysicalDevice(**dev_data, status=StationStatus.AVAILABLE.value))

        # 2. Canonical Top-Level Stations Specs
        canonical_stations = [
            {
                "name": "Solo",
                "tier": "CONSOLE",
                "hourly_rate": Decimal(str(settings.DEFAULT_HOURLY_RATE)),
                "pricing_tiers": [
                    {"duration_min": 30, "price": 100, "label": "30 mins"},
                    {"duration_min": 60, "price": settings.DEFAULT_HOURLY_RATE, "label": "1 hr"},
                    {"duration_min": 120, "price": 320, "label": "2 hrs"},
                ],
            },
            {
                "name": "Multiplayer",
                "tier": "CONSOLE",
                "hourly_rate": Decimal("220.00"),
                "pricing_tiers": [
                    {"duration_min": 30, "price": 120, "label": "30 mins"},
                    {"duration_min": 60, "price": 220, "label": "1 hr"},
                    {"duration_min": 120, "price": 390, "label": "2 hrs"},
                ],
            },
            {
                "name": "Car Simulator",
                "tier": "SIMULATOR",
                "hourly_rate": Decimal("250.00"),
                "pricing_tiers": [
                    {"duration_min": 30, "price": 140, "label": "30 mins"},
                    {"duration_min": 60, "price": 250, "label": "1 hr"},
                    {"duration_min": 120, "price": 450, "label": "2 hrs"},
                ],
            },
            {
                "name": "VR",
                "tier": "VR",
                "hourly_rate": Decimal("300.00"),
                "pricing_tiers": [
                    {"duration_min": 30, "price": 160, "label": "30 mins"},
                    {"duration_min": 60, "price": 300, "label": "1 hr"},
                    {"duration_min": 120, "price": 520, "label": "2 hrs"},
                ],
            },
            {
                "name": "Walk-in CAFE",
                "tier": "CAFE",
                "hourly_rate": Decimal("0.00"),
                "pricing_tiers": [],
            },
        ]

        # Fetch all existing stations
        all_stations_res = await db.execute(select(Station))
        existing_stations = all_stations_res.scalars().all()

        # Fix spelling / naming variations
        for st in existing_stations:
            if st.name.lower() in ("multiplyer", "multi-player"):
                st.name = "Multiplayer"
            elif st.name.lower() == "car simulator" and st.name != "Car Simulator":
                st.name = "Car Simulator"
            elif st.name.lower() in ("vr simulator", "vr-sim") and st.name != "VR":
                st.name = "VR"

        # Ensure all 4 canonical stations exist
        created_or_found_canonical: dict[str, Station] = {}
        for st_cfg in canonical_stations:
            lower_name = st_cfg["name"].lower()
            match = next((s for s in existing_stations if s.name.lower() == lower_name), None)
            if not match:
                new_st = Station(
                    name=st_cfg["name"],
                    tier=st_cfg["tier"],
                    hourly_rate=st_cfg["hourly_rate"],
                    pricing_tiers=st_cfg["pricing_tiers"],
                    status=StationStatus.AVAILABLE.value,
                )
                db.add(new_st)
                await db.flush()
                created_or_found_canonical[st_cfg["name"]] = new_st
            else:
                created_or_found_canonical[st_cfg["name"]] = match

        # Re-map sessions from rogue pseudo-stations (e.g. 'PS1', 'PS2', 'PS3', 'VR1')
        rogue_names = {"ps1", "ps2", "ps3", "vr1"}
        for st in existing_stations:
            if st.name.lower() in rogue_names:
                # Find all sessions linked to this pseudo-station
                sess_res = await db.execute(select(Session).where(Session.station_id == st.id))
                linked_sessions = sess_res.scalars().all()
                for sess in linked_sessions:
                    # Determine appropriate canonical station
                    target_canonical_name = "Solo"
                    if sess.category_id in ("car_sim", "car simulator") or st.name.upper() == "PS3":
                        target_canonical_name = "Car Simulator"
                    elif sess.category_id in ("vr_sim", "vr") or st.name.upper() == "VR1":
                        target_canonical_name = "VR"
                    elif sess.category_id == "multiplayer":
                        target_canonical_name = "Multiplayer"

                    canon_st = created_or_found_canonical.get(target_canonical_name)
                    if canon_st:
                        sess.station_id = canon_st.id
                        sess.station_name = canon_st.name
                        if not sess.device_name:
                            sess.device_name = st.name.upper()
                        if not sess.console_room:
                            sess.console_room = st.name.upper()

                # Clean up the rogue station row
                await db.delete(st)

        # Synchronize physical device occupancy and station status from active sessions
        active_sess_res = await db.execute(select(Session).where(Session.status == SessionStatus.ACTIVE.value))
        active_sessions = active_sess_res.scalars().all()
        active_device_map = {s.device_name.upper(): s for s in active_sessions if s.device_name}
        active_station_ids = {s.station_id for s in active_sessions}

        for dev_id in ["PS1", "PS2", "PS3", "VR1"]:
            pdev = await db.get(PhysicalDevice, dev_id)
            if pdev:
                active_s = active_device_map.get(dev_id)
                if active_s:
                    pdev.status = StationStatus.OCCUPIED.value
                    pdev.current_session_id = active_s.id
                else:
                    pdev.status = StationStatus.AVAILABLE.value
                    pdev.current_session_id = None

        for canon_st in created_or_found_canonical.values():
            if canon_st.id in active_station_ids:
                canon_st.status = StationStatus.OCCUPIED.value
            else:
                canon_st.status = StationStatus.AVAILABLE.value

        # Auto-seed initial menu items if menu table is empty (e.g. brand new database)
        menu_exists = (await db.execute(select(MenuItem).limit(1))).scalar_one_or_none()
        if not menu_exists:
            logger.info("Initializing default cafe menu items in database...")
            default_menu = [
                {"name": "Cold Coffee Frappe", "category": "Drinks", "price": Decimal("120.00"), "stock": 50},
                {"name": "Loaded Nachos Supreme", "category": "Snacks", "price": Decimal("180.00"), "stock": 50},
                {"name": "Peri-Peri French Fries", "category": "Snacks", "price": Decimal("110.00"), "stock": 50},
                {"name": "Red Bull Energy Can", "category": "Drinks", "price": Decimal("160.00"), "stock": 50},
                {"name": "Gourmet Veg Burger", "category": "Meals", "price": Decimal("150.00"), "stock": 50},
                {"name": "Crispy Chicken Burger", "category": "Meals", "price": Decimal("190.00"), "stock": 50},
                {"name": 'Paneer Tikka Pizza (7")', "category": "Meals", "price": Decimal("220.00"), "stock": 50},
                {"name": "Iced Lemon Mint Tea", "category": "Drinks", "price": Decimal("90.00"), "stock": 50},
                {"name": "Gamer Combo: Burger + Fries + Cola", "category": "Combos", "price": Decimal("270.00"), "stock": 50},
            ]
            for itm in default_menu:
                db.add(MenuItem(**itm, min_stock_alert=10, is_available=True))

        await db.commit()
        logger.info("Canonical domain hierarchy & device registry successfully synchronized.")




@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail-fast validation of production environment variables
    settings.validate_production_config()
    logger.info("Starting Gaming Cafe Operations System...")
    # Initialize tables if running without migrations
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Run safe schema migrations (column additions).
    await run_schema_migrations()
    # Enforce canonical stations and device registry
    await ensure_canonical_domain_hierarchy()
    yield
    logger.info("Shutting down Gaming Cafe Operations System...")
    await engine.dispose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
)

# ─────────────────────────────────────────────────────────────────────────────
# Regex-aware CORS middleware
# Allows:
#   • Any *.trycloudflare.com  (Cloudflare Quick Tunnels)
#   • Any *.ngrok-free.app     (ngrok free tier)
#   • Any *.ngrok.io            (ngrok paid)
#   • http(s)://localhost:*     (local dev)
#   • http(s)://127.0.0.1:*    (local dev)
#   • http(s)://172.16.*.*:*   (LAN Wi-Fi)
#   • Plus any explicit origins from CORS_ORIGINS env var
# ─────────────────────────────────────────────────────────────────────────────
_TUNNEL_ORIGIN_PATTERNS = re.compile(
    r"^https?://"
    r"("  
    r"[a-zA-Z0-9-]+\.trycloudflare\.com"         # Cloudflare quick tunnels
    r"|[a-zA-Z0-9-]+\.ngrok-free\.app"            # ngrok free
    r"|[a-zA-Z0-9-]+\.ngrok\.io"                  # ngrok paid
    r"|localhost(:[0-9]+)?"                        # localhost any port
    r"|127\.0\.0\.1(:[0-9]+)?"                    # loopback
    r"|172\.16\.[0-9]+\.[0-9]+(:[0-9]+)?"         # LAN 172.16.x.x
    r"|192\.168\.[0-9]+\.[0-9]+(:[0-9]+)?"        # LAN 192.168.x.x
    r")$"
)

_CORS_ALLOW_HEADERS = "Authorization, Content-Type, Idempotency-Key, X-Idempotency-Key, Accept, Origin, X-Requested-With"
_CORS_ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS"


class TunnelAwareCORSMiddleware(BaseHTTPMiddleware):
    """CORS middleware that validates authorized origins with strict dynamic enforcement
    in production while supporting local development and secure tunnels."""

    def __init__(self, app, explicit_origins: list[str]):
        super().__init__(app)
        # Pre-build a set for O(1) exact-match lookups
        self._explicit = set(o.strip().rstrip("/") for o in explicit_origins if o != "*")
        # In production, wildcards are strictly disallowed
        self._allow_all = ("*" in explicit_origins) and (not settings.is_production)

    def _is_allowed(self, origin: str) -> bool:
        if not origin:
            return False
        clean_origin = origin.strip().rstrip("/")
        if clean_origin in self._explicit:
            return True
        if settings.is_production:
            return False
        if self._allow_all:
            return True
        return bool(_TUNNEL_ORIGIN_PATTERNS.match(clean_origin))

    async def dispatch(self, request: Request, call_next) -> Response:
        origin = request.headers.get("origin", "")
        allowed = self._is_allowed(origin) if origin else False

        # In production, immediately reject unauthorized cross-origin state mutations
        if origin and not allowed and settings.is_production and request.method in ("POST", "PUT", "PATCH", "DELETE"):
            return Response(
                status_code=403,
                content='{"detail":"CORS origin forbidden in production"}',
                media_type="application/json",
            )

        # Handle pre-flight OPTIONS immediately — FastAPI never sees it
        if request.method == "OPTIONS":
            if allowed:
                req_headers = request.headers.get("access-control-request-headers")
                allow_headers = req_headers if req_headers else _CORS_ALLOW_HEADERS
                return Response(
                    status_code=204,
                    headers={
                        "Access-Control-Allow-Origin": origin,
                        "Access-Control-Allow-Credentials": "true",
                        "Access-Control-Allow-Methods": _CORS_ALLOW_METHODS,
                        "Access-Control-Allow-Headers": allow_headers,
                        "Access-Control-Max-Age": "86400",
                    },
                )
            elif settings.is_production and origin:
                return Response(
                    status_code=403,
                    content='{"detail":"CORS origin forbidden"}',
                    media_type="application/json",
                )

        response: Response = await call_next(request)

        if allowed:
            req_headers = request.headers.get("access-control-request-headers")
            allow_headers = req_headers if req_headers else _CORS_ALLOW_HEADERS
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = _CORS_ALLOW_METHODS
            response.headers["Access-Control-Allow-Headers"] = allow_headers

        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Enforces enterprise security headers across all API responses."""
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com data:; "
            "img-src 'self' data: blob: https:; "
            "connect-src 'self' ws: wss: http: https:; "
            "frame-ancestors 'self';"
        )
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
        return response


app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(TunnelAwareCORSMiddleware, explicit_origins=settings.cors_origin_list)

# Idempotency Middleware for POST and PATCH
app.add_middleware(IdempotencyMiddleware)

# Mount API Routers
app.include_router(auth_router, prefix=settings.API_V1_STR)
app.include_router(admin_router, prefix=settings.API_V1_STR)
app.include_router(customer_router, prefix=settings.API_V1_STR)
app.include_router(booking_router, prefix=settings.API_V1_STR)
app.include_router(payment_router, prefix=settings.API_V1_STR)


# ─────────────────────────────────────────────────────────────────────────────
# Unified API Error Handling
# ─────────────────────────────────────────────────────────────────────
@app.exception_handler(StarletteHTTPException)
async def unified_http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.detail,
            "code": "HTTP_ERROR",
            "status": exc.status_code,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def unified_validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": "Request validation failed. Please check your input parameters.",
            "errors": exc.errors(),
            "code": "VALIDATION_ERROR",
            "status": 422,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


@app.exception_handler(Exception)
async def unified_unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled server exception on %s: %s", request.url.path, exc, exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "An internal server error occurred.",
            "code": "INTERNAL_SERVER_ERROR",
            "status": 500,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


@app.get("/api/v1/fleet/categories", response_model=List[CategoryAvailabilityResponse], tags=["Fleet Categories"])
async def public_fleet_categories(db: AsyncSession = Depends(get_db)):
    return await get_fleet_categories(db)


@app.get("/api/v1/fleet/matrix", response_model=StationMatrixResponse, tags=["Fleet Categories"])
async def public_fleet_matrix(db: AsyncSession = Depends(get_db)):
    return await get_fleet_matrix(db)


@app.post(
    "/api/v1/sessions/start",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Fleet Categories"],
    dependencies=[Depends(RateLimiter(max_requests=30, window_seconds=60, scope="session_start"))],
)
async def public_start_session(
    payload: SessionStartRequest,
    auth_user: Optional[User] = Depends(get_optional_auth_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = auth_user.id if auth_user else (payload.user_id or None)
    customer_name = payload.customer_name or (auth_user.name if auth_user else "Gamer")
    customer_phone = payload.customer_phone or (auth_user.phone if auth_user else None)
    cat_id = payload.category_id or payload.mode or "solo"
    dev_id = payload.device_id or payload.station_id

    return await start_category_session(
        db=db,
        category_id=cat_id,
        device_id=dev_id,
        duration_minutes=payload.duration_minutes,
        customer_name=customer_name,
        customer_phone=customer_phone,
        user_id=user_id,
        tier_price=payload.tier_price,
    )


@app.post(
    "/api/station/checkin",
    tags=["Station Check-in"],
)
@app.post(
    "/api/v1/station/checkin",
    tags=["Station Check-in"],
)
async def public_station_checkin(
    payload: CheckInRequest,
    db: AsyncSession = Depends(get_db),
):
    return await admin_check_in(payload=payload, db=db)


@app.post(
    "/api/bookings/create",
    status_code=status.HTTP_201_CREATED,
    tags=["Advance Bookings"],
)
@app.post(
    "/api/v1/bookings/create",
    status_code=status.HTTP_201_CREATED,
    tags=["Advance Bookings"],
)
async def public_booking_create(
    payload: BookingPayload,
    db: AsyncSession = Depends(get_db),
):
    return await create_advance_booking(payload=payload, db=db)



@app.get("/health", tags=["Health"])
@app.get("/api/health", tags=["Health"])
async def health_check(db: AsyncSession = Depends(get_db)):
    is_healthy = True
    db_status = "connected"
    try:
        await db.execute(select(1))
    except Exception as exc:
        logger.error(f"Database health check failed: {exc}")
        is_healthy = False
        db_status = "degraded"

    uptime_sec = round(time.time() - BOOT_TIME, 2)
    timestamp_utc = datetime.now(timezone.utc).isoformat()

    return {
        "status": "ok" if is_healthy else "degraded",
        "uptime": uptime_sec,
        "timestamp": timestamp_utc,
        "dbStatus": db_status,
        "database": "healthy" if is_healthy else "unreachable",
        "system": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "environment": settings.NODE_ENV,
    }


# Native WebSocket route for real-time channels
@app.websocket("/ws/{channel}")
async def websocket_endpoint(websocket: WebSocket, channel: str):
    """
    Subscribes to partitioned real-time channel:
    e.g. 'admin', 'customer:{desk_id}'
    """
    await manager.connect(websocket, channel)
    try:
        while True:
            # Keep-alive ping / echo
            await websocket.receive_text()
            # Send acknowledgement
            await websocket.send_text(f'{{"type":"PONG","channel":"{channel}"}}')
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning(f"WebSocket exception on {channel}: {exc}")
    finally:
        await manager.disconnect(websocket, channel)
