import uuid
from decimal import Decimal
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import (
    String,
    Numeric,
    Boolean,
    Integer,
    DateTime,
    ForeignKey,
    CheckConstraint,
    Index,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from app.core.database import Base


class Station(Base):
    __tablename__ = "stations"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    name: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    tier: Mapped[str] = mapped_column(String(20), nullable=False)  # STANDARD, VIP, SIMULATOR
    hourly_rate: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="AVAILABLE", nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE')",
            name="ck_station_status",
        ),
    )

    sessions: Mapped[List["Session"]] = relationship("Session", back_populates="station", cascade="all, delete-orphan")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    station_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("stations.id", ondelete="RESTRICT"),
        nullable=False,
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('ACTIVE', 'COMPLETED', 'TRANSFERRED', 'CANCELLED')",
            name="ck_session_status",
        ),
        Index(
            "uq_active_station_session",
            "station_id",
            unique=True,
            postgresql_where=(status == "ACTIVE"),
        ),
    )

    station: Mapped["Station"] = relationship("Station", back_populates="sessions")
    orders: Mapped[List["Order"]] = relationship("Order", back_populates="session", cascade="all, delete-orphan")
    payments: Mapped[List["Payment"]] = relationship("Payment", back_populates="session", cascade="all, delete-orphan")


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    order_items: Mapped[List["OrderItem"]] = relationship("OrderItem", back_populates="menu_item")


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(20), default="QUEUED", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('QUEUED', 'PREPARING', 'SERVED', 'CANCELLED')",
            name="ck_order_status",
        ),
    )

    session: Mapped["Session"] = relationship("Session", back_populates="orders")
    items: Mapped[List["OrderItem"]] = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    order_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
    )
    menu_item_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("menu_items.id", ondelete="RESTRICT"),
        nullable=False,
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_order_item_quantity_positive"),
    )

    order: Mapped["Order"] = relationship("Order", back_populates="items")
    menu_item: Mapped["MenuItem"] = relationship("MenuItem", back_populates="order_items")


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    method: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="PENDING", nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "method IN ('CASH', 'UPI')",
            name="ck_payment_method",
        ),
        CheckConstraint(
            "status IN ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED')",
            name="ck_payment_status",
        ),
    )

    session: Mapped["Session"] = relationship("Session", back_populates="payments")
