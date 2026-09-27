"""
Test Data Cleansing Script
Safely purges synthetic development/test data from the database
without altering canonical stations, console rooms, or base menu items.

Usage:
    python scripts/clean_test_data.py --dry-run
    python scripts/clean_test_data.py --force
"""
import argparse
import asyncio
import os
import sys

# Ensure backend root is on python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import select, delete, or_
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.core.config import settings
from app.core.database import async_session_factory as default_session_factory
from app.models.entities import Session, Order, OrderItem, User, AdvanceBookingRecord


async def get_working_session_factory():
    """Returns working session factory, falling back to local SQLite if Postgres is offline."""
    try:
        async with default_session_factory() as session:
            await session.execute(select(1))
            return default_session_factory
    except Exception:
        sqlite_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "gaming_cafe_dev.db"))
        if os.path.exists(sqlite_path):
            print(f"[*] Postgres offline. Switching to local SQLite: {sqlite_path}")
            engine = create_async_engine(f"sqlite+aiosqlite:///{sqlite_path}")
            return async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
        raise


async def clean_test_data(dry_run: bool = True):
    print("=" * 70)
    print(f"[CLEANUP] GAMING CAFE TEST DATA CLEANSING (Dry Run: {dry_run})")
    print("=" * 70)

    try:
        session_factory = await get_working_session_factory()
    except Exception as exc:
        print(f"[ERROR] Could not connect to database: {exc}")
        return

    async with session_factory() as db:
        # 1. Identify test users
        user_stmt = select(User).where(
            or_(
                User.name.ilike("%test%"),
                User.phone.like("98765%"),
                User.phone.in_(["0000000000", "1234567890", "9999999999"]),
            )
        )
        test_users = (await db.execute(user_stmt)).scalars().all()
        test_user_ids = [u.id for u in test_users]
        print(f"[*] Found {len(test_users)} synthetic test user(s).")

        # 2. Identify test advance bookings
        booking_stmt = select(AdvanceBookingRecord).where(
            or_(
                AdvanceBookingRecord.customer_name.ilike("%test%"),
                AdvanceBookingRecord.phone_number.like("98765%"),
                AdvanceBookingRecord.phone_number.in_(["0000000000", "1234567890"]),
            )
        )
        test_bookings = (await db.execute(booking_stmt)).scalars().all()
        print(f"[*] Found {len(test_bookings)} synthetic advance booking(s).")

        # 3. Identify test sessions
        session_stmt = select(Session).where(
            or_(
                Session.customer_name.ilike("%test%"),
                Session.customer_phone.like("98765%"),
                Session.user_id.in_(test_user_ids) if test_user_ids else False,
            )
        )
        test_sessions = (await db.execute(session_stmt)).scalars().all()
        test_session_ids = [s.id for s in test_sessions]
        print(f"[*] Found {len(test_sessions)} synthetic session(s).")

        # 4. Identify orders attached to test sessions
        if test_session_ids:
            order_stmt = select(Order).where(Order.session_id.in_(test_session_ids))
            test_orders = (await db.execute(order_stmt)).scalars().all()
        else:
            test_orders = []
        print(f"[*] Found {len(test_orders)} test order(s).")

        if dry_run:
            print("\n[DRY RUN COMPLETE] No records were modified. Run with --force to execute.")
            return

        # Execute cascading purge
        for o in test_orders:
            await db.delete(o)
        for s in test_sessions:
            await db.delete(s)
        for b in test_bookings:
            await db.delete(b)
        for u in test_users:
            if u.role != "ADMIN":  # Preserve root admin
                await db.delete(u)

        await db.commit()
        print("\n[SUCCESS] Successfully purged test records. Canonical inventory and stations preserved.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Purge synthetic test data from database.")
    parser.add_argument("--force", action="store_true", help="Execute deletions (disables dry-run).")
    parser.add_argument("--dry-run", action="store_true", default=False, help="Preview deletions without modifying database.")
    args = parser.parse_args()

    is_dry = not args.force
    asyncio.run(clean_test_data(dry_run=is_dry))
