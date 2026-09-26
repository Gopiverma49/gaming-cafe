from enum import Enum


class StationStatus(str, Enum):
    AVAILABLE = "AVAILABLE"
    OCCUPIED = "OCCUPIED"
    RESERVED = "RESERVED"
    MAINTENANCE = "MAINTENANCE"


class SessionStatus(str, Enum):
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    TRANSFERRED = "TRANSFERRED"
    CANCELLED = "CANCELLED"


class OrderStatus(str, Enum):
    QUEUED = "QUEUED"
    PREPARING = "PREPARING"
    SERVED = "SERVED"
    CANCELLED = "CANCELLED"


class PaymentMethod(str, Enum):
    CASH = "CASH"
    UPI = "UPI"


class PaymentStatus(str, Enum):
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    REFUNDED = "REFUNDED"
