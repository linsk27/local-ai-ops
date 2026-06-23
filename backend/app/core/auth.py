import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

from fastapi import HTTPException, Request, status

from app.core.config import get_settings


def create_access_token(username: str) -> tuple[str, int]:
    settings = get_settings()
    expires_at = int(time.time()) + max(settings.auth_token_ttl_minutes, 1) * 60
    payload = {"sub": username, "exp": expires_at}
    payload_text = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = _sign(payload_text)
    return f"{payload_text}.{signature}", expires_at


def verify_access_token(token: str) -> dict[str, Any]:
    if not token or "." not in token:
        raise_auth_error()
    payload_text, signature = token.rsplit(".", 1)
    if not hmac.compare_digest(signature, _sign(payload_text)):
        raise_auth_error()
    try:
        payload = json.loads(_unb64(payload_text).decode("utf-8"))
    except Exception:
        raise_auth_error()
    if int(payload.get("exp") or 0) < int(time.time()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login expired")
    return payload


def verify_admin_password(password: str) -> bool:
    settings = get_settings()
    return secrets.compare_digest(password, settings.admin_password)


def is_default_admin_password() -> bool:
    settings = get_settings()
    return settings.auth_enabled and settings.admin_password == "change-me-now"


def user_from_request(request: Request) -> str:
    settings = get_settings()
    if not settings.auth_enabled:
        return "local-user"
    header = request.headers.get("authorization") or ""
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise_auth_error()
    payload = verify_access_token(token)
    username = str(payload.get("sub") or "")
    if username != settings.admin_username:
        raise_auth_error()
    return username


def raise_auth_error() -> None:
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")


def _sign(payload_text: str) -> str:
    settings = get_settings()
    key = (settings.master_key or settings.admin_password or settings.app_name).encode("utf-8")
    digest = hmac.new(key, payload_text.encode("utf-8"), hashlib.sha256).digest()
    return _b64(digest)


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)
