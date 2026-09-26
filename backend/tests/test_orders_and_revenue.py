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


@pytest.mark.asyncio
async def test_station_food_order_with_station_name_or_session_id(orders_test_db):
    from app.core.security import create_admin_token
    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {create_admin_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Start a session on PS5-VIP
        checkin_res = await client.post(
            "/api/v1/admin/sessions/check-in",
            headers=headers,
            json={
                "station_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                "customer_name": "Matrix Gamer",
                "customer_phone": "9998887776",
                "allocated_minutes": 60,
            },
        )
        assert checkin_res.status_code == 200
        session_id = checkin_res.json()["session_id"]

        # Place food order using string station_id "PS5-VIP" and session_id
        order_res = await client.post(
            "/api/v1/admin/orders/station-order",
            headers=headers,
            json={
                "station_id": "PS5-VIP",
                "session_id": session_id,
                "customer_name": "Matrix Gamer",
                "items": [
                    {"menu_item_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "quantity": 1}
                ],
            },
        )
        assert order_res.status_code == 201
        data = order_res.json()
        assert data["status"] == "QUEUED"
        assert len(data["items"]) == 1

        # Verify customer directory captures this gamer
        cust_res = await client.get("/api/v1/admin/customers", headers=headers)
        assert cust_res.status_code == 200
        cust_list = cust_res.json()
        assert any("Matrix Gamer" in c["name"] or c["phone"] == "9998887776" for c in cust_list)


@pytest.mark.asyncio
async def test_station_matrix_strictly_three_columns_and_vr_isolation(orders_test_db):
    from app.core.security import create_admin_token
    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {create_admin_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        matrix_res = await client.get("/api/v1/admin/fleet/matrix", headers=headers)
        assert matrix_res.status_code == 200
        data = matrix_res.json()

        # Strictly 3 columns at all times
        station_names = [s["name"] for s in data["stations"]]
        assert station_names == ["PS1", "PS2", "PS3"]
        assert "VR1" not in station_names

        # vr_session field is present
        assert "vr_session" in data


@pytest.mark.asyncio
async def test_customer_in_seat_order_flow(orders_test_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. In-seat order for Solo on PS2
        res = await client.post(
            "/api/v1/customer/in-seat-order",
            json={
                "order_id": "ORD_1710000000000",
                "station_id": "PS2",
                "mode": "solo",
                "customer_name": "Kavya Sharma",
                "items": [
                    {"id": "snack-1", "name": "Peri Peri Fries", "qty": 2, "price": 120.0},
                    {"id": "drink-1", "name": "Red Bull", "qty": 1, "price": 150.0},
                ],
                "total_amount": 390.0,
                "status": "pending",
                "notes": "Less spicy please",
            },
        )
        assert res.status_code == 200
        data = res.json()
        assert data["orderId"] == "ORD_1710000000000"
        assert data["stationId"] == "PS2"
        assert data["customerName"] == "Kavya Sharma"

        # Verify matrix allocation: PS2 is active under solo, and time_charge is ₹180 (not fallback 125)
        matrix_res = await client.get("/api/v1/fleet/matrix")
        assert matrix_res.status_code == 200
        m_data = matrix_res.json()
        ps2_col = next(s for s in m_data["stations"] if s["name"] == "PS2")
        assert ps2_col["active_session"] is not None
        assert ps2_col["active_session"]["mode"] == "solo"
        assert float(ps2_col["active_session"]["time_charge"]) == 180.0

        # 2. Car simulator order: even if client sends PS1, it pins strictly to PS3
        car_res = await client.post(
            "/api/v1/customer/in-seat-order",
            json={
                "order_id": "ORD_1710000000002",
                "station_id": "PS1",
                "mode": "car_sim",
                "customer_name": "Racer Arjun",
                "items": [{"id": "item-c", "name": "Cold Coffee", "qty": 1, "price": 120.0}],
                "total_amount": 120.0,
            },
        )
        assert car_res.status_code == 200
        car_data = car_res.json()
        assert car_data["stationId"] == "PS3"

        # Verify PS3 session is Car Simulator with rate ₹250 (not fallback 125)
        matrix_res2 = await client.get("/api/v1/fleet/matrix")
        m_data2 = matrix_res2.json()
        ps3_col = next(s for s in m_data2["stations"] if s["name"] == "PS3")
        assert ps3_col["active_session"] is not None
        assert ps3_col["active_session"]["mode"] == "car_sim"
        assert float(ps3_col["active_session"]["time_charge"]) == 250.0

        # 3. Invalid station (must be PS1, PS2, or PS3)
        bad_station_res = await client.post(
            "/api/v1/customer/in-seat-order",
            json={
                "order_id": "ORD_1710000000001",
                "station_id": "PS5-VIP",
                "customer_name": "Test Gamer",
                "items": [{"id": "item-1", "name": "Chips", "qty": 1, "price": 50.0}],
                "total_amount": 50.0,
            },
        )
        assert bad_station_res.status_code == 400


@pytest.mark.asyncio
async def test_session_end_with_flat_discount(orders_test_db):
    from app.core.security import create_admin_token
    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {create_admin_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Start/Check-in a session
        checkin_res = await client.post(
            "/api/v1/admin/sessions/check-in",
            headers=headers,
            json={
                "station_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                "customer_name": "Discount Gamer",
                "customer_phone": "9876543210",
                "allocated_minutes": 60,
            },
        )
        assert checkin_res.status_code == 200
        sess_data = checkin_res.json()
        session_id = sess_data["session_id"]

        # Settle session with flat discount_amount of 50.0
        checkout_res = await client.post(
            "/api/v1/admin/sessions/checkout",
            headers=headers,
            json={
                "session_id": session_id,
                "payment_method": "UPI",
                "discount_amount": 50.0,
            },
        )
        assert checkout_res.status_code == 200
        bill_data = checkout_res.json()
        assert "total_amount" in bill_data
        assert Decimal(str(bill_data["total_amount"])) == Decimal("130.00")
        assert Decimal(str(bill_data["station_charge"])) == Decimal("180.00")


@pytest.mark.asyncio
async def test_kitchen_menu_ordering_with_zero_stock_and_inventory_deduction(orders_test_db):
    from app.core.security import create_admin_token
    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {create_admin_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create item with stock=0 (e.g. prepared kitchen food like Peri Peri Fries or Wai Wai)
        item_res = await client.post(
            "/api/v1/admin/menu",
            headers=headers,
            json={"name": "Kitchen Special Maggi", "category": "Food", "price": 120.00, "stock": 0},
        )
        assert item_res.status_code == 201
        kitchen_item_id = item_res.json()["id"]

        # Check-in a session
        checkin_res = await client.post(
            "/api/v1/admin/sessions/check-in",
            headers=headers,
            json={
                "station_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                "customer_name": "Kitchen Food Gamer",
                "customer_phone": "9991112223",
                "allocated_minutes": 60,
            },
        )
        assert checkin_res.status_code == 200
        sess_data = checkin_res.json()
        session_id = sess_data["session_id"]

        # Placing order for zero-stock kitchen item should SUCCEED and not be blocked by inventory
        order_res = await client.post(
            "/api/v1/admin/orders/station-order",
            headers=headers,
            json={
                "station_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                "session_id": session_id,
                "customer_name": "Kitchen Food Gamer",
                "items": [{"menu_item_id": kitchen_item_id, "quantity": 2}],
            },
        )
        assert order_res.status_code == 201
        assert order_res.json()["status"] == "QUEUED"

        # Verify stock remains 0 (not negative or blocked)
        menu_check = await client.get("/api/v1/admin/menu")
        item_data = next(i for i in menu_check.json() if i["id"] == kitchen_item_id)
        assert item_data["stock"] == 0



