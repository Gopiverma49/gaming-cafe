import logging
from typing import Any, Dict
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession, AsyncEngine
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

logger = logging.getLogger("database")

db_url: str = settings.async_database_url

# Defensive Engine configuration
connect_args: Dict[str, Any] = {}
engine_kwargs: Dict[str, Any] = {
    "echo": settings.ECHO_SQL,
    "future": True,
}

if "sqlite" in db_url:
    connect_args["check_same_thread"] = False
    connect_args["timeout"] = settings.SQLITE_CONNECT_TIMEOUT_SECONDS
    engine_kwargs["connect_args"] = connect_args
else:
    # High-performance async connection pool for PostgreSQL
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_size"] = settings.DB_POOL_SIZE
    engine_kwargs["max_overflow"] = settings.DB_MAX_OVERFLOW
    engine_kwargs["pool_timeout"] = settings.DB_POOL_TIMEOUT_SECONDS
    engine_kwargs["pool_recycle"] = settings.DB_POOL_RECYCLE_SECONDS

engine: AsyncEngine = create_async_engine(db_url, **engine_kwargs)

if "sqlite" in db_url:
    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection: Any, connection_record: Any) -> None:
        """
        Enables SQLite Write-Ahead Logging (WAL), memory temp-store, and foreign key
        enforcement to ensure lock-free concurrent reads and strict relational integrity.
        """
        try:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute(f"PRAGMA busy_timeout={settings.SQLITE_BUSY_TIMEOUT_MS}")
            cursor.execute("PRAGMA temp_store=MEMORY")
            cursor.close()
        except Exception as exc:
            logger.debug("Failed to set SQLite pragma: %s", exc)

async_session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass
