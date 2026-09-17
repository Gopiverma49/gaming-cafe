from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from jose import jwt, JWTError
from app.core.config import settings


def create_jwt_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "iat": now})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt


def create_admin_token(username: str = "admin") -> str:
    return create_jwt_token(
        data={"sub": username, "scope": "admin"},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )


def create_customer_token(desk_id: str, session_id: str) -> str:
    """Zero-trust ephemeral customer token strictly bound to desk_id and session_id."""
    return create_jwt_token(
        data={
            "sub": f"customer:{desk_id}",
            "scope": "customer",
            "desk_id": str(desk_id),
            "session_id": str(session_id),
        },
        expires_delta=timedelta(minutes=settings.CUSTOMER_TOKEN_EXPIRE_MINUTES),
    )


def decode_jwt_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
