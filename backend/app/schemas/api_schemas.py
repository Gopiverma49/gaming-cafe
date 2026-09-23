import uuid
from decimal import Decimal
from datetime import datetime
from typing import List, Optional, Any
from pydantic import BaseModel, Field, ConfigDict, model_validator

from app.core.config import settings
from app.models.enums import OrderStatus, PaymentMethod


# Pricing Tier Schema
class PricingTier(BaseModel):
    duration_min: int = Field(..., gt=0)
    price: Decimal = Field(..., ge=Decimal("0.00"))
    label: str = Field(..., max_length=50)


# Station Schemas
class StationBase(BaseModel):
    name: str = Field(..., max_length=50)
    tier: str = Field(..., max_length=20)  # STANDARD, VIP, SIMULATOR, CONSOLE
    hourly_rate: Decimal = Field(..., decimal_places=2, ge=Decimal("0.00"))
    pricing_tiers: Optional[List[PricingTier]] = Field(default_factory=list)


class StationCreate(BaseModel):
    name: str = Field(..., max_length=50)
    tier: Optional[str] = Field(default="CONSOLE", max_length=20)
    hourly_rate: Optional[Decimal] = Field(None, decimal_places=2, ge=Decimal("0.00"))
    default_hourly_rate: Optional[Decimal] = Field(None, decimal_places=2, ge=Decimal("0.00"))
    pricing_tiers: Optional[List[PricingTier]] = None


class StationUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=50)
    tier: Optional[str] = Field(None, max_length=20)
    hourly_rate: Optional[Decimal] = Field(None, decimal_places=2, ge=Decimal("0.00"))
    default_hourly_rate: Optional[Decimal] = Field(None, decimal_places=2, ge=Decimal("0.00"))
    pricing_tiers: Optional[List[PricingTier]] = None
    status: Optional[str] = Field(None, max_length=20)


UpdateStationRequest = StationUpdate


class StationResponse(StationBase):
    id: uuid.UUID
    status: str
    default_hourly_rate: Optional[Decimal] = None

    model_config = ConfigDict(from_attributes=True)


class StationLiveResponse(BaseModel):
    id: uuid.UUID
    name: str
    tier: str
    hourly_rate: Decimal
    default_hourly_rate: Optional[Decimal] = None
    pricing_tiers: Optional[List[PricingTier]] = Field(default_factory=list)
    status: str  # AVAILABLE, OCCUPIED, RESERVED, MAINTENANCE
    is_occupied: bool = False
    is_my_session: bool = False
    user_id: Optional[uuid.UUID] = None
    active_session_id: Optional[uuid.UUID] = None
    started_at: Optional[datetime] = None
    elapsed_minutes: int = 0
    remaining_minutes: Optional[int] = None
    time_charge: Decimal = Decimal("0.00")
    orders_charge: Decimal = Decimal("0.00")
    running_total: Decimal = Decimal("0.00")
    active_orders_count: int = 0
    device_name: Optional[str] = None
    allocated_console: Optional[str] = None
    available_consoles: List[str] = Field(default_factory=list)
    customer_phone: Optional[str] = None
    customer_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# Session Schemas
