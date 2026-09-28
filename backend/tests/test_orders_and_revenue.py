import uuid
from datetime import datetime
from decimal import Decimal
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.core.database import Base
from app.api.deps import get_db
from app.main import app
from app.models.entities import Station, MenuItem


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
        assert "cashRevenue" in data
        assert "upiRevenue" in data
        assert "cashCount" in data
        assert "upiCount" in data
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

        # Verify matrix allocation: PS2 is active under solo, but time_charge is strictly 0.0 (no game session started)
        matrix_res = await client.get("/api/v1/fleet/matrix")
        assert matrix_res.status_code == 200
        m_data = matrix_res.json()
        ps2_col = next(s for s in m_data["stations"] if s["name"] == "PS2")
        assert ps2_col["active_session"] is not None
        assert ps2_col["active_session"]["mode"] == "solo"
        assert float(ps2_col["active_session"]["time_charge"]) == 0.0
        assert float(ps2_col["active_session"]["orders_charge"]) == 390.0
        assert ps2_col["active_session"]["is_food_only"] is True

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

        # Verify PS3 session is Car Simulator with time_charge 0.0 (food only, no auto game session)
        matrix_res2 = await client.get("/api/v1/fleet/matrix")
        m_data2 = matrix_res2.json()
        ps3_col = next(s for s in m_data2["stations"] if s["name"] == "PS3")
        assert ps3_col["active_session"] is not None
        assert ps3_col["active_session"]["mode"] == "car_sim"
        assert float(ps3_col["active_session"]["time_charge"]) == 0.0
        assert float(ps3_col["active_session"]["orders_charge"]) == 120.0
        assert ps3_col["active_session"]["is_food_only"] is True

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


