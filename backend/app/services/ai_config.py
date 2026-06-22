from dataclasses import dataclass
from time import perf_counter

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import decrypt_secret, encrypt_secret, mask_value, redact_text
from app.models import AppSetting


BASE_URL_KEY = "ai.base_url"
MODEL_KEY = "ai.model"
API_KEY_KEY = "ai.api_key"


@dataclass
class AiRuntimeConfig:
    base_url: str
    api_key: str
    model: str
    source: str

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key and self.model)


def get_ai_runtime_config(db: Session) -> AiRuntimeConfig:
    settings = get_settings()
    base_url = _get_plain(db, BASE_URL_KEY) or settings.ai_base_url
    model = _get_plain(db, MODEL_KEY) or settings.ai_model
    api_key = _get_secret(db, API_KEY_KEY) or settings.ai_api_key
    source = "database" if _has_any_database_value(db) else "environment"
    return AiRuntimeConfig(base_url=base_url, api_key=api_key, model=model, source=source)


def read_ai_config(db: Session) -> dict[str, str | bool]:
    config = get_ai_runtime_config(db)
    return {
        "base_url": config.base_url,
        "model": config.model,
        "api_key_masked": mask_value(config.api_key) if config.api_key else "",
        "configured": config.configured,
        "source": config.source,
    }


def save_ai_config(db: Session, base_url: str, model: str, api_key: str | None = None, clear_api_key: bool = False) -> dict[str, str | bool]:
    _set_plain(db, BASE_URL_KEY, base_url.strip())
    _set_plain(db, MODEL_KEY, model.strip())
    if clear_api_key:
        _delete_setting(db, API_KEY_KEY)
    elif api_key:
        _set_secret(db, API_KEY_KEY, api_key.strip())
    db.commit()
    return read_ai_config(db)


def test_ai_config(db: Session) -> dict[str, str | float | None]:
    config = get_ai_runtime_config(db)
    safe_base_url = config.base_url.rstrip("/")
    if not config.configured:
        return {
            "status": "error",
            "message": "AI config is incomplete.",
            "base_url": safe_base_url,
            "model": config.model,
            "latency_ms": None,
        }

    headers = {"Authorization": f"Bearer {config.api_key}"}
    started_at = perf_counter()
    try:
        models_response = httpx.get(f"{safe_base_url}/models", headers=headers, timeout=12.0)
        models_response.raise_for_status()
        completion_response = httpx.post(
            f"{safe_base_url}/chat/completions",
            headers=headers,
            json={
                "model": config.model,
                "messages": [{"role": "user", "content": "Reply with exactly: pong"}],
                "temperature": 0,
                "max_tokens": 8,
            },
            timeout=20.0,
        )
        completion_response.raise_for_status()
        content = str(completion_response.json()["choices"][0]["message"]["content"]).strip()
        latency_ms = round((perf_counter() - started_at) * 1000, 2)
        if "pong" not in content.lower():
            return {
                "status": "degraded",
                "message": "Endpoint responded, but the completion reply was unexpected.",
                "base_url": safe_base_url,
                "model": config.model,
                "latency_ms": latency_ms,
            }
        return {
            "status": "healthy",
            "message": "AI endpoint test passed.",
            "base_url": safe_base_url,
            "model": config.model,
            "latency_ms": latency_ms,
        }
    except httpx.HTTPStatusError as exc:
        latency_ms = round((perf_counter() - started_at) * 1000, 2)
        return {
            "status": "error",
            "message": redact_text(f"AI endpoint returned HTTP {exc.response.status_code}: {exc.response.text[:240]}"),
            "base_url": safe_base_url,
            "model": config.model,
            "latency_ms": latency_ms,
        }
    except Exception as exc:
        latency_ms = round((perf_counter() - started_at) * 1000, 2)
        return {
            "status": "error",
            "message": redact_text(f"AI endpoint test failed: {exc}"),
            "base_url": safe_base_url,
            "model": config.model,
            "latency_ms": latency_ms,
        }


def _has_any_database_value(db: Session) -> bool:
    return db.scalar(select(AppSetting.id).where(AppSetting.key.in_([BASE_URL_KEY, MODEL_KEY, API_KEY_KEY])).limit(1)) is not None


def _get_plain(db: Session, key: str) -> str:
    setting = _get_setting(db, key)
    if not setting:
        return ""
    value = setting.value_json or {}
    return str(value.get("value") or "")


def _set_plain(db: Session, key: str, value: str) -> None:
    setting = _get_or_create_setting(db, key)
    setting.value_json = {"value": value}
    db.add(setting)


def _get_secret(db: Session, key: str) -> str:
    setting = _get_setting(db, key)
    if not setting:
        return ""
    value = setting.value_json or {}
    nonce = str(value.get("nonce") or "")
    ciphertext = str(value.get("ciphertext") or "")
    if not nonce or not ciphertext:
        return ""
    return decrypt_secret(nonce, ciphertext)


def _set_secret(db: Session, key: str, value: str) -> None:
    encrypted = encrypt_secret(value)
    setting = _get_or_create_setting(db, key)
    setting.value_json = {
        "nonce": encrypted.nonce,
        "ciphertext": encrypted.ciphertext,
        "algorithm": encrypted.algorithm,
        "key_ref": encrypted.key_ref,
    }
    db.add(setting)


def _delete_setting(db: Session, key: str) -> None:
    setting = _get_setting(db, key)
    if setting:
        db.delete(setting)


def _get_or_create_setting(db: Session, key: str) -> AppSetting:
    setting = _get_setting(db, key)
    if setting:
        return setting
    setting = AppSetting(key=key, value_json={})
    db.add(setting)
    db.flush()
    return setting


def _get_setting(db: Session, key: str) -> AppSetting | None:
    return db.scalar(select(AppSetting).where(AppSetting.key == key))
