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


@pytest.mark.asyncio
async def test_health_check_database_connectivity(test_db):
    from httpx import AsyncClient, ASGITransport
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Test /health
        res = await client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] in ("ok", "healthy")
        assert data["dbStatus"] == "connected"
        assert data["database"] == "healthy"
        assert "uptime" in data
        assert "timestamp" in data

        # Test /api/health alias
        res_api = await client.get("/api/health")
        assert res_api.status_code == 200
        data_api = res_api.json()
        assert data_api["status"] == data["status"]
        assert data_api["dbStatus"] == "connected"


def test_production_fail_fast_validation():
    # 1. Rejects SQLite in production
    s_sqlite = Settings(
        NODE_ENV="production",
        DATABASE_URL="sqlite+aiosqlite:///./test.db",
        ALLOWED_ORIGINS="https://cafe.example.com",
        JWT_SECRET="a_very_secure_long_secret_key_exceeding_32_characters_2026",
        ADMIN_PASSWORD="strong_admin_pass_2026",
    )
    with pytest.raises(RuntimeError) as exc_info:
        s_sqlite.validate_production_config()
    assert "SQLite is not permitted in production" in str(exc_info.value)

    # 2. Rejects wildcard CORS in production
    s_cors = Settings(
        NODE_ENV="production",
        DATABASE_URL="postgresql+asyncpg://user:pass@host:5432/db",
        ALLOWED_ORIGINS="*",
        JWT_SECRET="a_very_secure_long_secret_key_exceeding_32_characters_2026",
        ADMIN_PASSWORD="strong_admin_pass_2026",
    )
    with pytest.raises(RuntimeError) as exc_info:
        s_cors.validate_production_config()
    assert "Wildcard '*' is strictly forbidden in production" in str(exc_info.value)

    # 3. Rejects weak or default JWT secret in production
    s_jwt = Settings(
        NODE_ENV="production",
        DATABASE_URL="postgresql+asyncpg://user:pass@host:5432/db",
        ALLOWED_ORIGINS="https://cafe.example.com",
        JWT_SECRET="enterprise_gaming_cafe_super_secret_jwt_key_2026",
        ADMIN_PASSWORD="strong_admin_pass_2026",
    )
    with pytest.raises(RuntimeError) as exc_info:
        s_jwt.validate_production_config()
    assert "JWT_SECRET: Default or weak secret detected" in str(exc_info.value)

    # 4. Passes with valid production configuration
    s_valid = Settings(
        NODE_ENV="production",
        DATABASE_URL="postgresql+asyncpg://user:pass@host:5432/db",
        ALLOWED_ORIGINS="https://cafe.example.com, https://admin.cafe.example.com",
        JWT_SECRET="a_very_secure_long_secret_key_exceeding_32_characters_2026",
        ADMIN_PASSWORD="strong_admin_pass_2026",
    )
    s_valid.validate_production_config()
    assert s_valid.is_production is True
    assert s_valid.cors_origin_list == ["https://cafe.example.com", "https://admin.cafe.example.com"]


@pytest.mark.asyncio
async def test_payment_webhook_hmac_and_idempotency(test_db):
    import hmac
    import hashlib
    import json
    from httpx import AsyncClient, ASGITransport
    from app.main import app
    from app.core.config import settings

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "event_id": "evt_test_12345",
            "event_type": "payment.succeeded",
            "transaction_id": "txn_upi_987654321",
            "amount": 250.00,
            "currency": "INR",
            "station_id": "PS1",
        }
        raw_body = json.dumps(payload).encode("utf-8")

        # 1. Reject without signature
        res_no_sig = await client.post("/api/v1/payments/webhook", content=raw_body)
        assert res_no_sig.status_code == 401

        # 2. Reject with forged/invalid signature
        res_bad_sig = await client.post(
            "/api/v1/payments/webhook",
            content=raw_body,
            headers={"X-Signature-256": "bad_forged_signature_hex"},
        )
        assert res_bad_sig.status_code == 401

        # 3. Compute authentic HMAC-SHA256 signature
        secret = settings.JWT_SECRET.encode("utf-8")
        valid_sig = hmac.new(secret, raw_body, hashlib.sha256).hexdigest()

        res_ok = await client.post(
            "/api/v1/payments/webhook",
            content=raw_body,
            headers={"X-Signature-256": f"sha256={valid_sig}", "Content-Type": "application/json"},
        )
        assert res_ok.status_code == 200
        data_ok = res_ok.json()
        assert data_ok["status"] == "success"
        assert data_ok["idempotent"] is False

        # 4. Duplicate event triggers idempotency (returns 200 without reprocessing)
        res_dup = await client.post(
            "/api/v1/payments/webhook",
            content=raw_body,
            headers={"X-Signature-256": valid_sig, "Content-Type": "application/json"},
        )
        assert res_dup.status_code == 200
        data_dup = res_dup.json()
        assert data_dup["status"] == "success"
        assert data_dup["idempotent"] is True


def test_upload_security_inspection():
    from app.core.upload_security import validate_upload_buffer, inspect_magic_bytes
    import pytest
    from fastapi import HTTPException

    # 1. Valid PNG
    png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    assert inspect_magic_bytes(png_bytes) == "image/png"
    ok, fname = validate_upload_buffer(png_bytes, "avatar.png")
    assert ok is True
    assert fname == "avatar.png"

    # 2. Path traversal sanitized
    _, safe_name = validate_upload_buffer(png_bytes, "safe-name.png")
    assert ".." not in safe_name

    # 3. Rejects executable / fake extension
    fake_exe = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00"
    with pytest.raises(HTTPException) as exc:
        validate_upload_buffer(fake_exe, "virus.png")
    assert exc.value.status_code == 415


@pytest.mark.asyncio
async def test_honeypot_bot_prevention(test_db):
    from httpx import AsyncClient, ASGITransport
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Bot fills hidden website honeypot field
        spam_res = await client.post(
            "/api/v1/auth/register",
            json={
                "name": "Bot Spammer",
                "phone": "9876543299",
                "password": "botpassword123",
                "website": "https://spam-viagra-links.com",
            },
        )
        assert spam_res.status_code == 400
        assert "Spam" in spam_res.json()["detail"]



