import uuid
from decimal import Decimal
from datetime import datetime
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
    Uuid,
    JSON,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import (
    StationStatus,
    SessionStatus,
    OrderStatus,
    PaymentStatus,
)


class Station(Base):
    __tablename__ = "stations"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    name: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    tier: Mapped[str] = mapped_column(String(20), nullable=False)  # STANDARD, VIP, SIMULATOR, CONSOLE
    hourly_rate: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    pricing_tiers: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=list)
    status: Mapped[str] = mapped_column(String(20), default=StationStatus.AVAILABLE.value, nullable=False)

    @property
    def default_hourly_rate(self) -> Decimal:
        return self.hourly_rate

    __table_args__ = (
        CheckConstraint(
            "status IN ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE')",
            name="ck_station_status",
        ),
    )

    sessions: Mapped[List["Session"]] = relationship("Session", back_populates="station", cascade="all, delete-orphan")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="CUSTOMER", nullable=False)  # CUSTOMER, ADMIN
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    sessions: Mapped[List["Session"]] = relationship("Session", back_populates="user")


class PhysicalDevice(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)  # 'PS1', 'PS2', 'PS3', 'VR1'
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    device_type: Mapped[str] = mapped_column(String(50), default="CONSOLE", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default=StationStatus.AVAILABLE.value, nullable=False)
    current_session_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid(as_uuid=True), nullable=True)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    station_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("stations.id", ondelete="RESTRICT"),
        nullable=False,
    )
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    customer_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    customer_phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(20), default=SessionStatus.ACTIVE.value, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    allocated_minutes: Mapped[int] = mapped_column(Integer, default=60, nullable=True)
    tier_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    category_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    device_name: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    station_name: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    console_room: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    @property
    def console(self) -> str:
        return self.console_room or self.device_name or ""

    @property
    def room(self) -> str:
        return self.console

    __table_args__ = (
        CheckConstraint(
            "status IN ('ACTIVE', 'COMPLETED', 'TRANSFERRED', 'CANCELLED')",
            name="ck_session_status",
        ),
        Index(
            "uq_active_device_session",
            "device_name",
            unique=True,
            postgresql_where=text("status = 'ACTIVE' AND device_name IS NOT NULL"),
            sqlite_where=text("status = 'ACTIVE' AND device_name IS NOT NULL"),
        ),
    )

    station: Mapped["Station"] = relationship("Station", back_populates="sessions")
    user: Mapped[Optional["User"]] = relationship("User", back_populates="sessions")
    orders: Mapped[List["Order"]] = relationship("Order", back_populates="session", cascade="all, delete-orphan")
    payments: Mapped[List["Payment"]] = relationship("Payment", back_populates="session", cascade="all, delete-orphan")


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    stock: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    min_stock_alert: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    order_items: Mapped[List["OrderItem"]] = relationship("OrderItem", back_populates="menu_item", cascade="all, delete-orphan")


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    customer_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default=OrderStatus.QUEUED.value, nullable=False)
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
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    order_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
    )
    menu_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
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
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sessions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    method: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default=PaymentStatus.PENDING.value, nullable=False)
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
