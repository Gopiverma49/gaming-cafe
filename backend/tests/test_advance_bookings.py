import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app

@pytest.mark.asyncio
async def test_advance_bookings_lifecycle(test_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create booking
        payload = {
            "customerName": "Rohan Gamer",
            "stationId": "PS1",
            "sessionMode": "Solo",
            "bookingDate": "2026-09-28",
            "startTime": "15:00",
            "durationMinutes": 60,
            "advancePaid": 100,
            "totalAmount": 250,
            "status": "CONFIRMED"
        }
        create_res = await client.post("/api/v1/bookings", json=payload)
        assert create_res.status_code == 201
        data = create_res.json()
        booking_id = data["bookingId"]
        assert data["customerName"] == "Rohan Gamer"
        assert data["status"] == "CONFIRMED"

        # 2. List bookings
        list_res = await client.get("/api/v1/bookings")
        assert list_res.status_code == 200
        all_b = list_res.json()
        assert any(b["bookingId"] == booking_id for b in all_b)

        # 3. Cancel booking
        cancel_res = await client.post(f"/api/v1/bookings/{booking_id}/cancel")
        assert cancel_res.status_code == 200
        cancel_data = cancel_res.json()
        assert cancel_data["booking"]["status"] == "CANCELLED"

        # 4. List bookings again to verify status updated to CANCELLED
        list_res2 = await client.get("/api/v1/bookings")
        assert list_res2.status_code == 200
        cancelled_record = next(b for b in list_res2.json() if b["bookingId"] == booking_id)
        assert cancelled_record["status"] == "CANCELLED"
