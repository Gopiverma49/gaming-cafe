"""
Administrative Account Provisioning & Password Management CLI.
Allows deterministic cold-start creation and credential rotation for administrators.

Usage:
  # From environment variables:
  python scripts/create_admin.py --from-env

  # Custom credentials:
  python scripts/create_admin.py --name "Master Admin" --phone "9999999999" --password "super_secret_pass_2026"
"""

import argparse
import asyncio
import os
import socket
import sys

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
        # Auto-fallback to local SQLite file for development environments
        settings.DATABASE_URL = "sqlite+aiosqlite:///./gaming_cafe_dev.db"

from sqlalchemy import select
from app.core.database import async_session_factory
from app.core.security import get_password_hash
from app.models.entities import User


async def create_or_update_admin(name: str, phone: str, password: str) -> None:
    if not phone or len(phone.strip()) < 4:
        raise ValueError("A valid phone number or identifier is required.")
    if not password or len(password.strip()) < 8:
        raise ValueError("Password must be at least 8 characters long.")

    clean_phone = phone.strip()
    clean_name = name.strip() or "System Administrator"

    async with async_session_factory() as db:
        # Check if user with phone already exists
        stmt = select(User).where(User.phone == clean_phone)
        existing = (await db.execute(stmt)).scalar_one_or_none()

        pw_hash = get_password_hash(password)

        if existing:
            print(f"[ADMIN CLI] User with identifier '{clean_phone}' already exists.")
            existing.role = "ADMIN"
            existing.password_hash = pw_hash
            existing.name = clean_name
            await db.commit()
            print(f"[ADMIN CLI] SUCCESS: Administrator account '{clean_name}' ({clean_phone}) password and role updated.")
        else:
            new_admin = User(
                name=clean_name,
                phone=clean_phone,
                password_hash=pw_hash,
                role="ADMIN",
            )
            db.add(new_admin)
            await db.commit()
            print(f"[ADMIN CLI] SUCCESS: Created new Administrator '{clean_name}' ({clean_phone}).")


def main():
    parser = argparse.ArgumentParser(description="Provision or rotate an Administrator account.")
    parser.add_argument("--from-env", action="store_true", help="Use ADMIN_USERNAME, ADMIN_PHONE, and ADMIN_PASSWORD from environment")
    parser.add_argument("--name", default="System Administrator", help="Admin display name")
    parser.add_argument("--phone", default="", help="Admin phone number or unique identifier")
    parser.add_argument("--password", default="", help="Admin plaintext password (min 8 chars)")

    args = parser.parse_args()

    if args.from_env:
        name = "System Administrator"
        phone = getattr(settings, "ADMIN_PHONE", "0000000000")
        password = settings.ADMIN_PASSWORD
        print(f"[ADMIN CLI] Provisioning from environment: user='{name}', phone='{phone}'...")
    else:
        name = args.name
        phone = args.phone or getattr(settings, "ADMIN_PHONE", "0000000000")
        password = args.password or settings.ADMIN_PASSWORD

    if not password:
        print("[ADMIN CLI] ERROR: Password cannot be blank.", file=sys.stderr)
        sys.exit(1)

    try:
        asyncio.run(create_or_update_admin(name=name, phone=phone, password=password))
    except Exception as e:
        print(f"[ADMIN CLI] ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
