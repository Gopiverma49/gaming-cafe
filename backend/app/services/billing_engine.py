import math
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Union
import uuid


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
    - Under 30 minutes: billed at minimum half-hour (0.5 hours).
    - Over 30 minutes: applies a 5-minute grace rollover, then uses ceiling division into 1-hour increments.
    - Quantizes final amount to two decimal places using ROUND_HALF_UP.
    """
    if not isinstance(hourly_rate, Decimal):
        hourly_rate = Decimal(str(hourly_rate))

    total_seconds = (ended_at - started_at).total_seconds()
    if total_seconds < 0:
        total_seconds = 0

    elapsed_seconds_dec = Decimal(str(int(total_seconds)))
    elapsed_minutes = elapsed_seconds_dec / Decimal("60")

    # Under 30 minutes or within 5-minute grace period of half-hour (up to 35 min)
    if elapsed_minutes <= Decimal("30"):
        billable_hours = Decimal("0.5")
    elif elapsed_minutes <= Decimal("35"):
        # 5-minute grace rollover applied to the 30-min threshold
        billable_hours = Decimal("0.5")
    else:
        # Over 35 minutes: apply 5-minute grace rollover, then ceiling division into 1-hour increments
        effective_minutes = elapsed_minutes - Decimal("5")
        # Exact ceiling division using Decimal
        billable_hours_int = -(-int(effective_minutes) // 60)
        billable_hours = Decimal(str(max(1, billable_hours_int)))

    raw_total = billable_hours * hourly_rate
    return raw_total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def generate_upi_qr_string(
    merchant_vpa: str,
    merchant_name: str,
    amount: Decimal,
    session_id: Union[uuid.UUID, str],
) -> str:
    """
    Generates NPCI/UPI standard payment payload string.
    Zero floating point, uses exact 2 decimal places.
    """
    formatted_amount = f"{amount.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP):.2f}"
    return f"upi://pay?pa={merchant_vpa}&pn={merchant_name}&am={formatted_amount}&cu=INR&tn=GamingCafe_Desk_{session_id}"
