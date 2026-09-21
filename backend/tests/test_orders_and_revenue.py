import uuid
from decimal import Decimal
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.core.database import Base
from app.api.deps import get_db
from app.main import app
from app.models.entities import Station, MenuItem, Session, Order, OrderItem
from app.models.enums import OrderStatus, SessionStatus


@pytest_asyncio.fixture
async def orders_test_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        station = Station(
            id=uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            name="PS5-VIP",
            tier="CONSOLE",
            hourly_rate=Decimal("180.00"),
            status="AVAILABLE",
        )
        drink = MenuItem(
            id=uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
            name="Red Bull",
            category="Beverages",
            price=Decimal("120.00"),
            stock=10,
            is_available=True,
        )
        snack = MenuItem(
            id=uuid.UUID("cccccccc-cccc-cccc-cccc-cccccccccccc"),
            name="Peri Peri Fries",
            category="Snacks",
            price=Decimal("150.00"),
            stock=15,
            is_available=True,
        )
        session.add_all([station, drink, snack])
        await session.commit()

    async def override_get_db():
        async with async_session() as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db
    yield async_session
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.asyncio
async def test_order_accept_deducts_inventory_and_reject_does_not(orders_test_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Admin checks in a session on station
        checkin_res = await client.post(
            "/api/v1/admin/sessions/check-in",
            json={
                "station_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                "customer_name": "Test Gamer",
                "customer_phone": "9876543210",
                "allocated_minutes": 60,
            },
        )
        assert checkin_res.status_code == 200
        session_id = checkin_res.json()["session_id"]

        # 2. Get customer token
        token_res = await client.post(
            "/api/v1/customer/auth/token",
            json={"desk_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "session_id": session_id},
        )
        assert token_res.status_code == 200
        token = token_res.json()["access_token"]

        # 3. Customer places an order: 2 Red Bulls (initial stock 10)
        order_res = await client.post(
            "/api/v1/customer/order",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "items": [
                    {"menu_item_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "quantity": 2}
                ]
            },
        )
        assert order_res.status_code == 200
        order_data = order_res.json()
        order_id = order_data["id"]
        assert order_data["status"] == "QUEUED"

        # 4. Verify initial stock is still 10 before staff acceptance
        menu_res = await client.get("/api/v1/admin/menu")
        red_bull = next(m for m in menu_res.json() if m["name"] == "Red Bull")
        assert red_bull["stock"] == 10

        # 5. Staff accepts the order (QUEUED -> PREPARING)
        accept_res = await client.patch(
            f"/api/v1/admin/kitchen/orders/{order_id}/status",
            json={"status": "PREPARING"},
        )
        assert accept_res.status_code == 200
        assert accept_res.json()["status"] == "PREPARING"

        # 6. Verify inventory was automatically deducted from 10 -> 8
        menu_res_after = await client.get("/api/v1/admin/menu")
        red_bull_after = next(m for m in menu_res_after.json() if m["name"] == "Red Bull")
        assert red_bull_after["stock"] == 8

        # 7. Customer places another order to test rejection
        order2_res = await client.post(
            "/api/v1/customer/order",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "items": [
                    {"menu_item_id": "cccccccc-cccc-cccc-cccc-cccccccccccc", "quantity": 3}
                ]
            },
        )
        order2_id = order2_res.json()["id"]

        # 8. Staff rejects the order (QUEUED -> CANCELLED)
        reject_res = await client.patch(
            f"/api/v1/admin/kitchen/orders/{order2_id}/status",
            json={"status": "CANCELLED"},
        )
        assert reject_res.status_code == 200
        assert reject_res.json()["status"] == "CANCELLED"

        # 9. Verify fries stock remains untouched at 15
        menu_res_fries = await client.get("/api/v1/admin/menu")
        fries = next(m for m in menu_res_fries.json() if m["name"] == "Peri Peri Fries")
        assert fries["stock"] == 15


@pytest.mark.asyncio
async def test_revenue_analytics_database_endpoint(orders_test_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/v1/admin/analytics/revenue?period=DAY")
        assert res.status_code == 200
        data = res.json()
        assert "totalRevenue" in data
        assert "gamingRevenue" in data
        assert "foodRevenue" in data
        assert "chartData" in data
        assert isinstance(data["chartData"], list)
