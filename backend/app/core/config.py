from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    PROJECT_NAME: str = "Gaming Cafe Operations & Financial Management System"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://cafe_admin:cyber_secret_2026@localhost:5432/gaming_cafe_db"
    ECHO_SQL: bool = False

    # Security
    JWT_SECRET: str = "enterprise_gaming_cafe_super_secret_jwt_key_2026"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12  # 12 hours
    CUSTOMER_TOKEN_EXPIRE_MINUTES: int = 60 * 6  # 6 hours

    # UPI Billing Info
    UPI_MERCHANT_VPA: str = "gamingcafe@upi"
    UPI_MERCHANT_NAME: str = "ApexCyberLounge"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
