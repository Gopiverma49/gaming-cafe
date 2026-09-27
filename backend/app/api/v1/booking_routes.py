import logging
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.rate_limiter import RateLimiter
from app.models.entities import AdvanceBookingRecord
from app.services.ws_notifier import buffer_ws_event

logger = logging.getLogger("booking_routes")

router = APIRouter(prefix="/bookings", tags=["Advance Bookings"])


class BookingPayload(BaseModel):
    bookingId: Optional[str] = None
    id: Optional[str] = None
    customerName: str = Field(..., min_length=2, max_length=100)
    phoneNumber: Optional[str] = Field(None, max_length=20)
    customerPhone: Optional[str] = Field(None, max_length=20)
    stationId: str = Field(..., max_length=50)
    sessionMode: str = Field("Solo", max_length=50)
    bookingDate: str = Field(..., max_length=20)
    startTime: str = Field(..., max_length=10)
    durationMinutes: int = Field(60, ge=15, le=720)
    endTime: Optional[str] = Field(None, max_length=10)
    advancePaid: float = Field(0.0, ge=0.0)
    totalAmount: float = Field(180.0, ge=0.0)
    remainingBalance: Optional[float] = None
    status: str = Field("CONFIRMED", max_length=20)
    website: Optional[str] = Field(default=None, max_length=50, description="Honeypot field for bot spam detection")


def _serialize_booking(b: AdvanceBookingRecord) -> dict:
    return {
        "bookingId": b.id,
        "id": b.id,
        "customerName": b.customer_name,
        "phoneNumber": b.phone_number,
        "customerPhone": b.phone_number,
        "stationId": b.station_id,
        "stationName": b.station_id,
        "sessionMode": b.session_mode,
        "bookingDate": b.booking_date,
        "startTime": b.start_time,
        "durationMinutes": b.duration_minutes,
        "endTime": b.end_time,
        "advancePaid": float(b.advance_paid),
        "totalAmount": float(b.total_amount),
        "remainingBalance": float(b.remaining_balance),
        "status": b.status,
        "createdAt": b.created_at.isoformat() if b.created_at else None,
    }


def parse_booking_range(booking_date: str, start_time: str, duration_minutes: int):
    """
    Parses a booking's date and start time into naive (start_dt, end_dt) datetimes,
    correctly handling both YYYY-MM-DD and DD-MM-YYYY formats, as well as 12h/24h time.
    """
    if not booking_date or not start_time:
        return None, None
    try:
        clean_date = booking_date.split("T")[0].strip()
        parts = [int(p) for p in clean_date.split("-") if p.isdigit()]
        if len(parts) == 3:
            if parts[0] > 1000:
                y, m, d = parts[0], parts[1], parts[2]
            elif parts[2] > 1000:
                y, m, d = parts[2], parts[1], parts[0]
            else:
                return None, None
        else:
            return None, None

        t_clean = start_time.strip().upper()
        is_pm = "PM" in t_clean
        is_am = "AM" in t_clean
        t_clean = t_clean.replace("PM", "").replace("AM", "").strip()
        t_parts = [int(p) for p in t_clean.split(":") if p.strip().isdigit()]
        if not t_parts:
            return None, None
        h = t_parts[0]
        mins = t_parts[1] if len(t_parts) > 1 else 0
        if is_pm and h < 12:
            h += 12
        elif is_am and h == 12:
            h = 0

        start_dt = datetime(y, m, d, h, mins)
        dur = max(1, int(duration_minutes or 60))
        end_dt = start_dt + timedelta(minutes=dur)
        return start_dt, end_dt
    except Exception:
        return None, None


