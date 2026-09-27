import time
import logging
from collections import defaultdict
from typing import Dict, List, Optional
from fastapi import Request, HTTPException, status

logger = logging.getLogger("rate_limiter")


class SlidingWindowRateLimiter:
    """
    In-memory Sliding Window Rate Limiter with automatic window cleanup.
    Tracks timestamps of requests per client key (IP or identifier).
    """

    def __init__(self, max_requests: int = 60, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._history: Dict[str, List[float]] = defaultdict(list)
        self._last_cleanup = time.time()

    def _cleanup_stale(self, now: float) -> None:
        """Periodically purge empty keys to prevent unbounded memory growth."""
        if now - self._last_cleanup < 300:  # Every 5 minutes
            return
        self._last_cleanup = now
        stale_cutoff = now - self.window_seconds
        keys_to_delete = []
        for key, timestamps in self._history.items():
            self._history[key] = [t for t in timestamps if t > stale_cutoff]
            if not self._history[key]:
                keys_to_delete.append(key)
        for key in keys_to_delete:
            del self._history[key]

    def is_allowed(self, key: str) -> tuple[bool, int, int]:
        """
        Evaluates whether a request from 'key' is allowed.
        Returns: (allowed: bool, remaining: int, retry_after: int)
        """
        now = time.time()
        self._cleanup_stale(now)
        cutoff = now - self.window_seconds

        # Filter out timestamps outside the active window
        valid_timestamps = [t for t in self._history[key] if t > cutoff]
        self._history[key] = valid_timestamps

        count = len(valid_timestamps)
        if count >= self.max_requests:
            oldest = valid_timestamps[0]
            retry_after = max(1, int(self.window_seconds - (now - oldest)))
            return False, 0, retry_after

        # Record this request
        self._history[key].append(now)
        remaining = self.max_requests - (count + 1)
        return True, remaining, 0


def get_client_ip(request: Request) -> str:
    """Safely extracts real client IP addressing reverse proxy headers."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        # Take first (client) IP from comma-separated list
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "127.0.0.1"


class RateLimiter:
    """
    FastAPI Dependency to enforce rate limits per endpoint.
    Example: Depends(RateLimiter(max_requests=10, window_seconds=60))
    """

    def __init__(self, max_requests: int = 60, window_seconds: int = 60, scope: Optional[str] = None):
        self.limiter = SlidingWindowRateLimiter(max_requests=max_requests, window_seconds=window_seconds)
        self.scope = scope or "default"

    async def __call__(self, request: Request) -> None:
        ip = get_client_ip(request)
        key = f"{self.scope}:{ip}"
        allowed, remaining, retry_after = self.limiter.is_allowed(key)

        if not allowed:
            logger.warning("Rate limit exceeded for %s on %s (scope: %s)", ip, request.url.path, self.scope)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please slow down and try again later.",
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(self.limiter.max_requests),
                    "X-RateLimit-Remaining": "0",
                },
            )
