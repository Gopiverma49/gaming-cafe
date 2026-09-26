import bcrypt
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from jose import jwt
from app.core.config import settings

BCRYPT_MAX_BYTES = 72


def get_password_hash(password: str) -> str:
    """Hash a password using bcrypt (truncating to 72 bytes max as per bcrypt spec)."""
    pw_bytes = password.encode("utf-8")[:BCRYPT_MAX_BYTES]
    return bcrypt.hashpw(pw_bytes, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against its bcrypt hash."""
    try:
        pw_bytes = plain_password.encode("utf-8")[:BCRYPT_MAX_BYTES]
        hash_bytes = hashed_password.encode("utf-8")
        return bcrypt.checkpw(pw_bytes, hash_bytes)
    except (ValueError, TypeError):
        return False


def create_jwt_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "iat": now})
    return str(jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM))


def create_admin_token(username: str = "admin") -> str:
    return create_jwt_token(
        data={"sub": username, "scope": "admin", "role": "admin"},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )


def create_user_token(user_id: str, phone: str, role: str = "customer", name: str = "") -> str:
    """Create a persistent user-scoped JWT token for registered customer or admin."""
    return create_jwt_token(
        data={
            "sub": str(user_id),
            "phone": phone,
            "role": role,
            "name": name,
            "scope": role,
        },
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )


def create_customer_token(desk_id: str, session_id: str) -> str:
    """Zero-trust ephemeral customer token strictly bound to desk_id and session_id."""
    return create_jwt_token(
        data={
            "sub": f"customer:{desk_id}",
            "scope": "customer",
            "role": "customer",
            "desk_id": str(desk_id),
            "session_id": str(session_id),
        },
        expires_delta=timedelta(minutes=settings.CUSTOMER_TOKEN_EXPIRE_MINUTES),
    )


def decode_jwt_token(token: str) -> Dict[str, Any]:
    """Decodes and validates JWT claims against configured secret and algorithm."""
    claims: Dict[str, Any] = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    return claims