@router.get("", response_model=List[dict])
async def list_advance_bookings(
    station_id: Optional[str] = None,
    booking_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Returns all advance bookings with real-time status.
    Keeps newest / latest check-ins and bookings at the top.
    """
    stmt = select(AdvanceBookingRecord).order_by(
        AdvanceBookingRecord.created_at.desc(),
        AdvanceBookingRecord.booking_date.desc(),
        AdvanceBookingRecord.start_time.desc()
    )
    if station_id:
        stmt = stmt.where(AdvanceBookingRecord.station_id == station_id)
    if booking_date:
        stmt = stmt.where(AdvanceBookingRecord.booking_date == booking_date)

    res = await db.execute(stmt)
    records = res.scalars().all()
    return [_serialize_booking(b) for b in records]


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(RateLimiter(max_requests=20, window_seconds=60, scope="booking_create"))],
)
async def create_advance_booking(
    payload: BookingPayload,
    db: AsyncSession = Depends(get_db),
):
    """
    Creates an advance booking, persists to DB, and broadcasts BOOKING_CREATED across WebSocket.
    Enforces atomic conflict rejection: blocks double-booking of same station for overlapping intervals.
    """
    if payload.website:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Spam bot booking rejected.",
        )
    raw_id = payload.bookingId or payload.id or f"BK-{uuid.uuid4().hex[:8]}"
    phone = payload.phoneNumber or payload.customerPhone or None
    dur = payload.durationMinutes or 60
    end_t = payload.endTime
    if not end_t:
        parts = [int(p) for p in payload.startTime.split(":") if p.isdigit()]
        if len(parts) == 2:
            total_m = parts[0] * 60 + parts[1] + dur
            end_t = f"{((total_m // 60) % 24):02d}:{(total_m % 60):02d}"
        else:
            end_t = payload.startTime

    # Backend Collision Enforcement: check against other CONFIRMED bookings on the same station
    target_station = payload.stationId.strip().upper()
    cand_start, cand_end = parse_booking_range(payload.bookingDate, payload.startTime, dur)

    if cand_start and cand_end:
        # Check against existing confirmed bookings for this station
        existing_stmt = select(AdvanceBookingRecord).where(
            AdvanceBookingRecord.station_id == target_station,
            AdvanceBookingRecord.status == "CONFIRMED",
            AdvanceBookingRecord.id != raw_id,
        )
        existing_records = (await db.execute(existing_stmt)).scalars().all()
        for eb in existing_records:
            eb_start, eb_end = parse_booking_range(eb.booking_date, eb.start_time, eb.duration_minutes)
            if eb_start and eb_end:
                # Collision condition: cand_start < eb_end and cand_end > eb_start
                if cand_start < eb_end and cand_end > eb_start:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            f"Collision detected! Station {target_station} is already booked from "
                            f"{eb.start_time} to {eb.end_time} for {eb.customer_name} on {eb.booking_date}."
                        ),
                    )

    total_amt = Decimal(str(payload.totalAmount or 180.0))
    adv_paid = Decimal(str(payload.advancePaid or 0.0))
    rem_bal = Decimal(str(payload.remainingBalance if payload.remainingBalance is not None else max(0.0, float(total_amt - adv_paid))))

    # Upsert if already exists
    existing = await db.get(AdvanceBookingRecord, raw_id)
    if existing:
        existing.customer_name = payload.customerName
        existing.phone_number = phone
        existing.station_id = payload.stationId
        existing.session_mode = payload.sessionMode
        existing.booking_date = payload.bookingDate
        existing.start_time = payload.startTime
        existing.duration_minutes = dur
        existing.end_time = end_t
        existing.advance_paid = adv_paid
        existing.total_amount = total_amt
        existing.remaining_balance = rem_bal
        existing.status = payload.status
        booking = existing
    else:
        booking = AdvanceBookingRecord(
            id=raw_id,
            customer_name=payload.customerName,
            phone_number=phone,
            station_id=payload.stationId,
            session_mode=payload.sessionMode,
            booking_date=payload.bookingDate,
            start_time=payload.startTime,
            duration_minutes=dur,
            end_time=end_t,
            advance_paid=adv_paid,
            total_amount=total_amt,
            remaining_balance=rem_bal,
            status=payload.status,
        )
        db.add(booking)

    serialized = _serialize_booking(booking)
    buffer_ws_event(
        db,
        channel="admin",
        event_type="BOOKING_CREATED",
        payload=serialized,
    )
    buffer_ws_event(
        db,
        channel="customer",
        event_type="BOOKING_CREATED",
        payload=serialized,
    )

    await db.commit()
    return serialized


@router.post("/{booking_id}/cancel")
async def cancel_advance_booking(
    booking_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Cancels an advance booking, frees the slot, and broadcasts BOOKING_CANCELLED across WebSocket.
    """
    booking = await db.get(AdvanceBookingRecord, booking_id)
    if not booking:
        # Check by alternate query
        res = await db.execute(
            select(AdvanceBookingRecord).where(
                or_(
                    AdvanceBookingRecord.id == booking_id,
                    AdvanceBookingRecord.id == f"BK-{booking_id}",
                )
            )
        )
        booking = res.scalar_one_or_none()

    if booking:
        booking.status = "CANCELLED"
        serialized = _serialize_booking(booking)
    else:
        serialized = {"booking_id": booking_id, "id": booking_id, "status": "CANCELLED"}

    buffer_ws_event(
        db,
        channel="admin",
        event_type="BOOKING_CANCELLED",
        payload=serialized,
    )
    buffer_ws_event(
        db,
        channel="customer",
        event_type="BOOKING_CANCELLED",
        payload=serialized,
    )

    await db.commit()
    return {"message": "Booking cancelled successfully", "booking": serialized}


@router.delete("/{booking_id}")
async def delete_advance_booking(
    booking_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Deletes or marks booking cancelled and notifies all clients.
    """
    return await cancel_advance_booking(booking_id, db)
