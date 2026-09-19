import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import pytest

from app.services.billing_engine import calculate_station_charge, generate_upi_qr_string
from app.api.deps import IdempotencyCache


def test_station_charge_under_30_minutes():
    now = datetime.now(timezone.utc)
    # 15 minutes elapsed
    start = now - timedelta(minutes=15)
    hourly_rate = Decimal("200.00")

    charge = calculate_station_charge(start, now, hourly_rate)
    # Under 30 mins: minimum 0.5 hours -> 100.00
    assert charge == Decimal("100.00")


def test_station_charge_30_minutes_exact():
    now = datetime.now(timezone.utc)
    start = now - timedelta(minutes=30)
    hourly_rate = Decimal("200.00")

    charge = calculate_station_charge(start, now, hourly_rate)
    assert charge == Decimal("100.00")


def test_station_charge_5_minute_grace_period():
    now = datetime.now(timezone.utc)
    # 34 minutes: within 5-min grace rollover of 30 min block
    start_34 = now - timedelta(minutes=34)
    charge_34 = calculate_station_charge(start_34, now, Decimal("200.00"))
    assert charge_34 == Decimal("100.00")

    # 35 minutes: boundary of 5-min grace
    start_35 = now - timedelta(minutes=35)
    charge_35 = calculate_station_charge(start_35, now, Decimal("200.00"))
    assert charge_35 == Decimal("100.00")

    # 36 minutes: exceeds 5-minute grace, rolls into 1 hour increment
    start_36 = now - timedelta(minutes=36)
    charge_36 = calculate_station_charge(start_36, now, Decimal("200.00"))
    assert charge_36 == Decimal("200.00")


def test_station_charge_multihour_and_grace():
    now = datetime.now(timezone.utc)
    # 64 minutes: within 5-min grace of 60 minutes -> 1 hour
    start_64 = now - timedelta(minutes=64)
    charge_64 = calculate_station_charge(start_64, now, Decimal("150.00"))
    assert charge_64 == Decimal("150.00")

    # 66 minutes: exceeds grace -> 2 hours
    start_66 = now - timedelta(minutes=66)
    charge_66 = calculate_station_charge(start_66, now, Decimal("150.00"))
    assert charge_66 == Decimal("300.00")

    # 125 minutes: 120 + 5 min grace -> 2 hours
    start_125 = now - timedelta(minutes=125)
    charge_125 = calculate_station_charge(start_125, now, Decimal("100.00"))
    assert charge_125 == Decimal("200.00")

    # 126 minutes: rolls into 3 hours
    start_126 = now - timedelta(minutes=126)
    charge_126 = calculate_station_charge(start_126, now, Decimal("100.00"))
    assert charge_126 == Decimal("300.00")


def test_station_charge_decimal_round_half_up():
    now = datetime.now(timezone.utc)
    start = now - timedelta(minutes=20)
    # Rate with uneven decimals: 133.33 / 2 = 66.665 -> ROUND_HALF_UP = 66.67
    hourly_rate = Decimal("133.33")
    charge = calculate_station_charge(start, now, hourly_rate)
    assert charge == Decimal("66.67")


def test_generate_upi_qr_string():
    session_id = uuid.uuid4()
    amount = Decimal("450.50")
    qr_str = generate_upi_qr_string(
        merchant_vpa="gamingcafe@upi",
        merchant_name="ApexCyberLounge",
        amount=amount,
        session_id=session_id,
    )
    assert qr_str == f"upi://pay?pa=gamingcafe@upi&pn=ApexCyberLounge&am=450.50&cu=INR&tn=GamingCafe_Desk_{session_id}"


def test_lexicographical_id_sorting():
    id_a = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    id_b = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")

    # Sorting should always produce min followed by max
    sorted_order_1 = sorted([id_b, id_a], key=lambda x: str(x))
    assert sorted_order_1[0] == id_a
    assert sorted_order_1[1] == id_b

    sorted_order_2 = sorted([id_a, id_b], key=lambda x: str(x))
    assert sorted_order_2[0] == id_a
    assert sorted_order_2[1] == id_b


def test_idempotency_cache():
    cache = IdempotencyCache(ttl=60)
    key = "test-key-123"
    payload_hash = "abc123hash"

    cache.set(key, payload_hash, 200, b'{"status": "ok"}', {"content-type": "application/json"})
    entry = cache.get(key)
    assert entry is not None
    assert entry["payload_hash"] == payload_hash
    assert entry["status_code"] == 200
    assert entry["body"] == b'{"status": "ok"}'


def test_idempotency_cache_lru_eviction():
    # Test bounded capacity and eviction of oldest entry
    cache = IdempotencyCache(ttl=3600, max_entries=2)
    cache.set("k1", "h1", 200, b"r1", {})
    cache.set("k2", "h2", 200, b"r2", {})
    assert cache.get("k1") is not None
    assert cache.get("k2") is not None

    # Adding third key must evict least recently used (which is k1 because k2 was touched last, or k1 if k2 was accessed)
    # Since k2 was queried last, k1 is least recently used
    cache.set("k3", "h3", 200, b"r3", {})
    assert cache.get("k1") is None
    assert cache.get("k2") is not None
    assert cache.get("k3") is not None
