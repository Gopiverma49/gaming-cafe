import sys
from contextlib import asynccontextmanager
from decimal import Decimal
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.core.config import settings
from app.core.database import engine, Base, async_session_factory
from app.models.entities import Station, MenuItem
from app.api.deps import IdempotencyMiddleware
from app.api.v1.admin_routes import router as admin_router
from app.api.v1.customer_routes import router as customer_router
from app.services.ws_notifier import manager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("main")


async def seed_initial_data():
    """Seeds starter gaming stations and menu items if database is empty."""
    async with async_session_factory() as db:
        stations_res = await db.execute(select(Station))
        if not stations_res.scalars().first():
            logger.info("Seeding initial gaming stations...")
            sample_stations = [
                Station(name="RIG-01 (RTX 4090)", tier="VIP", hourly_rate=Decimal("250.00"), status="AVAILABLE"),
                Station(name="RIG-02 (RTX 4090)", tier="VIP", hourly_rate=Decimal("250.00"), status="AVAILABLE"),
                Station(name="RIG-03 (RTX 4080)", tier="STANDARD", hourly_rate=Decimal("150.00"), status="AVAILABLE"),
                Station(name="RIG-04 (RTX 4080)", tier="STANDARD", hourly_rate=Decimal("150.00"), status="AVAILABLE"),
                Station(name="SIM-01 (Moza R9)", tier="SIMULATOR", hourly_rate=Decimal("350.00"), status="AVAILABLE"),
                Station(name="SIM-02 (Flight Sim)", tier="SIMULATOR", hourly_rate=Decimal("400.00"), status="AVAILABLE"),
                Station(name="PS5-01 (OLED 65\")", tier="CONSOLE", hourly_rate=Decimal("180.00"), status="AVAILABLE"),
                Station(name="PS5-02 (OLED 65\")", tier="CONSOLE", hourly_rate=Decimal("180.00"), status="AVAILABLE"),
            ]
            db.add_all(sample_stations)

        menu_res = await db.execute(select(MenuItem))
        if not menu_res.scalars().first():
            logger.info("Seeding cafe menu items...")
            sample_menu = [
                MenuItem(name="Cyber Glitch Monster Energy", category="Beverages", price=Decimal("160.00"), is_available=True),
                MenuItem(name="Matcha Mint Cold Brew", category="Beverages", price=Decimal("140.00"), is_available=True),
                MenuItem(name="Overclocked Smash Burger", category="Food", price=Decimal("280.00"), is_available=True),
                MenuItem(name="Spicy Peri-Peri Waffle Fries", category="Food", price=Decimal("180.00"), is_available=True),
                MenuItem(name="Loaded Cheesy Nachos Supreme", category="Food", price=Decimal("220.00"), is_available=True),
                MenuItem(name="Boba Taro Blast", category="Beverages", price=Decimal("170.00"), is_available=True),
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
            data = await websocket.receive_text()
            # Send acknowledgement
            await websocket.send_text(f'{{"type":"PONG","channel":"{channel}"}}')
    except WebSocketDisconnect:
        await manager.disconnect(websocket, channel)
    except Exception as exc:
        logger.warning(f"WebSocket exception on {channel}: {exc}")
        await manager.disconnect(websocket, channel)
