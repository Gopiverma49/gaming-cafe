from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Union
import uuid

from app.core.config import settings
from app.services.order_service import ensure_utc, CURRENCY_QUANTIZATION

SECONDS_PER_MINUTE = Decimal("60")
MINIMUM_BILLING_MINUTES = Decimal(str(settings.MINIMUM_BILLING_MINUTES))
GRACE_PERIOD_MINUTES = Decimal(str(settings.GRACE_PERIOD_MINUTES))
GRACE_THRESHOLD_MINUTES = MINIMUM_BILLING_MINUTES + GRACE_PERIOD_MINUTES  # 35 min default
MINIMUM_BILLABLE_HOURS = Decimal(str(settings.MINIMUM_BILLABLE_HOURS))


def calculate_station_charge(
    started_at: datetime,
    ended_at: datetime,
    hourly_rate: Union[Decimal, str, int, float],
) -> Decimal:
    """
    Strict financial calculation using Python Decimal with ROUND_HALF_UP precision.
    Zero floating-point arithmetic.

    Rules:
    - Elapsed minutes computed as exact Decimal.
    - Under 30 minutes (or within 5-minute grace period up to 35 min): billed at minimum half-hour (0.5 hours).
    - Over 35 minutes: applies 5-minute grace rollover, then uses ceiling division into 1-hour increments.
    - Quantizes final amount to two decimal places using ROUND_HALF_UP.
    """
    if not isinstance(hourly_rate, Decimal):
        hourly_rate = Decimal(str(hourly_rate))

    # Normalize timezone awareness to avoid offset-naive vs offset-aware TypeError
    started_utc = ensure_utc(started_at)
    ended_utc = ensure_utc(ended_at)

    total_seconds = max(0, int((ended_utc - started_utc).total_seconds()))
    elapsed_minutes = Decimal(str(total_seconds)) / SECONDS_PER_MINUTE

    # Guard clause: minimum half-hour billing for sessions within the grace threshold
    if elapsed_minutes <= GRACE_THRESHOLD_MINUTES:
        billable_hours = MINIMUM_BILLABLE_HOURS
    else:
        # Over grace threshold: apply 5-minute grace rollover, then ceiling division into 1-hour increments
        effective_minutes = elapsed_minutes - GRACE_PERIOD_MINUTES
        billable_hours_int = -(-int(effective_minutes) // 60)
        billable_hours = Decimal(str(max(1, billable_hours_int)))

    return (billable_hours * hourly_rate).quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP)


def generate_upi_qr_string(
    merchant_vpa: str,
    merchant_name: str,
    amount: Decimal,
    session_id: Union[uuid.UUID, str],
    currency: str = settings.UPI_CURRENCY,
) -> str:
    """
    Generates NPCI/UPI standard payment payload string.
    Zero floating point, uses exact 2 decimal places.
    """
    formatted_amount = f"{amount.quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP):.2f}"
    return f"upi://pay?pa={merchant_vpa}&pn={merchant_name}&am={formatted_amount}&cu={currency}&tn=GamingCafe_Desk_{session_id}"