class CheckInRequest(BaseModel):
    station_id: uuid.UUID
    device_id: Optional[str] = None  # 'PS1', 'PS2', 'PS3', 'VR1'
    allocated_minutes: Optional[int] = Field(
        default=settings.DEFAULT_SESSION_DURATION_MINUTES,
        ge=5,
        description="Initial allocated time window",
    )
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    user_id: Optional[uuid.UUID] = None
    tier_price: Optional[Decimal] = None


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
    station: Optional[str] = None  # 'Solo' | 'Multiplayer' | 'Car Simulator' | 'VR'
    console: Optional[str] = None  # 'PS1' | 'PS2' | 'PS3'
    room: Optional[str] = None     # 'PS1' | 'PS2' | 'PS3'
    started_at: datetime
    ended_at: Optional[datetime] = None
    status: str
    total_amount: Decimal
    allocated_minutes: Optional[int] = 60
    tier_price: Optional[Decimal] = None
    category_id: Optional[str] = None
    device_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="before")
    @classmethod
    def populate_station_and_console(cls, data: Any) -> Any:
        if isinstance(data, dict):
            st_name = data.get("station_name")
            dev_name = data.get("device_name") or data.get("console_room")
            if not data.get("station"):
                data["station"] = st_name
            if not data.get("console"):
                data["console"] = dev_name
            if not data.get("room"):
                data["room"] = dev_name
            return data
        st_name = getattr(data, "station_name", None)
        if not st_name and hasattr(data, "station") and getattr(data, "station", None):
            rel = getattr(data, "station", None)
            st_name = getattr(rel, "name", None) if hasattr(rel, "name") else str(rel)
        dev_name = getattr(data, "device_name", None) or getattr(data, "console_room", None)
        return {
            "id": getattr(data, "id", None),
            "station_id": getattr(data, "station_id", None),
            "station_name": st_name,
            "station": st_name,
            "console": dev_name,
            "room": dev_name,
            "started_at": getattr(data, "started_at", None),
            "ended_at": getattr(data, "ended_at", None),
            "status": getattr(data, "status", None),
            "total_amount": getattr(data, "total_amount", Decimal("0.00")),
            "allocated_minutes": getattr(data, "allocated_minutes", 60),
            "tier_price": getattr(data, "tier_price", None),
            "category_id": getattr(data, "category_id", None),
            "device_name": dev_name,
        }


# Device & Experience Category Allocation Schemas
class DeviceAvailability(BaseModel):
    id: str  # 'PS1', 'PS2', 'PS3', 'VR1' or UUID
    name: str
    is_occupied: bool
    current_session_id: Optional[str] = None
    remaining_minutes: Optional[int] = None


class CategoryAvailabilityResponse(BaseModel):
    id: str  # 'solo' | 'multiplayer' | 'car_sim' | 'vr_sim'
    name: str
    tier: str
    supported_device_ids: List[str]
    devices: List[DeviceAvailability] = Field(default_factory=list)
    total_units: int
    available_units: int
    is_available: bool
    hourly_rate: Decimal
    pricing_tiers: List[PricingTier] = Field(default_factory=list)


class SessionStartRequest(BaseModel):
    category_id: str
    device_id: Optional[str] = None  # 'PS1', 'PS2', 'PS3', 'VR1' or Station UUID
    duration_minutes: int = Field(default=60, ge=5)
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    user_id: Optional[str] = None
    tier_price: Optional[Decimal] = None


# Menu & Order Schemas
class MenuItemResponse(BaseModel):
    id: uuid.UUID
    name: str
    category: str
    price: Decimal
    stock: int = 50
    min_stock_alert: int = 10
    is_available: bool

    model_config = ConfigDict(from_attributes=True)


class MenuItemCreate(BaseModel):
    name: str = Field(..., max_length=100)
    category: str = Field(..., max_length=50)
    price: Decimal = Field(..., ge=Decimal("0.00"))
    stock: int = Field(default=50, ge=0)
    min_stock_alert: int = Field(default=10, ge=0)
    is_available: bool = True


class MenuItemUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    category: Optional[str] = Field(None, max_length=50)
    price: Optional[Decimal] = Field(None, ge=Decimal("0.00"))
    stock: Optional[int] = Field(None, ge=0)
    min_stock_alert: Optional[int] = Field(None, ge=0)
    is_available: Optional[bool] = None


class InventoryRestockRequest(BaseModel):
    item_id: uuid.UUID
    amount: int = Field(..., gt=0)


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


class StationOrderCreateRequest(BaseModel):
    station_id: uuid.UUID
    items: List[OrderItemCreate] = Field(..., min_length=1)
    customer_name: Optional[str] = None


class OrderResponse(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    station_id: Optional[uuid.UUID] = None
    station_name: Optional[str] = None
    customer_name: Optional[str] = None
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


# Auth & Customer Directory Schemas
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


class UserRegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    phone: str = Field(..., min_length=10, max_length=15)
    password: str = Field(..., min_length=4, max_length=50)


class UserLoginRequest(BaseModel):
    identifier: str = Field(..., description="Phone number or username")
    password: str = Field(..., min_length=1)


class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    phone: str
    role: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class CustomerProfileResponse(BaseModel):
    id: str
    name: str
    phone: str
    visit_count: int
    last_visit: Optional[str] = None
    total_spent: float
    notes: Optional[str] = None
