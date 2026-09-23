from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Union


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

    # Admin Credentials (Configurable for production hosting)
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin123"

    # UPI Billing Info
    UPI_MERCHANT_VPA: str = "gamingcafe@upi"
    UPI_MERCHANT_NAME: str = "VanyaGamingCafe"
    UPI_CURRENCY: str = "INR"

    # Business Billing & Session Configuration
    DEFAULT_SESSION_DURATION_MINUTES: int = 60
    DEFAULT_HOURLY_RATE: float = 180.0
    MINIMUM_BILLING_MINUTES: int = 30
    GRACE_PERIOD_MINUTES: int = 5
    MINIMUM_BILLABLE_HOURS: float = 0.5
    IDEMPOTENCY_CACHE_TTL_SECONDS: int = 3600
    IDEMPOTENCY_MAX_ENTRIES: int = 2000

    # CORS Settings (can be "*" or comma-separated domains: "http://localhost:5173,https://mycafe.com")
    CORS_ORIGINS: Union[str, List[str]] = "*"

    @property
    def cors_origin_list(self) -> List[str]:
        if isinstance(self.CORS_ORIGINS, list):
            return self.CORS_ORIGINS
        if isinstance(self.CORS_ORIGINS, str):
            if self.CORS_ORIGINS.strip() == "*":
                return ["*"]
            return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]
        return ["*"]

    @property
    def async_database_url(self) -> str:
        """Ensures PostgreSQL URLs use asyncpg driver dialect."""
        url = self.DATABASE_URL
        if url.startswith("postgres://"):
            return url.replace("postgres://", "postgresql+asyncpg://", 1)
        if url.startswith("postgresql://") and not url.startswith("postgresql+asyncpg://"):
            return url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
