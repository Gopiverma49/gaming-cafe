import pytest
from app.core.config import Settings


def test_cors_origin_list_parsing():
    s1 = Settings(CORS_ORIGINS="*")
    assert s1.cors_origin_list == ["*"]

    s2 = Settings(CORS_ORIGINS="http://localhost:5173, https://gamingcafe.com")
    assert s2.cors_origin_list == ["http://localhost:5173", "https://gamingcafe.com"]

    s3 = Settings(CORS_ORIGINS=["https://admin.cafe.io"])
    assert s3.cors_origin_list == ["https://admin.cafe.io"]


def test_database_url_async_normalization():
    s1 = Settings(DATABASE_URL="postgres://user:pass@host:5432/db")
    assert s1.async_database_url == "postgresql+asyncpg://user:pass@host:5432/db"

    s2 = Settings(DATABASE_URL="postgresql://user:pass@host:5432/db")
    assert s2.async_database_url == "postgresql+asyncpg://user:pass@host:5432/db"

    s3 = Settings(DATABASE_URL="postgresql+asyncpg://user:pass@host:5432/db")
    assert s3.async_database_url == "postgresql+asyncpg://user:pass@host:5432/db"

    s4 = Settings(DATABASE_URL="sqlite+aiosqlite:///test.db")
    assert s4.async_database_url == "sqlite+aiosqlite:///test.db"


def test_admin_configurable_credentials():
    s = Settings(ADMIN_USERNAME="superowner", ADMIN_PASSWORD="securepassword99")
    assert s.ADMIN_USERNAME == "superowner"
    assert s.ADMIN_PASSWORD == "securepassword99"


@pytest.mark.asyncio
async def test_cors_preflight_idempotency_key_allowed():
    from httpx import AsyncClient, ASGITransport
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.options(
            "/api/v1/admin/sessions/checkout",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization, content-type, idempotency-key",
            },
        )
        assert res.status_code == 204
        allowed_headers = res.headers.get("access-control-allow-headers", "").lower()
        assert "idempotency-key" in allowed_headers

