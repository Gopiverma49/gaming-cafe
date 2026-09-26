from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional, Tuple

from app.models.entities import Order, OrderItem
from app.schemas.api_schemas import OrderResponse, OrderItemResponse

CURRENCY_QUANTIZATION = Decimal("0.01")


def ensure_utc(dt: datetime) -> datetime:
    """Normalizes naive datetime to UTC to prevent offset comparison errors."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def calculate_order_subtotals(items: List[OrderItem]) -> Tuple[Decimal, List[OrderItemResponse]]:
    """
    Computes exact line item subtotals and accumulated total using ROUND_HALF_UP.
    Returns (total_amount, list_of_order_item_responses).
    """
    total = Decimal("0.00")
    items_out: List[OrderItemResponse] = []

    for item in items:
        subtotal = (item.unit_price * Decimal(str(item.quantity))).quantize(
            CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP
        )
        total += subtotal
        menu_name = item.menu_item.name if getattr(item, "menu_item", None) else "Item"
        items_out.append(
            OrderItemResponse(
                id=item.id,
                menu_item_id=item.menu_item_id,
                menu_item_name=menu_name,
                quantity=item.quantity,
                unit_price=item.unit_price,
                subtotal=subtotal,
            )
        )

    return total.quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP), items_out


def sum_order_charges(
    orders: List["Order"],
    statuses: Optional[List[str]] = None,
) -> Decimal:
    """
    DRY helper: sums ``unit_price × quantity`` across order items.

    Args:
        orders:   List of Order ORM objects (items must be loaded).
        statuses: Optional whitelist of order statuses to include.
                  If None, all non-CANCELLED orders are included.
                  Pass ``['SERVED']`` to match checkout billing logic.
    Returns:
        Total charge as a 2-decimal Decimal.
    """
    total = Decimal("0.00")
    for order in orders:
        if statuses is not None:
            if order.status not in statuses:
                continue
        else:
            # Default: exclude only CANCELLED
            if order.status == "CANCELLED":
                continue
        for item in order.items:
            total += (item.unit_price * Decimal(str(item.quantity))).quantize(
                CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP
            )
    return total.quantize(CURRENCY_QUANTIZATION, rounding=ROUND_HALF_UP)


def serialize_order(order: Order) -> OrderResponse:
    """
    Consolidates Order ORM model serialization to OrderResponse schema.
    DRY helper eliminating duplicated mapping across admin and customer endpoints.
    """
    total, items_out = calculate_order_subtotals(order.items)
    station_name = "Desk"
    station_id = None
    customer_name = order.customer_name
    if getattr(order, "session", None):
        if not customer_name and getattr(order.session, "customer_name", None):
            customer_name = order.session.customer_name
        if getattr(order.session, "station", None):
            station_name = order.session.station.name
            station_id = order.session.station.id

    return OrderResponse(
        id=order.id,
        session_id=order.session_id,
        station_id=station_id,
        station_name=station_name,
        customer_name=customer_name,
        status=order.status,
        created_at=order.created_at,
        items=items_out,
        total_amount=total,
    )