@pytest.mark.asyncio
async def test_walkin_cafe_dine_in_out_order_and_matrix_settlement(orders_test_db):
    """
    Tests:
    1. Customer ordering food choosing Dine-in / Dine-out for 'Walk-in CAFE'.
    2. Substation restrictions (PS1, PS2, PS3) are bypassed since no gaming console is involved.
    3. Order is registered into dedicated Walk-in CAFE session with 0 hourly rate.
    4. Matrix dashboard reflects 'cafe_session'.
    5. Admin can settle invoice for Walk-in CAFE, bill contains only food charges with 0 time charge.
    """
    from app.core.security import create_admin_token
    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {create_admin_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Customer orders food via Dine-In (Cafe only)
        cafe_order_res = await client.post(
            "/api/v1/customer/in-seat-order",
            json={
                "order_id": "ORD_CAFE_001",
                "station_id": "Walk-in CAFE",
                "mode": "Dine-In",
                "customer_name": "Rohan Gupta",
                "items": [
                    {"id": "snack-1", "name": "Peri Peri Fries", "qty": 1, "price": 120.0},
                    {"id": "drink-1", "name": "Cold Coffee", "qty": 2, "price": 100.0},
                ],
                "total_amount": 320.0,
                "status": "pending",
            },
        )
        assert cafe_order_res.status_code == 200
        order_data = cafe_order_res.json()
        assert order_data["stationId"] == "Walk-in CAFE"
        assert order_data["customerName"] == "Rohan Gupta"

        # 2. Check matrix API: cafe_session must be present
        matrix_res = await client.get("/api/v1/admin/fleet/matrix", headers=headers)
        assert matrix_res.status_code == 200
        matrix_data = matrix_res.json()
        assert "cafe_session" in matrix_data
        assert matrix_data["cafe_session"] is not None
        cafe_sess = matrix_data["cafe_session"]
        assert cafe_sess["station_id"] == "Walk-in CAFE"
        assert cafe_sess["customer_name"] == "Rohan Gupta"
        assert float(cafe_sess["time_charge"]) == 0.0
        assert float(cafe_sess["hourly_rate"]) == 0.0

        # 3. Admin settles invoice for Walk-in CAFE
        checkout_res = await client.post(
            "/api/v1/admin/sessions/checkout",
            headers=headers,
            json={
                "session_id": cafe_sess["session_id"],
                "payment_method": "CASH",
            },
        )
        assert checkout_res.status_code == 200
        bill_data = checkout_res.json()
        assert bill_data["payment_status"] in ("COMPLETED", "PAID")
        assert float(bill_data["station_charge"]) == 0.0
        assert float(bill_data["total_amount"]) == 320.0


@pytest.mark.asyncio
async def test_admin_walkin_cafe_standalone_order_by_station_uuid_and_settlement(orders_test_db):
    """
    Tests:
    1. Admin places a food order directly for 'Walk-in CAFE' station using Station UUID.
    2. No active gaming/playing session exists on that station.
    3. Standalone Walk-in Cafe session is automatically provisioned with 0 gaming charge.
    4. Customer name is preserved.
    5. Admin can settle invoice with full itemized food total.
    """
    from app.core.security import create_admin_token
    from app.models.entities import Station, StationStatus
    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {create_admin_token()}"}
    
    # 1. Fetch or create Walk-in CAFE station to obtain its UUID
    async with orders_test_db() as session:
        st_stmt = select(Station).where(Station.name == "Walk-in CAFE")
        cafe_st = (await session.execute(st_stmt)).scalar_one_or_none()
        if not cafe_st:
            cafe_st = Station(
                name="Walk-in CAFE",
                tier="CAFE",
                hourly_rate=Decimal("0.00"),
                pricing_tiers=[],
                status=StationStatus.AVAILABLE.value,
            )
            session.add(cafe_st)
            await session.commit()
            await session.refresh(cafe_st)
        cafe_st_id = str(cafe_st.id)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Get a valid menu item
        menu_res = await client.get("/api/v1/admin/menu")
        assert menu_res.status_code == 200
        menu_items = menu_res.json()
        item = menu_items[0]

        # 2. Admin places food order using station UUID (just like the frontend modal does)
        order_res = await client.post(
            "/api/v1/admin/orders/station-order",
            headers=headers,
            json={
                "station_id": cafe_st_id,
                "session_id": f"cafe-walkin-new-{int(datetime.now().timestamp())}",
                "customer_name": "Pooja Verma",
                "items": [{"menu_item_id": item["id"], "quantity": 2}],
            },
        )
        assert order_res.status_code == 201
        order_data = order_res.json()
        assert order_data["customer_name"] == "Pooja Verma"
        assert order_data["status"] == "QUEUED"

        # 3. Verify fleet matrix reflects cafe session
        matrix_res = await client.get("/api/v1/admin/fleet/matrix", headers=headers)
        assert matrix_res.status_code == 200
        matrix_data = matrix_res.json()
        cafe_sessions = matrix_data.get("cafe_sessions", [])
        matched_sess = next((s for s in cafe_sessions if s["customer_name"] == "Pooja Verma"), None)
        assert matched_sess is not None
        assert float(matched_sess["time_charge"]) == 0.0

        # 4. Settle invoice
        checkout_res = await client.post(
            "/api/v1/admin/sessions/checkout",
            headers=headers,
            json={
                "session_id": matched_sess["session_id"],
                "payment_method": "CASH",
            },
        )
        assert checkout_res.status_code == 200
        bill = checkout_res.json()
        assert bill["payment_status"] in ("COMPLETED", "PAID")
        assert float(bill["station_charge"]) == 0.0
        assert float(bill["orders_charge"]) == float(item["price"]) * 2


@pytest.mark.asyncio
async def test_delete_kitchen_order_and_inventory_restoration(orders_test_db):
    """
    Verify deleting/rejecting an order removes it permanently from kitchen orders
    and restores inventory stock in real-time.
    """
    from app.core.security import create_admin_token
    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {create_admin_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:

        # 1. Fetch menu item to get initial stock
        menu_res = await client.get("/api/v1/admin/menu", headers=headers)
        assert menu_res.status_code == 200
        item = menu_res.json()[0]
        initial_stock = item["stock"]

        # 2. Place food order for Walk-in CAFE
        order_res = await client.post(
            "/api/v1/admin/orders/station-order",
            headers=headers,
            json={
                "station_id": "Walk-in CAFE",
                "customer_name": "Reject Test Customer",
                "items": [{"menu_item_id": item["id"], "quantity": 2}],
            },
        )
        assert order_res.status_code == 201
        order_id = order_res.json()["id"]

        # 3. Verify stock deducted by 2 upon placement
        menu_res_deducted = await client.get("/api/v1/admin/menu", headers=headers)
        curr_item = next(m for m in menu_res_deducted.json() if m["id"] == item["id"])
        assert curr_item["stock"] == initial_stock - 2

        # 4. Delete / Reject order via DELETE /admin/kitchen/orders/{order_id}
        del_res = await client.delete(
            f"/api/v1/admin/kitchen/orders/{order_id}",
            headers=headers,
        )
        assert del_res.status_code == 200

        # 5. Verify stock restored to initial stock
        menu_res_restored = await client.get("/api/v1/admin/menu", headers=headers)
        restored_item = next(m for m in menu_res_restored.json() if m["id"] == item["id"])
        assert restored_item["stock"] == initial_stock

        # 7. Verify order is gone from GET /admin/kitchen/orders
        kitchen_res = await client.get("/api/v1/admin/kitchen/orders", headers=headers)
        assert kitchen_res.status_code == 200
        assert not any(o["id"] == order_id for o in kitchen_res.json())


@pytest.mark.asyncio
async def test_delete_cafe_tab_deletes_orders_and_sessions(orders_test_db):
    """
    Verify deleting a Walk-in CAFE tab removes all orders and cancels sessions in real-time.
    """
    from app.core.security import create_admin_token
    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {create_admin_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:

        # 1. Menu item
        menu_res = await client.get("/api/v1/admin/menu", headers=headers)
        item = menu_res.json()[0]

        # 2. Place Walk-in CAFE order for Tab Customer
        cust_name = "Tab Delete Test Gamer"
        order_res = await client.post(
            "/api/v1/admin/orders/station-order",
            headers=headers,
            json={
                "station_id": "Walk-in CAFE",
                "customer_name": cust_name,
                "items": [{"menu_item_id": item["id"], "quantity": 1}],
            },
        )
        assert order_res.status_code == 201
        order_id = order_res.json()["id"]

        # 3. Verify it shows up in kitchen orders and fleet matrix
        k_res = await client.get("/api/v1/admin/kitchen/orders", headers=headers)
        assert any(o["id"] == order_id for o in k_res.json())

        m_res = await client.get("/api/v1/admin/fleet/matrix", headers=headers)
        assert any(s["customer_name"] == cust_name for s in m_res.json().get("cafe_sessions", []))

        # 4. Delete the tab via POST /api/v1/admin/cafe/tab/delete
        del_tab_res = await client.post(
            "/api/v1/admin/cafe/tab/delete",
            headers=headers,
            json={"customer_name": cust_name},
        )
        assert del_tab_res.status_code == 200
        assert del_tab_res.json()["deleted_orders_count"] >= 1

        # 5. Verify order is gone from GET /admin/kitchen/orders
        k_res_after = await client.get("/api/v1/admin/kitchen/orders", headers=headers)
        assert not any(o["id"] == order_id for o in k_res_after.json())

        # 6. Verify session is no longer active in fleet matrix
        m_res_after = await client.get("/api/v1/admin/fleet/matrix", headers=headers)
        assert not any(s["customer_name"] == cust_name for s in m_res_after.json().get("cafe_sessions", []))


@pytest.mark.asyncio
async def test_in_seat_food_order_customer_arrives_and_admin_starts_session(orders_test_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Customer places in-seat food order to PS2 while waiting
        food_res = await client.post(
            "/api/v1/customer/in-seat-order",
            json={
                "order_id": "ORD_START_TEST_001",
                "station_id": "PS2",
                "mode": "solo",
                "customer_name": "Late Arriving Gamer",
                "items": [{"id": "item-snack", "name": "Loaded Nachos", "qty": 1, "price": 180.0}],
                "total_amount": 180.0,
            },
        )
        assert food_res.status_code == 200

        # Matrix should show food-only session with time charge 0
        matrix_before = await client.get("/api/v1/fleet/matrix")
        assert matrix_before.status_code == 200
        ps2_col = next(s for s in matrix_before.json()["stations"] if s["name"] == "PS2")
        assert ps2_col["active_session"] is not None
        assert ps2_col["active_session"]["is_food_only"] is True
        assert float(ps2_col["active_session"]["time_charge"]) == 0.0
        assert float(ps2_col["active_session"]["orders_charge"]) == 180.0

        # 2. Customer arrives! Admin clicks Start button for 60m Solo on PS2
        start_res = await client.post(
            "/api/v1/admin/sessions/start",
            json={
                "station_id": "PS2",
                "category_id": "solo",
                "mode": "Solo",
                "duration_minutes": 60,
                "customer_name": "Late Arriving Gamer",
            },
        )
        assert start_res.status_code == 201
        start_data = start_res.json()
        assert start_data["allocated_minutes"] == 60

        # 3. Matrix should now show full active gaming session with both game time and food charges
        matrix_after = await client.get("/api/v1/fleet/matrix")
        assert matrix_after.status_code == 200
        ps2_col_after = next(s for s in matrix_after.json()["stations"] if s["name"] == "PS2")
        sess_after = ps2_col_after["active_session"]
        assert sess_after is not None
        assert sess_after["is_food_only"] is False
        assert sess_after["allocated_minutes"] == 60
        assert float(sess_after["time_charge"]) > 0.0
        assert float(sess_after["orders_charge"]) == 180.0
        assert float(sess_after["running_total"]) == float(sess_after["time_charge"]) + 180.0







