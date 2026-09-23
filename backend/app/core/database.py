from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

db_url = settings.async_database_url

# Engine configuration
connect_args = {}
engine_kwargs: dict = {
    "echo": settings.ECHO_SQL,
    "future": True,
}

if "sqlite" in db_url:
    connect_args["check_same_thread"] = False
    connect_args["timeout"] = 15
    engine_kwargs["connect_args"] = connect_args
else:
    # High-performance asyncpg connection pool for PostgreSQL
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_size"] = 20
    engine_kwargs["max_overflow"] = 10
    engine_kwargs["pool_timeout"] = 15
    engine_kwargs["pool_recycle"] = 1800

engine = create_async_engine(db_url, **engine_kwargs)

if "sqlite" in db_url:
    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        """
        Enables SQLite Write-Ahead Logging (WAL) and memory temp-store
        to ensure lock-free concurrent reads during admin mutations and checkouts.
        """
        try:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute("PRAGMA busy_timeout=10000")
            cursor.execute("PRAGMA temp_store=MEMORY")
            cursor.close()
        except Exception:
            pass

async_session_factory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass
