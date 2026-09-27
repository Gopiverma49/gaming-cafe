import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, status
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.models.entities import AdvanceBookingRecord
from app.services.ws_notifier import buffer_ws_event

logger = logging.getLogger("booking_routes")

router = APIRouter(prefix="/bookings", tags=["Advance Bookings"])


class BookingPayload(BaseModel):
    bookingId: Optional[str] = None
    id: Optional[str] = None
    customerName: str
    phoneNumber: Optional[str] = None
    customerPhone: Optional[str] = None
    stationId: str
    sessionMode: str = "Solo"
    bookingDate: str
    startTime: str
    durationMinutes: int = 60
    endTime: Optional[str] = None
    advancePaid: float = 0.0
    totalAmount: float = 180.0
    remainingBalance: Optional[float] = None
    status: str = "CONFIRMED"


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


@router.get("", response_model=List[dict])
async def list_advance_bookings(
    station_id: Optional[str] = None,
    booking_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Returns all advance bookings with real-time status.
    """
    stmt = select(AdvanceBookingRecord).order_by(
        AdvanceBookingRecord.booking_date.asc(),
        AdvanceBookingRecord.start_time.asc()
    )
    if station_id:
        stmt = stmt.where(AdvanceBookingRecord.station_id == station_id)
    if booking_date:
        stmt = stmt.where(AdvanceBookingRecord.booking_date == booking_date)

    res = await db.execute(stmt)
    records = res.scalars().all()
    return [_serialize_booking(b) for b in records]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_advance_booking(
    payload: BookingPayload,
    db: AsyncSession = Depends(get_db),
):
    """
    Creates an advance booking, persists to DB, and broadcasts BOOKING_CREATED across WebSocket.
    """
    raw_id = payload.bookingId or payload.id or f"BK-{int(datetime.now(timezone.utc).timestamp() * 1000) % 100000}"
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
