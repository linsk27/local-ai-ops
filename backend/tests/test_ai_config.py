from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.database import SessionLocal
from app.models import AppSetting


def test_ai_config_api_encrypts_key_and_returns_masked_value() -> None:
    with TestClient(app) as client:
        response = client.put(
            "/api/settings/ai",
            json={
                "base_url": "https://api.openai.com/v1",
                "api_key": "sk-test-secret-value",
                "model": "gpt-4.1-mini",
            },
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["base_url"] == "https://api.openai.com/v1"
        assert payload["configured"] is True
        assert payload["api_key_masked"] != "sk-test-secret-value"
        assert "secret" not in payload["api_key_masked"]

        with SessionLocal() as db:
            setting = db.scalar(select(AppSetting).where(AppSetting.key == "ai.api_key"))
            assert setting is not None
            assert "sk-test-secret-value" not in str(setting.value_json)


def test_ai_config_rejects_invalid_base_url() -> None:
    with TestClient(app) as client:
        response = client.put(
            "/api/settings/ai",
            json={
                "base_url": "not-a-url",
                "api_key": "sk-test-secret-value",
                "model": "gpt-4.1-mini",
            },
        )
        assert response.status_code == 400


def test_ai_config_test_reports_incomplete_config_without_secret() -> None:
    with TestClient(app) as client:
        client.put(
            "/api/settings/ai",
            json={
                "base_url": "",
                "model": "gpt-4.1-mini",
                "clear_api_key": True,
            },
        )
        response = client.post("/api/settings/ai/test")

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "error"
        assert "secret" not in payload["message"].lower()
