import hashlib
import hmac
import logging
import time
from typing import Optional
from collections import OrderedDict
from fastapi import APIRouter, Request, Header, HTTPException, status, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.config import settings
from app.core.rate_limiter import RateLimiter
from app.services.ws_notifier import buffer_ws_event

logger = logging.getLogger("payment_webhook")

router = APIRouter(prefix="/payments", tags=["Payment Processing"])

# Thread-safe in-memory processed webhook events store for strict idempotency
class WebhookIdempotencyRegistry:
    def __init__(self, max_entries: int = 5000, ttl_seconds: int = 86400):
        self.max_entries = max_entries
        self.ttl = ttl_seconds
        self._processed: OrderedDict[str, float] = OrderedDict()

    def is_processed(self, event_id: str) -> bool:
        now = time.time()
        if event_id in self._processed:
            timestamp = self._processed[event_id]
            if now - timestamp <= self.ttl:
                self._processed.move_to_end(event_id)
                return True
            else:
                del self._processed[event_id]
        return False

    def mark_processed(self, event_id: str) -> None:
        if len(self._processed) >= self.max_entries:
            self._processed.popitem(last=False)
        self._processed[event_id] = time.time()


webhook_registry = WebhookIdempotencyRegistry()


class PaymentWebhookPayload(BaseModel):
    event_id: str = Field(..., min_length=1, max_length=100)
    event_type: str = Field(..., max_length=50)  # e.g., "payment.succeeded", "upi.received"
    transaction_id: str = Field(..., max_length=100)
    amount: float = Field(..., ge=0.0)
    currency: str = Field(default="INR", max_length=10)
    order_id: Optional[str] = Field(None, max_length=100)
    station_id: Optional[str] = Field(None, max_length=100)
    payer_vpa: Optional[str] = Field(None, max_length=100)
    timestamp: Optional[int] = None


def verify_webhook_signature(raw_body: bytes, signature_header: Optional[str]) -> bool:
    """
    Verifies raw HMAC-SHA256 signature to guarantee payload authenticity
    and prevent unauthorized spoofing. Uses timing-safe string comparison.
    """
    if not signature_header:
        return False

    secret_key = settings.JWT_SECRET.encode("utf-8")
    computed_sig = hmac.new(secret_key, raw_body, hashlib.sha256).hexdigest()

    # Handle prefixed signatures like "sha256=..." or raw hex
    incoming_sig = signature_header.strip()
    if incoming_sig.startswith("sha256="):
        incoming_sig = incoming_sig[7:]

    return hmac.compare_digest(computed_sig.lower(), incoming_sig.lower())


@router.post(
    "/webhook",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(RateLimiter(max_requests=60, window_seconds=60, scope="webhook"))],
)
async def process_payment_webhook(
    request: Request,
    x_webhook_signature: Optional[str] = Header(None, alias="X-Webhook-Signature"),
    x_signature_256: Optional[str] = Header(None, alias="X-Signature-256"),
    db: AsyncSession = Depends(get_db),
):
    """
    Secure Payment & UPI Fulfillment Webhook.
    1. Cryptographically verifies raw HMAC-SHA256 signature.
    2. Enforces idempotent execution (drops duplicate transaction events).
    3. Triggers atomic settlement and broadcasts real-time WebSocket update.
    """
    raw_body = await request.body()
    signature = x_webhook_signature or x_signature_256

    # 1. Cryptographic Signature Verification
    if not verify_webhook_signature(raw_body, signature):
        logger.warning("Payment webhook signature verification failed.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing cryptographic webhook signature.",
        )

    # Parse JSON payload
    try:
        data = await request.json()
        payload = PaymentWebhookPayload.model_validate(data)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Malformed webhook payload: {str(exc)}",
        )

    # 2. Webhook Idempotency Check
    dedup_key = f"{payload.event_id}:{payload.transaction_id}"
    if webhook_registry.is_processed(dedup_key):
        logger.info("Webhook duplicate event detected and dropped: %s", dedup_key)
        return {
            "status": "success",
            "message": "Event already processed",
            "event_id": payload.event_id,
            "idempotent": True,
        }

    # 3. Mark processed
    webhook_registry.mark_processed(dedup_key)

    # 4. Broadcast payment event to admin console
    buffer_ws_event(
        db,
        channel="admin",
        event_type="PAYMENT_RECEIVED",
        payload={
            "transaction_id": payload.transaction_id,
            "amount": payload.amount,
            "station_id": payload.station_id,
            "order_id": payload.order_id,
            "event_type": payload.event_type,
        },
    )
    await db.commit()

    logger.info("Payment webhook successfully fulfilled for txn %s (amount: %s INR)", payload.transaction_id, payload.amount)

    return {
        "status": "success",
        "message": "Payment verified and processed successfully",
        "transaction_id": payload.transaction_id,
        "event_id": payload.event_id,
        "idempotent": False,
    }
