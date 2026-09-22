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

        # Admin logs in to place desk orders
        admin_login = await client.post(
            "/api/v1/auth/login",
            json={"identifier": "admin", "password": "admin123"},
        )
        assert admin_login.status_code == 200
        admin_token = admin_login.json()["access_token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # Place order for 2 items
        order_res = await client.post(
            "/api/v1/admin/orders/station-order",
            json={
                "station_id": station_id,
                "items": [{"menu_item_id": menu_item_id, "quantity": 2}],
                "customer_name": "Rohan",
            },
            headers=admin_headers,
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
            headers=admin_headers,
        )
        assert fail_res.status_code == 400
        assert "Insufficient stock" in fail_res.json()["detail"]

        # Delete menu item referenced by order items — must succeed with 204 No Content without 500 error
        del_res = await client.delete(f"/api/v1/admin/menu/{menu_item_id}")
        assert del_res.status_code == 204


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
            headers={"Authorization": f"Bearer {token}"},
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


@pytest.mark.asyncio
async def test_station_ownership_leak_and_idor_prevention(test_db):
    """
    Validates:
    1. A non-owner customer (User B) cannot read private session metadata
       (session_id, charges, running total) of User A via GET /stations/live.
    2. A non-owner customer attempting to POST /orders/station-order against User A's station
       receives HTTP 403 Forbidden (preventing IDOR).
    3. Unauthenticated requests to order food are blocked with HTTP 403 Forbidden.
    4. The authentic session owner (User A) CAN read their private session data and order snacks.
    5. An ADMIN can manage and order snacks for any station session.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Register User A (Prem)
        res_a = await client.post(
            "/api/v1/auth/register",
            json={"name": "Prem", "phone": "9876500001", "password": "prempassword"},
        )
        assert res_a.status_code == 201
        user_a = res_a.json()["user"]
        token_a = res_a.json()["access_token"]

        # Register User B (Gopi)
        res_b = await client.post(
            "/api/v1/auth/register",
            json={"name": "Gopi", "phone": "9876500002", "password": "gopipassword"},
        )
        assert res_b.status_code == 201
        user_b = res_b.json()["user"]
        token_b = res_b.json()["access_token"]

        # Admin creates Station & Food Item
        st_res = await client.post(
            "/api/v1/admin/stations",
            json={"name": "CAR Simulator", "tier": "SIMULATOR", "hourly_rate": 250.00},
        )
        assert st_res.status_code == 201
        station_id = st_res.json()["id"]

        food_res = await client.post(
            "/api/v1/admin/menu",
            json={"name": "Truffle Fries", "category": "Food", "price": 150.00, "stock": 10},
        )
        assert food_res.status_code == 201
        item_id = food_res.json()["id"]

        # User A checks in and starts a live gaming session
        checkin_res = await client.post(
            "/api/v1/admin/sessions/check-in",
            json={
                "station_id": station_id,
                "allocated_minutes": 60,
                "customer_name": user_a["name"],
                "customer_phone": user_a["phone"],
                "user_id": user_a["id"],
            },
        )
        assert checkin_res.status_code == 200
        session_id = checkin_res.json()["session_id"]

        # User A orders 1 Truffle Fries
        order_res_a = await client.post(
            "/api/v1/admin/orders/station-order",
            json={
                "station_id": station_id,
                "items": [{"menu_item_id": item_id, "quantity": 1}],
                "customer_name": user_a["name"],
            },
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert order_res_a.status_code == 201

        # -------------------------------------------------------------
        # OBJECTIVE 1: Backend API Scoping & Authorization Check
        # User B queries GET /api/v1/admin/stations/live
        # -------------------------------------------------------------
        live_b = await client.get(
            "/api/v1/admin/stations/live",
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert live_b.status_code == 200
        fleet_b = live_b.json()
        station_b_view = next(s for s in fleet_b if s["id"] == station_id)

        # Public indicators visible
        assert station_b_view["status"] == "OCCUPIED"
        assert station_b_view["is_occupied"] is True
        assert station_b_view["is_my_session"] is False

        # Private session metadata strictly stripped for non-owner User B
        assert station_b_view["active_session_id"] is None
        assert float(station_b_view["time_charge"]) == 0.0
        assert float(station_b_view["orders_charge"]) == 0.0
        assert float(station_b_view["running_total"]) == 0.0
        assert station_b_view["user_id"] is None

        # Unauthenticated query also gets sanitized response
        live_anon = await client.get("/api/v1/admin/stations/live")
        assert live_anon.status_code == 200
        anon_station = next(s for s in live_anon.json() if s["id"] == station_id)
        assert anon_station["is_occupied"] is True
        assert anon_station["is_my_session"] is False
        assert anon_station["active_session_id"] is None
        assert float(anon_station["running_total"]) == 0.0

        # Owner User A queries GET /api/v1/admin/stations/live — receives their private data
        live_a = await client.get(
            "/api/v1/admin/stations/live",
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert live_a.status_code == 200
        station_a_view = next(s for s in live_a.json() if s["id"] == station_id)
        assert station_a_view["is_occupied"] is True
        assert station_a_view["is_my_session"] is True
        assert station_a_view["active_session_id"] == session_id
        assert float(station_a_view["orders_charge"]) == 150.0
        assert float(station_a_view["running_total"]) >= 150.0
        assert station_a_view["user_id"] == user_a["id"]

        # -------------------------------------------------------------
        # OBJECTIVE 2: Order Placement IDOR Protection
        # User B attempts to place food order on User A's station
        # -------------------------------------------------------------
        idor_res = await client.post(
            "/api/v1/admin/orders/station-order",
            json={
                "station_id": station_id,
                "items": [{"menu_item_id": item_id, "quantity": 1}],
                "customer_name": "Gopi Attacker",
            },
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert idor_res.status_code == 403
        assert "Forbidden" in idor_res.json()["detail"]

        # Unauthenticated attacker also rejected with 403 Forbidden
        unauth_order = await client.post(
            "/api/v1/admin/orders/station-order",
            json={
                "station_id": station_id,
                "items": [{"menu_item_id": item_id, "quantity": 1}],
                "customer_name": "Anonymous",
            },
        )
        assert unauth_order.status_code == 403

        # User A (legitimate owner) places another order -> Success 201
        legit_order = await client.post(
            "/api/v1/admin/orders/station-order",
            json={
                "station_id": station_id,
                "items": [{"menu_item_id": item_id, "quantity": 1}],
                "customer_name": user_a["name"],
            },
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert legit_order.status_code == 201
        assert legit_order.json()["session_id"] == session_id


