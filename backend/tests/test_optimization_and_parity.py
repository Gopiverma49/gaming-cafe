import uuid
from decimal import Decimal
import time
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.core.database import Base
from app.api.deps import get_db, IdempotencyCache
from app.main import app
from app.models.entities import Station, MenuItem, Session, User
from app.core.security import create_admin_token, get_password_hash


@pytest_asyncio.fixture
async def opt_test_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    station_id = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    session_id = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    menu1_id = uuid.UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")
    menu2_id = uuid.UUID("dddddddd-dddd-dddd-dddd-dddddddddddd")

    async with async_session() as session:
        admin_user = User(
            id=uuid.UUID("11111111-0000-0000-0000-000000000001"),
            name="System Administrator",
            phone="0000000000",
            password_hash=get_password_hash("admin123"),
            role="ADMIN",
        )
        st = Station(
            id=station_id,
            name="OPT-STATION-01",
            tier="CONSOLE",
            hourly_rate=Decimal("180.00"),
            status="OCCUPIED",
        )
        sess = Session(
            id=session_id,
            station_id=station_id,
            customer_name="Test Gamer",
            status="ACTIVE",
            total_amount=Decimal("0.00"),
        )
        m1 = MenuItem(
            id=menu1_id,
            name="Gamer Cola",
            category="Drinks",
            price=Decimal("50.00"),
            stock=10,
            is_available=True,
        )
        m2 = MenuItem(
            id=menu2_id,
            name="Nachos Supreme",
            category="Snacks",
            price=Decimal("120.00"),
            stock=5,
            is_available=True,
        )
        session.add_all([admin_user, st, sess, m1, m2])
        await session.commit()

    async def override_get_db():
        async with async_session() as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db

    yield {
        "station_id": station_id,
        "session_id": session_id,
        "menu1_id": menu1_id,
        "menu2_id": menu2_id,
    }

    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.asyncio
async def test_batch_food_ordering_atomic_deduction(opt_test_db):
    transport = ASGITransport(app=app)
    admin_token = create_admin_token()

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Place order with multiple items (testing batch fetch & add_all optimization)
        payload = {
            "station_id": str(opt_test_db["station_id"]),
            "customer_name": "Test Gamer",
            "items": [
                {"menu_item_id": str(opt_test_db["menu1_id"]), "quantity": 2},
                {"menu_item_id": str(opt_test_db["menu2_id"]), "quantity": 1},
            ],
        }
        res = await client.post(
            "/api/v1/admin/orders/station-order",
            json=payload,
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert res.status_code == 201, res.text
        data = res.json()
        assert len(data["items"]) == 2
        # Expected total: (50 * 2) + (120 * 1) = 220.00
        assert Decimal(str(data["total_amount"])) == Decimal("220.00")


@pytest.mark.asyncio
async def test_batch_food_ordering_insufficient_stock(opt_test_db):
    transport = ASGITransport(app=app)
    admin_token = create_admin_token()

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Request more than available stock (m2 stock is 5, requesting 10)
        payload = {
            "station_id": str(opt_test_db["station_id"]),
            "items": [
                {"menu_item_id": str(opt_test_db["menu2_id"]), "quantity": 10},
            ],
        }
        res = await client.post(
            "/api/v1/admin/orders/station-order",
            json=payload,
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert res.status_code == 400
        assert "Insufficient stock" in res.json()["detail"]


@pytest.mark.asyncio
async def test_batch_food_ordering_nonexistent_item(opt_test_db):
    transport = ASGITransport(app=app)
    admin_token = create_admin_token()

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        fake_id = str(uuid.uuid4())
        payload = {
            "station_id": str(opt_test_db["station_id"]),
            "items": [
                {"menu_item_id": fake_id, "quantity": 1},
            ],
        }
        res = await client.post(
            "/api/v1/admin/orders/station-order",
            json=payload,
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert res.status_code == 404
        assert "not found" in res.json()["detail"].lower()


def test_idempotency_cache_ttl_and_eviction():
    cache = IdempotencyCache(ttl=1, max_entries=2)
    cache.set("k1", "hash1", 200, b"{}", {})
    cache.set("k2", "hash2", 200, b"{}", {})

    assert cache.get("k1") is not None
    assert cache.get("k2") is not None

    # Exceed capacity: k3 evicts k1 (LRU)
    cache.set("k3", "hash3", 200, b"{}", {})
    assert cache.get("k1") is None
    assert cache.get("k2") is not None
    assert cache.get("k3") is not None

    # Exceed TTL
    time.sleep(1.1)
    assert cache.get("k2") is None
    assert cache.get("k3") is None
