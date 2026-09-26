import uuid
from decimal import Decimal
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.core.database import Base
from app.api.deps import get_db
from app.main import app
from app.models.entities import Station, MenuItem


@pytest.mark.asyncio
async def test_full_cafe_lifecycle_flow(test_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Check live stations
        res = await client.get("/api/v1/admin/stations/live")
        assert res.status_code == 200
        stations = res.json()
        assert len(stations) == 2
        station1_id = "11111111-1111-1111-1111-111111111111"
        station2_id = "22222222-2222-2222-2222-222222222222"

        # 2. Check-in player to station 1
        res_checkin = await client.post(
            "/api/v1/admin/sessions/check-in",
            json={"station_id": station1_id, "allocated_minutes": 60},
        )
        assert res_checkin.status_code == 200
        session_id = res_checkin.json()["session_id"]
        assert session_id is not None

        # 3. Transfer player to station 2 (lexicographical locking)
        res_transfer = await client.post(
            "/api/v1/admin/sessions/transfer",
            json={"session_id": session_id, "target_station_id": station2_id},
        )
        assert res_transfer.status_code == 200
        assert res_transfer.json()["new_station_id"] == station2_id

        # 4. Acquire Desk Token for new station 2
        res_token = await client.post(
            "/api/v1/customer/auth/token",
            json={"desk_id": station2_id, "session_id": session_id},
        )
        assert res_token.status_code == 200
        token = res_token.json()["access_token"]

        # 5. Get Desk Session
        res_desk = await client.get(
            "/api/v1/customer/desk/session",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res_desk.status_code == 200
        assert res_desk.json()["station_id"] == station2_id

        # 6. Place Food Order
        menu_item_id = "33333333-3333-3333-3333-333333333333"
        res_order = await client.post(
            "/api/v1/customer/order",
            headers={"Authorization": f"Bearer {token}"},
            json={"items": [{"menu_item_id": menu_item_id, "quantity": 2}]},
        )
        assert res_order.status_code == 200
        order_data = res_order.json()
        assert order_data["status"] == "QUEUED"
        order_id = order_data["id"]

        # 7. Attempt Checkout while Order is QUEUED -> Must fail with 409 Conflict
        res_checkout_fail = await client.post(
            "/api/v1/admin/sessions/checkout",
            json={"session_id": session_id, "payment_method": "UPI"},
        )
        assert res_checkout_fail.status_code == 409
        assert "food/beverage order(s) are still QUEUED or PREPARING" in res_checkout_fail.json()["detail"]

        # 8. Advance Kitchen Order: QUEUED -> PREPARING
        res_prep = await client.patch(
            f"/api/v1/admin/kitchen/orders/{order_id}/status",
            json={"status": "PREPARING"},
        )
        assert res_prep.status_code == 200

        # Still blocked
        res_checkout_fail2 = await client.post(
            "/api/v1/admin/sessions/checkout",
            json={"session_id": session_id, "payment_method": "UPI"},
        )
        assert res_checkout_fail2.status_code == 409

        # 9. Advance Kitchen Order: PREPARING -> SERVED
        res_served = await client.patch(
            f"/api/v1/admin/kitchen/orders/{order_id}/status",
            json={"status": "SERVED"},
        )
        assert res_served.status_code == 200
        assert res_served.json()["status"] == "SERVED"

        # 10. Checkout Now Succeeds!
        res_checkout = await client.post(
            "/api/v1/admin/sessions/checkout",
            headers={"Idempotency-Key": f"test-chk-{session_id}"},
            json={"session_id": session_id, "payment_method": "UPI"},
        )
        assert res_checkout.status_code == 200
        checkout_info = res_checkout.json()
        assert checkout_info["payment_status"] == "COMPLETED"
        assert checkout_info["payment_method"] == "UPI"
        assert "upi://pay?" in checkout_info["upi_qr_string"]

        # 2 items * 100 = 200.00 food + 1hr allocated session * 200 = 200.00 time -> 400.00
        assert Decimal(str(checkout_info["orders_charge"])) == Decimal("200.00")
        assert Decimal(str(checkout_info["station_charge"])) == Decimal("200.00")
        assert Decimal(str(checkout_info["total_amount"])) == Decimal("400.00")


@pytest.mark.asyncio
async def test_station_crud_operations(test_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create a new station
        create_res = await client.post(
            "/api/v1/admin/stations",
            json={
                "name": "PS5-ARENA-01",
                "tier": "CONSOLE",
                "hourly_rate": 180.0,
            },
        )
        assert create_res.status_code == 201
        station_data = create_res.json()
        station_id = station_data["id"]
        assert station_data["name"] == "PS5-ARENA-01"
        assert station_data["tier"] == "CONSOLE"
        assert float(station_data["hourly_rate"]) == 180.0

        # 2. Duplicate station name should fail
        dup_res = await client.post(
            "/api/v1/admin/stations",
            json={
                "name": "PS5-ARENA-01",
                "tier": "CONSOLE",
                "hourly_rate": 200.0,
            },
        )
        assert dup_res.status_code == 409

        # 3. Update / Rename / Reprice station
        update_res = await client.patch(
            f"/api/v1/admin/stations/{station_id}",
            json={
                "name": "PS5-VIP-LOUNGE",
                "hourly_rate": 220.0,
                "tier": "VIP",
            },
        )
        assert update_res.status_code == 200
        updated_data = update_res.json()
        assert updated_data["name"] == "PS5-VIP-LOUNGE"
        assert float(updated_data["hourly_rate"]) == 220.0
        assert updated_data["tier"] == "VIP"

        # 4. Check live stations list includes updated station
        live_res = await client.get("/api/v1/admin/stations/live")
        assert live_res.status_code == 200
        names = [s["name"] for s in live_res.json()]
        assert "PS5-VIP-LOUNGE" in names

        # 5. Delete station
        del_res = await client.delete(f"/api/v1/admin/stations/{station_id}")
        assert del_res.status_code == 204

        # 6. Verify station is deleted
        live_res_after = await client.get("/api/v1/admin/stations/live")
        names_after = [s["name"] for s in live_res_after.json()]
        assert "PS5-VIP-LOUNGE" not in names_after

@pytest.mark.asyncio
async def test_station_pricing_tiers(test_db):
    """Test creating and updating stations with multi-tier duration pricing."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        tiers = [
            {"duration_min": 30, "price": 200.0, "label": "30 mins"},
            {"duration_min": 60, "price": 350.0, "label": "1 hr"},
            {"duration_min": 120, "price": 600.0, "label": "2 hrs"},
        ]
        create_res = await client.post(
            "/api/v1/admin/stations",
            json={
                "name": "CAR-Simulator-Tier-Test",
                "tier": "SIMULATOR",
                "hourly_rate": 350.0,
                "pricing_tiers": tiers,
            },
        )
        assert create_res.status_code == 201
        data = create_res.json()
        station_id = data["id"]
        assert len(data["pricing_tiers"]) == 3
        assert data["pricing_tiers"][0]["price"] == "200.00" or float(data["pricing_tiers"][0]["price"]) == 200.0

        # Update pricing tiers
        updated_tiers = [
            {"duration_min": 15, "price": 100.0, "label": "Quick 15m"},
            {"duration_min": 60, "price": 380.0, "label": "1 hr"},
        ]
        patch_res = await client.patch(
            f"/api/v1/admin/stations/{station_id}",
            json={
                "pricing_tiers": updated_tiers,
                "hourly_rate": 380.0,
            },
        )
        assert patch_res.status_code == 200
        patch_data = patch_res.json()
        assert len(patch_data["pricing_tiers"]) == 2

        # Check live stations endpoint returns tiers
        live_res = await client.get("/api/v1/admin/stations/live")
        assert live_res.status_code == 200
        target = next((s for s in live_res.json() if s["id"] == station_id), None)
        assert target is not None
        assert len(target["pricing_tiers"]) == 2
        assert float(target["default_hourly_rate"]) == 380.0

        # Cleanup
        await client.delete(f"/api/v1/admin/stations/{station_id}")


@pytest.mark.asyncio
async def test_shared_hardware_allocation_and_conflict_rejection(test_db):
    """
    Validates:
    1. Categories map correctly to physical assets (PS1, PS2, PS3, VR1).
    2. Booking PS3 under Solo globally locks PS3 for CAR Simulator and Multiplayer.
    3. Next customer attempting to book CAR Simulator or Multiplayer on PS3 receives HTTP 409 Conflict.
    4. Next customer can still book Multiplayer or Solo on available PS1 or PS2.
    5. VR Simulator (VR1) functions completely independently.
    6. GET /api/fleet/categories accurately aggregates available units in real-time.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Seed the 4 hardware units
        for name, tier, rate in [("PS1", "CONSOLE", 180.0), ("PS2", "CONSOLE", 180.0), ("PS3", "CONSOLE", 180.0), ("VR1", "VR", 250.0)]:
            await client.post(
                "/api/v1/admin/stations",
                json={"name": name, "tier": tier, "hourly_rate": rate},
            )

        # 1. Check initial fleet categories availability (all free)
        cat_res = await client.get("/api/v1/fleet/categories")
        assert cat_res.status_code == 200
        cats = {c["id"]: c for c in cat_res.json()}

        assert cats["solo"]["available_units"] == 3
        assert cats["solo"]["total_units"] == 3
        assert cats["solo"]["is_available"] is True

        assert cats["multiplayer"]["available_units"] == 3
        assert cats["multiplayer"]["total_units"] == 3
        assert cats["multiplayer"]["is_available"] is True

        assert cats["car_sim"]["available_units"] == 1
        assert cats["car_sim"]["total_units"] == 1
        assert cats["car_sim"]["is_available"] is True

        assert cats["vr_sim"]["available_units"] == 1
        assert cats["vr_sim"]["total_units"] == 1
        assert cats["vr_sim"]["is_available"] is True

        # 2. Customer A books PS3 under Solo Experience
        book_res1 = await client.post(
            "/api/v1/sessions/start",
            json={
                "category_id": "solo",
                "device_id": "PS3",
                "duration_minutes": 60,
                "customer_name": "Arjun",
            },
        )
        assert book_res1.status_code == 201
        sess1 = book_res1.json()
        assert sess1["category_id"] == "solo"
        assert sess1["device_name"] == "PS3"

        # 3. Check categories: CAR Simulator MUST now be BUSY because PS3 is occupied!
        cat_res2 = await client.get("/api/v1/fleet/categories")
        cats2 = {c["id"]: c for c in cat_res2.json()}

        assert cats2["solo"]["available_units"] == 2  # PS1, PS2
        assert cats2["multiplayer"]["available_units"] == 2  # PS1, PS2
        assert cats2["car_sim"]["available_units"] == 0  # PS3 is busy!
        assert cats2["car_sim"]["is_available"] is False
        assert cats2["vr_sim"]["available_units"] == 1  # VR1 unaffected

        # 4. Customer B attempts to book CAR Simulator -> MUST REJECT WITH 409 CONFLICT
        car_fail = await client.post(
            "/api/v1/sessions/start",
            json={
                "category_id": "car_sim",
                "duration_minutes": 60,
                "customer_name": "Vikram",
            },
        )
        assert car_fail.status_code == 409
        assert "Device 'PS3' currently in use" in car_fail.json()["detail"]

        # 5. Customer B attempts to book Multiplayer on PS3 -> MUST REJECT WITH 409 CONFLICT
        mp_fail = await client.post(
            "/api/v1/sessions/start",
            json={
                "category_id": "multiplayer",
                "device_id": "PS3",
                "duration_minutes": 60,
                "customer_name": "Vikram",
            },
        )
        assert mp_fail.status_code == 409
        assert "Device 'PS3' currently in use" in mp_fail.json()["detail"]

        # 6. Customer B books Multiplayer on available PS1 -> MUST SUCCEED (201)
        mp_ok = await client.post(
            "/api/v1/sessions/start",
            json={
                "category_id": "multiplayer",
                "device_id": "PS1",
                "duration_minutes": 60,
                "customer_name": "Vikram",
            },
        )
        assert mp_ok.status_code == 201
        assert mp_ok.json()["device_name"] == "PS1"

        # 7. Customer C books VR Simulator (VR1) -> MUST SUCCEED (201)
        vr_ok = await client.post(
            "/api/v1/sessions/start",
            json={
                "category_id": "vr_sim",
                "duration_minutes": 60,
                "customer_name": "Neha",
            },
        )
        assert vr_ok.status_code == 201
        assert vr_ok.json()["device_name"] == "VR1"

        # 8. Check categories: VR1 is now also occupied
        cat_res3 = await client.get("/api/v1/fleet/categories")
        cats3 = {c["id"]: c for c in cat_res3.json()}
        assert cats3["vr_sim"]["available_units"] == 0
        assert cats3["vr_sim"]["is_available"] is False

        # Attempting second VR booking fails with 409
        vr_fail = await client.post(
            "/api/v1/sessions/start",
            json={
                "category_id": "vr_sim",
                "duration_minutes": 60,
                "customer_name": "Ravi",
            },
        )
        assert vr_fail.status_code == 409
        assert "Device 'VR1' currently in use" in vr_fail.json()["detail"]


@pytest.mark.asyncio
async def test_canonical_station_and_console_room_hierarchy(test_db):
    """
    Validates:
    1. Primary Stations are Solo, Multiplayer, Car Simulator, VR.
    2. Consoles PS1, PS2, PS3 are registered physical rooms and can be allocated.
    3. Session schema tracks station ('Solo') and console/room ('PS1').
    4. Selecting PS1 validates against registered consoles and does not throw 'not found in registry'.
    5. Concurrent bookings on different consoles under Solo/Multiplayer succeed.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Book Solo on PS1
        res1 = await client.post(
            "/api/v1/sessions/start",
            json={"category_id": "solo", "device_id": "PS1", "customer_name": "Alice"},
        )
        assert res1.status_code == 201
        data1 = res1.json()
        assert data1["station"] == "Solo"
        assert data1["console"] == "PS1"
        assert data1["room"] == "PS1"

        # Book Multiplayer on PS2 concurrently -> Must SUCCEED
        res2 = await client.post(
            "/api/v1/sessions/start",
            json={"category_id": "multiplayer", "device_id": "PS2", "customer_name": "Bob"},
        )
        assert res2.status_code == 201
        data2 = res2.json()
        assert data2["station"] == "Multiplayer"
        assert data2["console"] == "PS2"
        assert data2["room"] == "PS2"

        # Book Car Simulator (locks PS3) -> Must SUCCEED
        res3 = await client.post(
            "/api/v1/sessions/start",
            json={"category_id": "car_sim", "customer_name": "Charlie"},
        )
        assert res3.status_code == 201
        data3 = res3.json()
        assert data3["station"] == "Car Simulator"
        assert data3["console"] == "PS3"

        # Book VR (locks VR1) -> Must SUCCEED
        res4 = await client.post(
            "/api/v1/sessions/start",
            json={"category_id": "vr_sim", "customer_name": "Dave"},
        )
        assert res4.status_code == 201
        data4 = res4.json()
        assert data4["station"] == "VR"
        assert data4["console"] == "VR1"

        # Attempt to book Solo on occupied PS1 -> 409 Conflict
        res_fail = await client.post(
            "/api/v1/sessions/start",
            json={"category_id": "solo", "device_id": "PS1", "customer_name": "Eve"},
        )
        assert res_fail.status_code == 409


@pytest.mark.asyncio
async def test_custom_admin_created_station_lifecycle(test_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Admin creates a new custom station with only pricing slabs (no platform tier or rate required)
        create_res = await client.post(
            "/api/v1/admin/stations",
            json={
                "name": "Cockpit Flight Rig",
                "pricing_tiers": [
                    {"duration_min": 30, "price": 120.0, "label": "30 mins"},
                    {"duration_min": 60, "price": 200.0, "label": "1 hr"},
                    {"duration_min": 120, "price": 380.0, "label": "2 hrs"},
                ],
            },
        )
        assert create_res.status_code == 201
        st_data = create_res.json()
        assert st_data["name"] == "Cockpit Flight Rig"
        st_id = st_data["id"]

        # 2. Verify it reflects immediately on customer fleet categories
        fleet_res = await client.get("/api/v1/fleet/categories")
        assert fleet_res.status_code == 200
        categories = fleet_res.json()
        custom_cat = next((c for c in categories if c["id"] == st_id or c["name"] == "Cockpit Flight Rig"), None)
        assert custom_cat is not None
        assert custom_cat["is_available"] is True
        assert custom_cat["total_units"] == 1
        assert custom_cat["available_units"] == 1
        assert len(custom_cat["pricing_tiers"]) == 3

        # 3. Customer starts session on this custom station
        start_res = await client.post(
            "/api/v1/sessions/start",
            json={
                "category_id": st_id,
                "duration_minutes": 60,
                "customer_name": "Flight Gamer",
                "tier_price": 200.0,
            },
        )
        assert start_res.status_code == 201
        sess_data = start_res.json()
        assert sess_data["station"] == "Cockpit Flight Rig"
        sess_id = sess_data["id"]

        # 4. Verify it is now OCCUPIED on customer fleet categories
        fleet_res2 = await client.get("/api/v1/fleet/categories")
        categories2 = fleet_res2.json()
        custom_cat2 = next((c for c in categories2 if c["id"] == st_id), None)
        assert custom_cat2 is not None
        assert custom_cat2["is_available"] is False
        assert custom_cat2["available_units"] == 0

        # 5. Admin live stations shows it is occupied
        from app.core.security import create_admin_token
        headers = {"Authorization": f"Bearer {create_admin_token()}"}
        live_res = await client.get("/api/v1/admin/stations/live", headers=headers)
        assert live_res.status_code == 200
        live_stations = live_res.json()
        live_st = next((s for s in live_stations if s["id"] == st_id), None)
        assert live_st is not None
        assert live_st["is_occupied"] is True
        assert live_st["active_session_id"] == sess_id


@pytest.mark.asyncio
async def test_console_management_2d_matrix(test_db):
    """
    Test 2D Matrix Dashboard for Console Management:
    1. Verify GET /api/v1/admin/fleet/matrix layout (Modes as rows, Physical Stations as columns).
    2. Start session using { station_id, mode, duration_minutes }.
    3. Verify matrix state updates: State A (Active Here) and State C (Occupied Elsewhere).
    4. Test session extension (+30m).
    5. Test session transfer to available device.
    """
    from app.core.security import create_admin_token
    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {create_admin_token()}"}

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Fetch initial matrix
        matrix_res = await client.get("/api/v1/admin/fleet/matrix", headers=headers)
        assert matrix_res.status_code == 200
        matrix_data = matrix_res.json()

        assert "modes" in matrix_data
        assert "stations" in matrix_data

        mode_ids = [m["id"] for m in matrix_data["modes"]]
        assert "solo" in mode_ids
        assert "multiplayer" in mode_ids
        assert "car_sim" in mode_ids

        station_names = [s["name"] for s in matrix_data["stations"]]
        assert "PS1" in station_names
        assert "PS2" in station_names
        assert "PS3" in station_names

        # 2. Start session using payload: { station_id, mode, duration_minutes }
        start_payload = {
            "station_id": "PS1",
            "mode": "Solo",
            "duration_minutes": 60,
            "customer_name": "Test Gamer",
        }
        start_res = await client.post("/api/v1/admin/sessions/start", json=start_payload, headers=headers)
        assert start_res.status_code == 201
        session_info = start_res.json()
        sess_id = session_info["id"]

        # 3. Verify matrix reflects State A on PS1
        matrix_res2 = await client.get("/api/v1/admin/fleet/matrix", headers=headers)
        assert matrix_res2.status_code == 200
        matrix_data2 = matrix_res2.json()

        ps1 = next(s for s in matrix_data2["stations"] if s["name"] == "PS1")
        assert ps1["status"] == "OCCUPIED"
        assert ps1["active_session"] is not None
        assert ps1["active_session"]["session_id"] == sess_id
        assert ps1["active_session"]["mode"] == "solo"
        assert ps1["active_session"]["allocated_minutes"] == 60

        # 4. Test quick extension (+30m)
        ext_res = await client.post(
            f"/api/v1/admin/sessions/{sess_id}/extend",
            json={"minutes": 30},
            headers=headers,
        )
        assert ext_res.status_code == 200
        ext_data = ext_res.json()
        assert ext_data["allocated_minutes"] == 90

        # 5. Verify matrix reflects extended duration
        matrix_res3 = await client.get("/api/v1/admin/fleet/matrix", headers=headers)
        ps1_ext = next(s for s in matrix_res3.json()["stations"] if s["name"] == "PS1")
        assert ps1_ext["active_session"]["allocated_minutes"] == 90

        # 6. Test session transfer to device PS2
        trans_res = await client.post(
            "/api/v1/admin/sessions/transfer",
            json={"session_id": sess_id, "target_device": "PS2"},
            headers=headers,
        )
        assert trans_res.status_code == 200
        trans_data = trans_res.json()
        assert trans_data["new_device_name"] == "PS2"

        # Verify PS1 is now AVAILABLE and PS2 is now OCCUPIED
        matrix_res4 = await client.get("/api/v1/admin/fleet/matrix", headers=headers)
        stations4 = {s["name"]: s for s in matrix_res4.json()["stations"]}
        assert stations4["PS1"]["status"] == "AVAILABLE"
        assert stations4["PS1"]["active_session"] is None
        assert stations4["PS2"]["status"] == "OCCUPIED"
        assert stations4["PS2"]["active_session"]["session_id"] == sess_id

        # 7. Checkout the session with 10% discount and verify matrix resets and discounted total
        checkout_res = await client.post(
            "/api/v1/admin/checkout",
            json={
                "session_id": sess_id,
                "payment_method": "CASH",
                "discount_percent": 10,
            },
            headers=headers,
        )
        assert checkout_res.status_code == 200
        checkout_data = checkout_res.json()
        assert checkout_data["payment_status"] in ("COMPLETED", "PAID")
        # 90m base total is 270.00; with 10% discount (27.00), total is 243.00
        assert float(checkout_data["total_amount"]) == 243.00

        matrix_res5 = await client.get("/api/v1/admin/fleet/matrix", headers=headers)
        stations5 = {s["name"]: s for s in matrix_res5.json()["stations"]}
        assert stations5["PS2"]["status"] == "AVAILABLE"
        assert stations5["PS2"]["active_session"] is None



