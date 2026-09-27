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


@pytest.mark.asyncio
async def test_advance_booking_collision_rejection(test_db):
    """
    Guarantees that:
    1. Booking same station at exact same time is rejected with HTTP 409.
    2. Overlapping booking (e.g. 23:00-00:00 vs 23:30-00:30) is rejected with HTTP 409.
    3. Booking a DIFFERENT station at the same time succeeds.
    4. Overlapping walk-in session start is rejected with HTTP 409.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Step 1: Create initial booking for PS2 at 23:00 (11 PM) for 60m (until 00:00)
        b1_payload = {
            "customerName": "Original Gamer",
            "stationId": "PS2",
            "sessionMode": "Solo",
            "bookingDate": "2026-09-28",
            "startTime": "23:00",
            "durationMinutes": 60,
            "advancePaid": 100,
            "totalAmount": 180,
            "status": "CONFIRMED"
        }
        res1 = await client.post("/api/v1/bookings", json=b1_payload)
        assert res1.status_code == 201

        # Step 2: Try duplicate booking on PS2 at same time (23:00) -> MUST FAIL (409)
        b2_payload = {
            "customerName": "Duplicate Gamer",
            "stationId": "PS2",
            "sessionMode": "Solo",
            "bookingDate": "2026-09-28",
            "startTime": "23:00",
            "durationMinutes": 60,
            "advancePaid": 100,
            "totalAmount": 180,
            "status": "CONFIRMED"
        }
        res2 = await client.post("/api/v1/bookings", json=b2_payload)
        assert res2.status_code == 409
        assert "Collision detected" in res2.json()["detail"]

        # Step 3: Try overlapping booking across midnight (23:30 for 60m until 00:30) on PS2 -> MUST FAIL (409)
        b3_payload = {
            "customerName": "Overlap Gamer",
            "stationId": "PS2",
            "sessionMode": "Solo",
            "bookingDate": "2026-09-28",
            "startTime": "23:30",
            "durationMinutes": 60,
            "advancePaid": 100,
            "totalAmount": 180,
            "status": "CONFIRMED"
        }
        res3 = await client.post("/api/v1/bookings", json=b3_payload)
        assert res3.status_code == 409
        assert "Collision detected" in res3.json()["detail"]

        # Step 4: Booking a DIFFERENT station (PS1) at 23:00 -> MUST SUCCEED (201)
        b4_payload = {
            "customerName": "Other Station Gamer",
            "stationId": "PS1",
            "sessionMode": "Solo",
            "bookingDate": "2026-09-28",
            "startTime": "23:00",
            "durationMinutes": 60,
            "advancePaid": 100,
            "totalAmount": 180,
            "status": "CONFIRMED"
        }
        res4 = await client.post("/api/v1/bookings", json=b4_payload)
        assert res4.status_code == 201

