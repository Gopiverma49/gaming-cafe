from datetime import datetime, timedelta
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app


@pytest.mark.asyncio
async def test_bidirectional_collision_detection(test_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Station 1 setup
        station1_id = "11111111-1111-1111-1111-111111111111"
        today_str = datetime.now().strftime("%Y-%m-%d")

        # 1. Advance booking created at 30 minutes in the future for PS1
        booking_start = datetime.now() + timedelta(minutes=30)
        start_time_str = booking_start.strftime("%H:%M")

        booking_res = await client.post(
            "/api/bookings/create",
            json={
                "customerName": "Alice Gamer",
                "stationId": "PS1",
                "sessionMode": "Solo",
                "bookingDate": today_str,
                "startTime": start_time_str,
                "durationMinutes": 60,
                "totalAmount": 180.0,
                "advancePaid": 50.0,
                "status": "CONFIRMED",
            },
        )
        assert booking_res.status_code == 201, f"Booking creation failed: {booking_res.text}"

        # 2. Attempt walk-in checkin on PS1 for 60 mins starting NOW
        # It overlaps with the advance booking that starts in 30 mins!
        # Must be rejected with HTTP 409 Conflict
        clash_checkin_res = await client.post(
            "/api/station/checkin",
            json={
                "station_id": station1_id,
                "device_id": "PS1",
                "allocated_minutes": 60,
                "customer_name": "Bob Walkin",
            },
        )
        assert clash_checkin_res.status_code == 409, f"Expected 409 Conflict, got {clash_checkin_res.status_code}: {clash_checkin_res.text}"
        assert "Cannot check-in" in clash_checkin_res.json()["detail"] or "reserved" in clash_checkin_res.json()["detail"].lower()

        # 3. Walk-in checkin for 20 mins (before booking start) does NOT collide and succeeds
        ok_checkin_res = await client.post(
            "/api/station/checkin",
            json={
                "station_id": station1_id,
                "device_id": "PS1",
                "allocated_minutes": 20,
                "customer_name": "Bob Quick",
            },
        )
        assert ok_checkin_res.status_code == 200, f"Expected 200 OK, got {ok_checkin_res.status_code}: {ok_checkin_res.text}"

        # 4. Attempt to create another advance booking overlapping Alice's reservation (PS1, booking_start + 15 mins)
        clash_booking_time = (booking_start + timedelta(minutes=15)).strftime("%H:%M")
        clash_booking_res = await client.post(
            "/api/bookings/create",
            json={
                "customerName": "Charlie Gamer",
                "stationId": "PS1",
                "sessionMode": "Solo",
                "bookingDate": today_str,
                "startTime": clash_booking_time,
                "durationMinutes": 60,
                "totalAmount": 180.0,
                "advancePaid": 50.0,
                "status": "CONFIRMED",
            },
        )
        assert clash_booking_res.status_code == 409, f"Expected 409 Conflict, got {clash_booking_res.status_code}: {clash_booking_res.text}"
        detail_lower = clash_booking_res.json()["detail"].lower()
        assert "collision detected" in detail_lower or "already booked" in detail_lower

        # 5. Attempt advance booking that collides with Bob's live running session on PS1
        # Bob is running right now for 20 mins. Let's try booking starting in 5 mins
        live_clash_time = (datetime.now() + timedelta(minutes=5)).strftime("%H:%M")
        live_clash_res = await client.post(
            "/api/bookings/create",
            json={
                "customerName": "Dave Gamer",
                "stationId": "PS1",
                "sessionMode": "Solo",
                "bookingDate": today_str,
                "startTime": live_clash_time,
                "durationMinutes": 30,
                "totalAmount": 100.0,
                "advancePaid": 50.0,
                "status": "CONFIRMED",
            },
        )
        assert live_clash_res.status_code == 409, f"Expected 409 Conflict with live session, got {live_clash_res.status_code}: {live_clash_res.text}"
        detail_live_lower = live_clash_res.json()["detail"].lower()
        assert "collision detected" in detail_live_lower or "occupied until" in detail_live_lower
