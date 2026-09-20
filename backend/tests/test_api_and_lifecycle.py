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


@pytest_asyncio.fixture
async def test_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Seed sample stations & menu
    async with async_session() as session:
        st1 = Station(
            id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
            name="TEST-RIG-01",
            tier="VIP",
            hourly_rate=Decimal("200.00"),
            status="AVAILABLE",
        )
        st2 = Station(
            id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
            name="TEST-RIG-02",
            tier="STANDARD",
            hourly_rate=Decimal("150.00"),
            status="AVAILABLE",
        )
        menu1 = MenuItem(
            id=uuid.UUID("33333333-3333-3333-3333-333333333333"),
            name="Energy Drink",
            category="Beverages",
            price=Decimal("100.00"),
            is_available=True,
        )
        session.add_all([st1, st2, menu1])
        await session.commit()

    async def override_get_db():
        async with async_session() as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db

    yield

    app.dependency_overrides.clear()
    await engine.dispose()


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

        # 2 items * 100 = 200.00 food + minimum 0.5hr * 150 = 75.00 time -> 275.00
        assert Decimal(str(checkout_info["orders_charge"])) == Decimal("200.00")
        assert Decimal(str(checkout_info["station_charge"])) == Decimal("75.00")
        assert Decimal(str(checkout_info["total_amount"])) == Decimal("275.00")
