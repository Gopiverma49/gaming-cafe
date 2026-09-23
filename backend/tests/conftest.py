import uuid
from decimal import Decimal
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.core.database import Base
from app.api.deps import get_db
from app.main import app
from app.models.entities import Station, MenuItem, PhysicalDevice
from app.models.enums import StationStatus


@pytest_asyncio.fixture
async def test_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Seed sample stations, physical consoles & menu
    async with async_session() as session:
        for dev_id in ["PS1", "PS2", "PS3", "VR1"]:
            session.add(PhysicalDevice(id=dev_id, name=dev_id, device_type="CONSOLE" if "PS" in dev_id else "VR", status=StationStatus.AVAILABLE.value))

        st1 = Station(
            id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
            name="TEST-RIG-01",
            tier="VIP",
            hourly_rate=Decimal("200.00"),
            status="AVAILABLE",
        )
        st2 = Station(
            id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
            name="TEST-RIG-02",
            tier="STANDARD",
            hourly_rate=Decimal("150.00"),
            status="AVAILABLE",
        )
        menu1 = MenuItem(
            id=uuid.UUID("33333333-3333-3333-3333-333333333333"),
            name="Energy Drink",
            category="Beverages",
            price=Decimal("100.00"),
            is_available=True,
        )
        session.add_all([st1, st2, menu1])
        await session.commit()

    async def override_get_db():
        async with async_session() as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db

    yield

    app.dependency_overrides.clear()
    await engine.dispose()
