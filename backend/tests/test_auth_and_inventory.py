import uuid
import pytest
import pytest_asyncio
from decimal import Decimal
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.core.database import Base
from app.api.deps import get_db
from app.main import app
from app.models.entities import Station, MenuItem, User
from app.core.security import get_password_hash


@pytest_asyncio.fixture
async def test_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_get_db():
        async with async_session() as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db

    yield

    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.asyncio
async def test_auth_registration_and_login(test_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Register a new gamer
        reg_payload = {
            "name": "Arjun Sharma",
            "phone": "9876543210",
            "password": "secretpassword",
        }
        res = await client.post("/api/v1/auth/register", json=reg_payload)
        assert res.status_code == 201
        data = res.json()
        assert "access_token" in data
        assert data["user"]["name"] == "Arjun Sharma"
        assert data["user"]["phone"] == "9876543210"
        assert data["user"]["role"] == "CUSTOMER"

        # 2. Duplicate phone registration should fail (409)
        res_dup = await client.post("/api/v1/auth/register", json=reg_payload)
        assert res_dup.status_code == 409

        # 3. Login with registered phone & password
        login_res = await client.post(
            "/api/v1/auth/login",
            json={"identifier": "9876543210", "password": "secretpassword"},
        )
        assert login_res.status_code == 200
        token = login_res.json()["access_token"]
        assert token is not None

        # 4. Login with wrong password should fail (401)
        bad_login = await client.post(
            "/api/v1/auth/login",
            json={"identifier": "9876543210", "password": "wrongpassword"},
        )
        assert bad_login.status_code == 401

        # 5. /auth/me with Bearer token
        me_res = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert me_res.status_code == 200
        assert me_res.json()["phone"] == "9876543210"


@pytest.mark.asyncio
async def test_admin_login(test_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/v1/auth/login",
            json={"identifier": "admin", "password": "admin123"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["user"]["role"] == "ADMIN"
        assert "access_token" in data


@pytest.mark.asyncio
async def test_menu_and_inventory_crud(test_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create a menu item
        create_res = await client.post(
            "/api/v1/admin/menu",
            json={
                "name": "Spicy Peri-Peri Fries",
                "category": "Food",
                "price": 150.00,
                "stock": 30,
                "min_stock_alert": 5,
                "is_available": True,
            },
        )
        assert create_res.status_code == 201
        item = create_res.json()
        item_id = item["id"]
        assert item["stock"] == 30

        # 2. Update stock
        patch_res = await client.patch(
            f"/api/v1/admin/menu/{item_id}",
            json={"stock": 28, "price": 155.00},
        )
        assert patch_res.status_code == 200
        assert patch_res.json()["stock"] == 28
        assert float(patch_res.json()["price"]) == 155.00

        # 3. Restock inventory
        restock_res = await client.post(
            "/api/v1/admin/inventory/restock",
            json={"item_id": item_id, "amount": 10},
        )
        assert restock_res.status_code == 200
        assert restock_res.json()["stock"] == 38

        # 4. Get admin menu
        list_res = await client.get("/api/v1/admin/menu")
        assert list_res.status_code == 200
        items = list_res.json()
        assert any(i["id"] == item_id for i in items)


@pytest.mark.asyncio
async def test_station_food_order_atomic_stock_deduction(test_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create station
        st_res = await client.post(
            "/api/v1/admin/stations",
            json={"name": "VR Pod 1", "tier": "VR", "hourly_rate": 250.00},
        )
        station_id = st_res.json()["id"]

        # Check in station
        checkin_res = await client.post(
            "/api/v1/admin/sessions/check-in",
            json={"station_id": station_id, "customer_name": "Rohan", "customer_phone": "9998887776"},
        )
        assert checkin_res.status_code == 200

        # Create food item with stock 5
        food_res = await client.post(
            "/api/v1/admin/menu",
            json={"name": "Energy Drink Blue", "category": "Drinks", "price": 100.00, "stock": 5},
        )
        menu_item_id = food_res.json()["id"]

        # Place order for 2 items
        order_res = await client.post(
            "/api/v1/admin/orders/station-order",
            json={
                "station_id": station_id,
                "items": [{"menu_item_id": menu_item_id, "quantity": 2}],
                "customer_name": "Rohan",
            },
        )
        assert order_res.status_code == 201
        assert order_res.json()["status"] == "QUEUED"

        # Verify stock decreased to 3 in DB
        menu_check = await client.get("/api/v1/admin/menu")
        item_data = next(i for i in menu_check.json() if i["id"] == menu_item_id)
        assert item_data["stock"] == 3

        # Ordering more than remaining stock (4 > 3) should fail with 400
        fail_res = await client.post(
            "/api/v1/admin/orders/station-order",
            json={
                "station_id": station_id,
                "items": [{"menu_item_id": menu_item_id, "quantity": 4}],
                "customer_name": "Rohan",
            },
        )
        assert fail_res.status_code == 400
        assert "Insufficient stock" in fail_res.json()["detail"]


@pytest.mark.asyncio
async def test_customer_directory_query(test_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Register a customer
        await client.post(
            "/api/v1/auth/register",
            json={"name": "Siddharth Rao", "phone": "9123456780", "password": "mypassword"},
        )

        cust_res = await client.get("/api/v1/admin/customers")
        assert cust_res.status_code == 200
        cust_list = cust_res.json()
        assert any(c["phone"] == "9123456780" for c in cust_list)


@pytest.mark.asyncio
async def test_end_to_end_customer_journey(test_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Player registers
        reg_res = await client.post(
            "/api/v1/auth/register",
            json={"name": "Karan Singhal", "phone": "9988776655", "password": "karanpassword"},
        )
        assert reg_res.status_code == 201
        user_info = reg_res.json()["user"]
        token = reg_res.json()["access_token"]
        assert user_info["role"] == "CUSTOMER"

        # 2. Setup Station & Food Item in DB
        st_res = await client.post(
            "/api/v1/admin/stations",
            json={"name": "PC Battle Station 1", "tier": "PRO", "hourly_rate": 200.00},
        )
        station_id = st_res.json()["id"]

        food_res = await client.post(
            "/api/v1/admin/menu",
            json={"name": "Chicken Cheese Burger", "category": "Food", "price": 180.00, "stock": 10},
        )
        item_id = food_res.json()["id"]

        # 3. Customer checks in with their credentials
        checkin_res = await client.post(
            "/api/v1/admin/sessions/check-in",
            json={
                "station_id": station_id,
                "allocated_minutes": 120,
                "customer_name": user_info["name"],
                "customer_phone": user_info["phone"],
                "user_id": user_info["id"],
            },
        )
        assert checkin_res.status_code == 200
        session_id = checkin_res.json()["session_id"]

        # 4. Customer places an order from their desk
        order_res = await client.post(
            "/api/v1/admin/orders/station-order",
            json={
                "station_id": station_id,
                "items": [{"menu_item_id": item_id, "quantity": 2}],
                "customer_name": user_info["name"],
            },
        )
        assert order_res.status_code == 201
        assert order_res.json()["session_id"] == session_id

        # 5. Verify inventory decremented in DB (10 - 2 = 8)
        menu_res = await client.get("/api/v1/admin/menu")
        burger = next(i for i in menu_res.json() if i["id"] == item_id)
        assert burger["stock"] == 8

        # 6. Customer logs in Admin panel reflects their visit and total spend
        cust_res = await client.get("/api/v1/admin/customers")
        assert cust_res.status_code == 200
        customers = cust_res.json()
        karan = next(c for c in customers if c["phone"] == "9988776655")
        assert karan["name"] == "Karan Singhal"
        assert karan["visit_count"] >= 1
        assert float(karan["total_spent"]) >= 360.00  # 2 burgers @ 180 = 360

