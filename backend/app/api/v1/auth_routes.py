import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.config import settings
from app.core.security import get_password_hash, verify_password, create_user_token, decode_jwt_token
from app.models.entities import User
from app.schemas.api_schemas import (
    UserRegisterRequest,
    UserLoginRequest,
    UserResponse,
    AuthTokenResponse,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=AuthTokenResponse, status_code=status.HTTP_201_CREATED)
async def register_customer(
    payload: UserRegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Registers a new gamer account with name, phone, and hashed password.
    Enforces unique phone number constraint.
    """
    clean_phone = payload.phone.strip()
    clean_name = payload.name.strip()

    # Check for existing user by phone
    stmt = select(User).where(User.phone == clean_phone)
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A player account with this phone number is already registered. Please log in.",
        )

    pw_hash = get_password_hash(payload.password)
    new_user = User(
        name=clean_name,
        phone=clean_phone,
        password_hash=pw_hash,
        role="CUSTOMER",
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    token = create_user_token(
        user_id=str(new_user.id),
        phone=new_user.phone,
        role="customer",
        name=new_user.name,
    )
    return AuthTokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserResponse.model_validate(new_user),
    )


@router.post("/login", response_model=AuthTokenResponse)
async def login_user(
    payload: UserLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Authenticates either a customer (via phone or username) or administrator.
    Returns a persistent Bearer JWT token.
    """
    identifier = payload.identifier.strip()
    password = payload.password

    # 1. Admin login check
    if identifier == settings.ADMIN_USERNAME and password == settings.ADMIN_PASSWORD:
        # Ensure an admin user record exists in DB
        stmt = select(User).where(User.role == "ADMIN")
        admin_user = (await db.execute(stmt)).scalar_one_or_none()
        if not admin_user:
            admin_user = User(
                name="System Administrator",
                phone="0000000000",
                password_hash=get_password_hash(settings.ADMIN_PASSWORD),
                role="ADMIN",
            )
            db.add(admin_user)
            await db.commit()
            await db.refresh(admin_user)

        token = create_user_token(
            user_id=str(admin_user.id),
            phone=admin_user.phone,
            role="admin",
            name=admin_user.name,
        )
        return AuthTokenResponse(
            access_token=token,
            token_type="bearer",
            user=UserResponse.model_validate(admin_user),
        )

    # 2. Customer user check (by phone or name)
    stmt = select(User).where(or_(User.phone == identifier, User.name == identifier))
    user = (await db.execute(stmt)).scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account not found. Please register first or verify your phone number.",
        )

    if not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password. Please try again.",
        )

    role_scope = "admin" if user.role == "ADMIN" else "customer"
    token = create_user_token(
        user_id=str(user.id),
        phone=user.phone,
        role=role_scope,
        name=user.name,
    )
    return AuthTokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Fetches the authenticated user profile using the Bearer token.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid token")

    token = authorization.split(" ")[1]
    try:
        payload = decode_jwt_token(token)
        user_id = payload.get("sub")
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = await db.get(User, uuid.UUID(user_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    return UserResponse.model_validate(user)
