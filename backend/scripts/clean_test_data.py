"""
Test Data Cleansing Script for Production Deployment.
Scans and safely purges mock/test sessions, test orders, and test advance bookings
prior to production launch or post-staging verification.

Usage:
  python scripts/clean_test_data.py --dry-run
  python scripts/clean_test_data.py --force
"""

import argparse
import asyncio
import os
import socket
import sys
from typing import List

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Pre-check database reachability before initializing connection engine
from app.core.config import settings

def is_port_open(host: str, port: int, timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False

raw_db_url = settings.DATABASE_URL
if "localhost:5432" in raw_db_url or "127.0.0.1:5432" in raw_db_url:
    if not is_port_open("127.0.0.1", 5432, timeout=0.3):
        # Auto-fallback to local SQLite file for development/staging environments
        settings.DATABASE_URL = "sqlite+aiosqlite:///./gaming_cafe_dev.db"

from sqlalchemy import select, delete, or_, func
from app.core.database import async_session_factory
from app.models.entities import Session, Order, OrderItem, Payment, AdvanceBookingRecord


TEST_NAME_PATTERNS = ["%test%", "%mock%", "%dummy%", "%sample%"]
TEST_PHONE_PATTERNS = ["%0000000000%", "%1234567890%", "%9999999999%", "%1111111111%"]


async def clean_test_data(dry_run: bool = True, verbose: bool = False):
    print("=" * 70)
    print("[TEST DATA CLEANSING] Scanning database for test/mock artifacts...")
    print(f"   Target Database: {settings.DATABASE_URL.split('@')[-1]}")
    print(f"   Mode: {'PREVIEW (DRY-RUN)' if dry_run else 'ACTIVE PURGE (--force)'}")
    print("=" * 70)

    async with async_session_factory() as db:
        # 1. Identify test sessions
        session_filters = []
        for p in TEST_NAME_PATTERNS:
            session_filters.append(func.lower(Session.customer_name).like(p))
        for p in TEST_PHONE_PATTERNS:
            session_filters.append(Session.customer_phone.like(p))

        test_sessions_res = await db.execute(
            select(Session).where(or_(*session_filters))
        )
        test_sessions = test_sessions_res.scalars().all()
        session_ids = [s.id for s in test_sessions]

        # 2. Identify test advance bookings
        booking_filters = []
        for p in TEST_NAME_PATTERNS:
            booking_filters.append(func.lower(AdvanceBookingRecord.customer_name).like(p))
        for p in TEST_PHONE_PATTERNS:
            booking_filters.append(AdvanceBookingRecord.phone_number.like(p))

        test_bookings_res = await db.execute(
            select(AdvanceBookingRecord).where(or_(*booking_filters))
        )
        test_bookings = test_bookings_res.scalars().all()

        # 3. Identify orders tied to test sessions
        test_orders = []
        if session_ids:
            test_orders_res = await db.execute(
                select(Order).where(Order.session_id.in_(session_ids))
            )
            test_orders = test_orders_res.scalars().all()

        print(f"\nIdentified Test Records:")
        print(f"   * Test Sessions:         {len(test_sessions)}")
        print(f"   * Linked Orders:         {len(test_orders)}")
        print(f"   * Test Advance Bookings: {len(test_bookings)}")

        if verbose:
            if test_sessions:
                print("\n   Sample Sessions:")
                for s in test_sessions[:5]:
                    print(f"     - ID: {s.id}, Customer: {s.customer_name}, Phone: {s.customer_phone}")
            if test_bookings:
                print("\n   Sample Bookings:")
                for b in test_bookings[:5]:
                    print(f"     - ID: {b.id}, Customer: {b.customer_name}, Date: {b.booking_date}")

        if dry_run:
            print("\n[DRY-RUN COMPLETE] No database modifications were committed.")
            print("Run with '--force' to permanently delete identified test records.\n")
            return

        # Perform atomic deletion
        if session_ids:
            order_ids = [o.id for o in test_orders]
            if order_ids:
                await db.execute(delete(OrderItem).where(OrderItem.order_id.in_(order_ids)))
                await db.execute(delete(Order).where(Order.id.in_(order_ids)))

            await db.execute(delete(Payment).where(Payment.session_id.in_(session_ids)))
            await db.execute(delete(Session).where(Session.id.in_(session_ids)))

        booking_ids = [b.id for b in test_bookings]
        if booking_ids:
            await db.execute(delete(AdvanceBookingRecord).where(AdvanceBookingRecord.id.in_(booking_ids)))

        await db.commit()
        print("\n[PURGE SUCCESSFUL] All test records cleanly removed from database.")
        print("=" * 70 + "\n")


def main():
    parser = argparse.ArgumentParser(description="Clean test/mock records from database before production launch.")
    parser.add_argument("--force", action="store_true", help="Execute permanent deletion (default is dry-run)")
    parser.add_argument("--dry-run", action="store_true", default=False, help="Preview records without deleting")
    parser.add_argument("--verbose", "-v", action="store_true", help="Print details of matched records")
    args = parser.parse_args()

    dry_run = not args.force
    asyncio.run(clean_test_data(dry_run=dry_run, verbose=args.verbose))


if __name__ == "__main__":
    main()
