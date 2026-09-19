import uuid
from decimal import Decimal
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict

from app.core.config import settings
from app.models.enums import OrderStatus, PaymentMethod


# Station Schemas
class StationBase(BaseModel):
    name: str = Field(..., max_length=50)
    tier: str = Field(..., max_length=20)  # STANDARD, VIP, SIMULATOR, CONSOLE
    hourly_rate: Decimal = Field(..., decimal_places=2, ge=Decimal("0.00"))


class StationCreate(StationBase):
    pass


class StationResponse(StationBase):
    id: uuid.UUID
    status: str

    model_config = ConfigDict(from_attributes=True)


class StationLiveResponse(BaseModel):
    id: uuid.UUID
    name: str
    tier: str
    hourly_rate: Decimal
    status: str  # AVAILABLE, OCCUPIED, RESERVED, MAINTENANCE
    active_session_id: Optional[uuid.UUID] = None
    started_at: Optional[datetime] = None
    elapsed_minutes: int = 0
    remaining_minutes: Optional[int] = None
    time_charge: Decimal = Decimal("0.00")
    orders_charge: Decimal = Decimal("0.00")
    running_total: Decimal = Decimal("0.00")
    active_orders_count: int = 0

    model_config = ConfigDict(from_attributes=True)


# Session Schemas
class CheckInRequest(BaseModel):
    station_id: uuid.UUID
    allocated_minutes: Optional[int] = Field(
        default=settings.DEFAULT_SESSION_DURATION_MINUTES,
        ge=15,
        description="Initial allocated time window",
    )


class TransferRequest(BaseModel):
    session_id: uuid.UUID
    target_station_id: uuid.UUID


class CheckoutRequest(BaseModel):
    session_id: uuid.UUID
    payment_method: PaymentMethod


class SessionResponse(BaseModel):
    id: uuid.UUID
    station_id: uuid.UUID
    station_name: Optional[str] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    status: str
    total_amount: Decimal

    model_config = ConfigDict(from_attributes=True)


# Menu & Order Schemas
class MenuItemResponse(BaseModel):
    id: uuid.UUID
    name: str
    category: str
    price: Decimal
    is_available: bool

    model_config = ConfigDict(from_attributes=True)


class OrderItemCreate(BaseModel):
    menu_item_id: uuid.UUID
    quantity: int = Field(..., gt=0)


class OrderItemResponse(BaseModel):
    id: uuid.UUID
    menu_item_id: uuid.UUID
    menu_item_name: str
    quantity: int
    unit_price: Decimal
    subtotal: Decimal

    model_config = ConfigDict(from_attributes=True)


class OrderCreateRequest(BaseModel):
    items: List[OrderItemCreate] = Field(..., min_length=1)
    notes: Optional[str] = None


class OrderResponse(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    station_name: Optional[str] = None
    status: OrderStatus
    created_at: datetime
    items: List[OrderItemResponse]
    total_amount: Decimal

    model_config = ConfigDict(from_attributes=True)


class OrderStatusUpdateRequest(BaseModel):
    status: OrderStatus


# Payment & Checkout Schemas
class CheckoutResponse(BaseModel):
    session_id: uuid.UUID
    payment_id: uuid.UUID
    station_charge: Decimal
    orders_charge: Decimal
    total_amount: Decimal
    payment_method: str
    payment_status: str
    upi_qr_string: Optional[str] = None


class PaymentResponse(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    amount: Decimal
    method: str
    status: str
    idempotency_key: str

    model_config = ConfigDict(from_attributes=True)


# Customer Desk View
class CustomerDeskSession(BaseModel):
    session_id: uuid.UUID
    station_id: uuid.UUID
    station_name: str
    tier: str
    hourly_rate: Decimal
    started_at: datetime
    elapsed_minutes: int
    allocated_minutes: int
    remaining_minutes: int
    time_charge: Decimal
    orders_charge: Decimal
    running_total: Decimal
    active_orders: List[OrderResponse]


# Auth Schemas
class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    scope: str
    expires_in: int


class LoginRequest(BaseModel):
    username: str
    password: str


class CustomerTokenRequest(BaseModel):
    desk_id: uuid.UUID
    session_id: uuid.UUID
