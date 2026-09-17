from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

# Engine configuration
connect_args = {}
if "sqlite" in settings.DATABASE_URL:
    connect_args["check_same_thread"] = False

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.ECHO_SQL,
    future=True,
    pool_pre_ping=True if "sqlite" not in settings.DATABASE_URL else False,
    connect_args=connect_args,
)

async_session_factory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass
