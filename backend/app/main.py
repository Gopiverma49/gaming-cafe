from contextlib import asynccontextmanager
from decimal import Decimal
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.core.config import settings
from app.core.database import engine, Base, async_session_factory
from app.core.security import get_password_hash
from app.models.entities import Station, MenuItem, Session, User
from app.api.deps import IdempotencyMiddleware
from app.api.v1.admin_routes import router as admin_router
from app.api.v1.customer_routes import router as customer_router
from app.api.v1.auth_routes import router as auth_router
from app.services.ws_notifier import manager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("main")


async def seed_initial_data():
    """Seeds starter gaming stations, admin user, and menu items with inventory stock."""
    async with async_session_factory() as db:
        from sqlalchemy import text
        # Safe schema column additions for local SQLite / PostgreSQL
        migration_stmts = [
            "ALTER TABLE stations ADD COLUMN pricing_tiers JSON",
            "ALTER TABLE menu_items ADD COLUMN stock INTEGER DEFAULT 50",
            "ALTER TABLE menu_items ADD COLUMN min_stock_alert INTEGER DEFAULT 10",
            "ALTER TABLE sessions ADD COLUMN customer_name VARCHAR(100)",
            "ALTER TABLE sessions ADD COLUMN customer_phone VARCHAR(20)",
            "ALTER TABLE sessions ADD COLUMN user_id VARCHAR(36)",
            "ALTER TABLE orders ADD COLUMN customer_name VARCHAR(100)",
        ]
        for stmt_str in migration_stmts:
            try:
                await db.execute(text(stmt_str))
                await db.commit()
            except Exception:
                await db.rollback()

        # Seed default Admin User if none exists
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

        stations_res = await db.execute(select(Station))
        current_stations = stations_res.scalars().all()
        station_names = {s.name for s in current_stations}

        default_tiers = [
            {"duration_min": 30, "price": 100, "label": "30 mins"},
            {"duration_min": 60, "price": 180, "label": "1 hr"},
            {"duration_min": 120, "price": 320, "label": "2 hrs"},
        ]

        # Only seed default stations if the DB has NO stations at all.
        # NEVER wipe stations — user-created stations must be preserved.
        if not current_stations:
            logger.info("No stations found. Seeding default PS1, PS2, PS3 gaming stations...")
            sample_stations = [
                Station(name="PS1", tier="CONSOLE", hourly_rate=Decimal("180.00"), pricing_tiers=default_tiers, status="AVAILABLE"),
                Station(name="PS2", tier="CONSOLE", hourly_rate=Decimal("180.00"), pricing_tiers=default_tiers, status="AVAILABLE"),
                Station(name="PS3", tier="CONSOLE", hourly_rate=Decimal("180.00"), pricing_tiers=default_tiers, status="AVAILABLE"),
            ]
            db.add_all(sample_stations)
            await db.commit()
        else:
            # Add any missing default stations without touching existing ones
            default_station_names = {"PS1", "PS2", "PS3"}
            missing_names = default_station_names - station_names
            if missing_names:
                logger.info(f"Adding missing default stations: {missing_names}")
                for name in sorted(missing_names):
                    db.add(Station(name=name, tier="CONSOLE", hourly_rate=Decimal("180.00"), pricing_tiers=default_tiers, status="AVAILABLE"))
                await db.commit()

            # Backfill pricing_tiers for any station that still lacks them
            for s in current_stations:
                if not s.pricing_tiers:
                    s.pricing_tiers = [
                        {"duration_min": 30, "price": round(float(s.hourly_rate) * 0.6, 2), "label": "30 mins"},
                        {"duration_min": 60, "price": float(s.hourly_rate), "label": "1 hr"},
                        {"duration_min": 120, "price": round(float(s.hourly_rate) * 1.8, 2), "label": "2 hrs"},
                    ]
            await db.commit()

        menu_res = await db.execute(select(MenuItem))
        if not menu_res.scalars().first():
            logger.info("Seeding cafe menu items with stock levels...")
            sample_menu = [
                MenuItem(name="Monster Energy (Original)", category="Drinks", price=Decimal("140.00"), stock=30, min_stock_alert=5, is_available=True),
                MenuItem(name="Red Bull Classic 250ml", category="Drinks", price=Decimal("160.00"), stock=25, min_stock_alert=5, is_available=True),
                MenuItem(name="Cold Brew Iced Coffee", category="Drinks", price=Decimal("110.00"), stock=20, min_stock_alert=5, is_available=True),
                MenuItem(name="Mountain Dew Game Fuel", category="Drinks", price=Decimal("80.00"), stock=40, min_stock_alert=8, is_available=True),
                MenuItem(name="Crispy Peri-Peri Fries", category="Food", price=Decimal("150.00"), stock=25, min_stock_alert=5, is_available=True),
                MenuItem(name="Double Smash Cheeseburger", category="Food", price=Decimal("280.00"), stock=15, min_stock_alert=3, is_available=True),
                MenuItem(name="Classic Pepperoni Pizza Pocket", category="Food", price=Decimal("220.00"), stock=18, min_stock_alert=4, is_available=True),
                MenuItem(name="Korean Spicy Chicken Wings", category="Food", price=Decimal("290.00"), stock=12, min_stock_alert=3, is_available=True),
                MenuItem(name="Nacho Chips & Warm Cheese Dip", category="Food", price=Decimal("170.00"), stock=22, min_stock_alert=5, is_available=True),
            ]
            db.add_all(sample_menu)
            await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Gaming Cafe Operations System...")
    # Initialize tables if running without migrations
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await seed_initial_data()
    yield
    logger.info("Shutting down Gaming Cafe Operations System...")
    await engine.dispose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
)

# Cross-Origin Resource Sharing
cors_origins = settings.cors_origin_list
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True if cors_origins != ["*"] else False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Idempotency Middleware for POST and PATCH
app.add_middleware(IdempotencyMiddleware)

# Mount API Routers
app.include_router(auth_router, prefix=settings.API_V1_STR)
app.include_router(admin_router, prefix=settings.API_V1_STR)
app.include_router(customer_router, prefix=settings.API_V1_STR)


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
