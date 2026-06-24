import json

from fastapi.testclient import TestClient

from app.core.auth import _b64, _sign
from app.core.config import get_settings
from app.main import app, settings


def test_auth_middleware_and_login_flow() -> None:
    original = {
        "auth_enabled": settings.auth_enabled,
        "admin_username": settings.admin_username,
        "admin_password": settings.admin_password,
        "auth_token_ttl_minutes": settings.auth_token_ttl_minutes,
    }
    config = get_settings()
    try:
        settings.auth_enabled = True
        settings.admin_username = "admin"
        settings.admin_password = "admin"
        settings.auth_token_ttl_minutes = 720
        config.auth_enabled = True
        config.admin_username = "admin"
        config.admin_password = "admin"
        config.auth_token_ttl_minutes = 720

        with TestClient(app) as client:
            assert client.get("/health").status_code == 200
            assert client.get("/api/dashboard").status_code == 401

            bad_login = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
            assert bad_login.status_code == 401

            login = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
            assert login.status_code == 200
            payload = login.json()
            assert payload["token_type"] == "bearer"
            assert payload["default_password"] is True

            token = payload["access_token"]
            me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
            assert me.status_code == 200
            assert me.json()["username"] == "admin"
            assert me.json()["default_password"] is True

            expired_payload = _b64(json.dumps({"sub": "admin", "exp": 1}, separators=(",", ":"), sort_keys=True).encode("utf-8"))
            expired_token = f"{expired_payload}.{_sign(expired_payload)}"
            expired = client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired_token}"})
            assert expired.status_code == 401

            assert client.get("/api/dashboard", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    finally:
        for key, value in original.items():
            setattr(settings, key, value)
            setattr(config, key, value)
