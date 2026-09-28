from typing import List, Optional, Union
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Centralized, strictly typed application configuration loaded from environment
    variables with defensive defaults.
    """
    PROJECT_NAME: str = "Gaming Cafe Operations & Financial Management System"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"

    # Runtime Environment & Network Bindings
    NODE_ENV: str = "development"
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # Database Configuration & Pool Lifecycles
    DATABASE_URL: str = "sqlite+aiosqlite:///./gaming_cafe_dev.db"
    ECHO_SQL: bool = False
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_TIMEOUT_SECONDS: int = 15
    DB_POOL_RECYCLE_SECONDS: int = 1800
    SQLITE_BUSY_TIMEOUT_MS: int = 10000
    SQLITE_CONNECT_TIMEOUT_SECONDS: int = 15

    # Security & Cryptographic Tokens
    JWT_SECRET: str = "enterprise_gaming_cafe_super_secret_jwt_key_2026"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12  # 12 hours
    CUSTOMER_TOKEN_EXPIRE_MINUTES: int = 60 * 6  # 6 hours

    # Admin Credentials (Configurable via environment variables)
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin123"
    ADMIN_PHONE: str = "0000000000"

    # UPI Billing & NPCI Standard Payloads
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

    # CORS Settings (can be "*" or comma-separated domains)
    CORS_ORIGINS: Union[str, List[str]] = "*"
    ALLOWED_ORIGINS: Optional[Union[str, List[str]]] = None

    @property
    def is_production(self) -> bool:
        return self.NODE_ENV.lower() == "production"

    @property
    def cors_origin_list(self) -> List[str]:
        target = self.ALLOWED_ORIGINS if self.ALLOWED_ORIGINS is not None else self.CORS_ORIGINS
        if isinstance(target, list):
            return target
        if isinstance(target, str):
            if target.strip() == "*":
                return ["*"]
            return [origin.strip() for origin in target.split(",") if origin.strip()]
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

    def validate_production_config(self) -> None:
        """
        Fail-fast validation for production readiness and runtime safety.
        Ensures secure database, cryptographic tokens, network boundaries, and valid environment values.
        """
        errors = []
        valid_envs = ("production", "development", "test")
        if self.NODE_ENV.lower() not in valid_envs:
            errors.append(f"NODE_ENV '{self.NODE_ENV}' is invalid. Permitted values: {', '.join(valid_envs)}")

        if not (1 <= self.PORT <= 65535):
            errors.append(f"PORT '{self.PORT}' is invalid. Must be an integer between 1 and 65535.")

        if not self.is_production:
            if errors:
                diagnostic = (
                    "\n" + "=" * 76 + "\n"
                    "🚨 [FAIL-FAST ERROR] Application boot rejected due to configuration violations:\n"
                    + "\n".join(f"   [{idx + 1}] {err}" for idx, err in enumerate(errors))
                    + "\n" + "=" * 76 + "\n"
                )
                raise RuntimeError(diagnostic)
            return

        if "sqlite" in self.DATABASE_URL.lower():
            errors.append("DATABASE_URL: SQLite is not permitted in production. Configure a production PostgreSQL connection string.")
        
        origins = self.cors_origin_list
        if not origins or "*" in origins:
            errors.append("ALLOWED_ORIGINS / CORS_ORIGINS: Wildcard '*' is strictly forbidden in production. Explicit domain whitelist is required.")

        if self.JWT_SECRET == "enterprise_gaming_cafe_super_secret_jwt_key_2026" or len(self.JWT_SECRET) < 32:
            errors.append("JWT_SECRET: Default or weak secret detected. Production requires at least 32 random characters.")

        if self.ADMIN_PASSWORD == "admin123" or len(self.ADMIN_PASSWORD) < 8:
            errors.append("ADMIN_PASSWORD: Insecure default credentials detected. Set a complex administrative password.")

        if errors:
            diagnostic = (
                "\n" + "=" * 76 + "\n"
                "🚨 [FAIL-FAST ERROR] Application boot rejected due to production security violations:\n"
                + "\n".join(f"   [{idx + 1}] {err}" for idx, err in enumerate(errors))
                + "\n" + "=" * 76 + "\n"
            )
            raise RuntimeError(diagnostic)

    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")


settings = Settings()

