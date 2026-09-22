from contextlib import asynccontextmanager
from decimal import Decimal
import logging
import re
from typing import List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import engine, Base, async_session_factory
from app.core.security import get_password_hash
from app.models.entities import Station, Session, User, PhysicalDevice
from app.models.enums import StationStatus, SessionStatus
from app.api.deps import IdempotencyMiddleware, get_db, get_optional_auth_user
from app.api.v1.admin_routes import router as admin_router
from app.api.v1.customer_routes import router as customer_router
from app.api.v1.auth_routes import router as auth_router
from app.schemas.api_schemas import CategoryAvailabilityResponse, SessionStartRequest, SessionResponse
from app.services.session_service import get_fleet_categories, start_category_session
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
        from sqlalchemy import text
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
                "hourly_rate": Decimal("180.00"),
                "pricing_tiers": [
                    {"duration_min": 30, "price": 100, "label": "30 mins"},
                    {"duration_min": 60, "price": 180, "label": "1 hr"},
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
        ]

        # Fetch all existing stations
        all_stations_res = await db.execute(select(Station))
        existing_stations = all_stations_res.scalars().all()
        station_map = {st.name.lower(): st for st in existing_stations}

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

        await db.commit()
        logger.info("Canonical domain hierarchy & device registry successfully synchronized.")


async def seed_initial_data():
    """
    Manual seeder function — ONLY executed when explicitly requested by user or tests.
    Never run automatically on application startup.
    """
    async with async_session_factory() as db:
        admin_res = await db.execute(select(User).where(User.role == "ADMIN"))
        if not admin_res.scalar_one_or_none():
            logger.info("Seeding default Administrator account...")
            admin_user = User(
                name="System Administrator",
                phone="0000000000",
                password_hash=get_password_hash(settings.ADMIN_PASSWORD),
                role="ADMIN",
            )
            db.add(admin_user)
            await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
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

_CORS_ALLOW_HEADERS = "Authorization, Content-Type, X-Idempotency-Key, Accept"
_CORS_ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS"


class TunnelAwareCORSMiddleware(BaseHTTPMiddleware):
    """CORS middleware that accepts wildcard tunnel origins (trycloudflare.com, ngrok)
    as well as any explicit origins listed in CORS_ORIGINS env var."""

    def __init__(self, app, explicit_origins: list[str]):
        super().__init__(app)
        # Pre-build a set for O(1) exact-match lookups (e.g. when operator sets specific domains)
        self._explicit = set(o.strip().rstrip("/") for o in explicit_origins if o != "*")
        self._allow_all = "*" in explicit_origins

    def _is_allowed(self, origin: str) -> bool:
        if self._allow_all:
            return True
        if origin in self._explicit:
            return True
        return bool(_TUNNEL_ORIGIN_PATTERNS.match(origin))

    async def dispatch(self, request: Request, call_next) -> Response:
        origin = request.headers.get("origin", "")
        allowed = self._is_allowed(origin) if origin else False

        # Handle pre-flight OPTIONS immediately — FastAPI never sees it
        if request.method == "OPTIONS" and allowed:
            return Response(
                status_code=204,
                headers={
                    "Access-Control-Allow-Origin": origin,
                    "Access-Control-Allow-Credentials": "true",
                    "Access-Control-Allow-Methods": _CORS_ALLOW_METHODS,
                    "Access-Control-Allow-Headers": _CORS_ALLOW_HEADERS,
                    "Access-Control-Max-Age": "86400",
                },
            )

        response: Response = await call_next(request)

        if allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = _CORS_ALLOW_METHODS
            response.headers["Access-Control-Allow-Headers"] = _CORS_ALLOW_HEADERS

        return response


app.add_middleware(TunnelAwareCORSMiddleware, explicit_origins=settings.cors_origin_list)

# Idempotency Middleware for POST and PATCH
app.add_middleware(IdempotencyMiddleware)

# Mount API Routers
app.include_router(auth_router, prefix=settings.API_V1_STR)
app.include_router(admin_router, prefix=settings.API_V1_STR)
app.include_router(customer_router, prefix=settings.API_V1_STR)


@app.get("/api/fleet/categories", response_model=List[CategoryAvailabilityResponse], tags=["Fleet Categories"])
@app.get("/api/v1/fleet/categories", response_model=List[CategoryAvailabilityResponse], tags=["Fleet Categories"])
async def public_fleet_categories(db: AsyncSession = Depends(get_db)):
    return await get_fleet_categories(db)


@app.post("/api/sessions/start", response_model=SessionResponse, status_code=status.HTTP_201_CREATED, tags=["Fleet Categories"])
@app.post("/api/v1/sessions/start", response_model=SessionResponse, status_code=status.HTTP_201_CREATED, tags=["Fleet Categories"])
async def public_start_session(
    payload: SessionStartRequest,
    auth_user: Optional[User] = Depends(get_optional_auth_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = auth_user.id if auth_user else (payload.user_id or None)
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


@app.get("/health", tags=["Health"])
async def health_check():
    return {
        "status": "healthy",
        "system": "Gaming Cafe Operations & Financial Management System",
        "version": settings.VERSION,
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
        await manager.disconnect(websocket, channel)
    except Exception as exc:
        logger.warning(f"WebSocket exception on {channel}: {exc}")
        await manager.disconnect(websocket, channel)
