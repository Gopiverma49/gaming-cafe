from collections import OrderedDict
import hashlib
import time
from typing import AsyncGenerator, Dict, Any, Optional
import uuid

from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import async_session_factory
from app.core.security import decode_jwt_token

security_bearer = HTTPBearer(auto_error=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Async session lifecycle dependency."""
    async with async_session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def verify_admin_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
) -> Dict[str, Any]:
    """
    Authenticates Bearer JWT and enforces admin scope.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    try:
        payload = decode_jwt_token(token)
        scope = payload.get("scope")
        if scope != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions: Admin scope required",
            )
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def verify_customer_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
) -> Dict[str, Any]:
    """
    Zero-trust security using ephemeral, desk-scoped JWTs.
    Extracts desk_id from the verified token, dropping client-supplied station parameters
    to ensure strict desk isolation.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing desk session token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    try:
        payload = decode_jwt_token(token)
        scope = payload.get("scope")
        desk_id = payload.get("desk_id")
        session_id = payload.get("session_id")
        if scope != "customer" or not desk_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid desk credentials: customer scope and desk_id required",
            )
        return {
            "desk_id": uuid.UUID(desk_id),
            "session_id": uuid.UUID(session_id) if session_id else None,
            "sub": payload.get("sub"),
        }
    except (JWTError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired desk token",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_optional_auth_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
    db: AsyncSession = Depends(get_db),
) -> Optional["User"]:
    """
    Extracts authenticated user from Bearer JWT if provided, returns None otherwise.
    Guarantees admin user resolution for any valid admin token.
    """
    if not credentials or not credentials.credentials:
        return None
    try:
        payload = decode_jwt_token(credentials.credentials)
        user_id_str = payload.get("sub")
        role = payload.get("role") or payload.get("scope") or ""
        from app.models.entities import User
        from sqlalchemy import select

        user = None
        if user_id_str:
            try:
                user = await db.get(User, uuid.UUID(user_id_str))
            except (ValueError, TypeError):
                pass

        if not user and str(role).lower() == "admin":
            stmt = select(User).where(User.role == "ADMIN")
            user = (await db.execute(stmt)).scalar_one_or_none()
            if not user:
                from app.core.security import get_password_hash
                user = User(
                    name="System Administrator",
                    phone="0000000000",
                    password_hash=get_password_hash(settings.ADMIN_PASSWORD),
                    role="ADMIN",
                )
                db.add(user)
                await db.commit()
                await db.refresh(user)

        return user
    except Exception:
        return None


async def get_required_auth_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
    db: AsyncSession = Depends(get_db),
) -> "User":
    """
    Requires valid Bearer JWT and returns authenticated User record.
    """
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = await get_optional_auth_user(credentials=credentials, db=db)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


# In-memory Idempotency Store with LRU eviction and TTL
# In high-volume distributed production, this can be backed by Redis.
class IdempotencyCache:
    def __init__(
        self,
        ttl: int = settings.IDEMPOTENCY_CACHE_TTL_SECONDS,
        max_entries: int = settings.IDEMPOTENCY_MAX_ENTRIES,
    ):
        self.ttl = ttl
        self.max_entries = max_entries
        self._store: OrderedDict[str, Dict[str, Any]] = OrderedDict()

    def get(self, key: str) -> Optional[Dict[str, Any]]:
        record = self._store.get(key)
        if not record:
            return None
        if time.time() - record["timestamp"] > self.ttl:
            del self._store[key]
            return None
        self._store.move_to_end(key)
        return record

    def set(
        self,
        key: str,
        payload_hash: str,
        status_code: int,
        response_body: bytes,
        headers: Dict[str, str],
    ):
        if key in self._store:
            self._store.move_to_end(key)
        elif len(self._store) >= self.max_entries:
            # Evict oldest entry (LRU)
            self._store.popitem(last=False)

        self._store[key] = {
            "payload_hash": payload_hash,
            "status_code": status_code,
            "body": response_body,
            "headers": headers,
            "timestamp": time.time(),
        }


idempotency_store = IdempotencyCache()


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """
    IdempotencyMiddleware: Intercepts mutating requests (POST, PATCH).
    Verifies payload hash matches the Idempotency-Key header, and drops duplicate operations
    returning the recorded response.
    """
    async def dispatch(self, request: Request, call_next):
        if request.method not in ("POST", "PATCH"):
            return await call_next(request)

        idempotency_key = request.headers.get("Idempotency-Key")
        if not idempotency_key:
            # Continue normally if header is not provided
            return await call_next(request)

        # Read request body
        body = await request.body()
        payload_hash = hashlib.sha256(body).hexdigest()

        cached_entry = idempotency_store.get(idempotency_key)
        if cached_entry:
            if cached_entry["payload_hash"] != payload_hash:
                return Response(
                    content='{"detail": "Idempotency-Key reuse with conflicting request payload"}',
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    media_type="application/json",
                )
            # Return cached response
            return Response(
                content=cached_entry["body"],
                status_code=cached_entry["status_code"],
                headers=dict(cached_entry["headers"]),
                media_type="application/json",
            )

        # Execute downstream route
        response = await call_next(request)

        # Cache only successful / client mutating responses (200-299)
        if 200 <= response.status_code < 300:
            resp_body = [section async for section in response.body_iterator]
            response_bytes = b"".join(resp_body)

            headers_dict = {
                k: v for k, v in response.headers.items() if k.lower() in ("content-type", "content-length")
            }
            idempotency_store.set(
                key=idempotency_key,
                payload_hash=payload_hash,
                status_code=response.status_code,
                response_body=response_bytes,
                headers=headers_dict,
            )
            return Response(
                content=response_bytes,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
            )

        return response
