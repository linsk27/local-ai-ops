import base64
import hashlib
import os
import re
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import get_settings


SECRET_PATTERNS = [
    re.compile(r"(LTAI[A-Za-z0-9]{12,})"),
    re.compile(r"(?i)(access[_-]?key[_-]?secret\s*[:=]\s*)['\"]?([A-Za-z0-9/+_=.-]{12,})"),
    re.compile(r"(?i)(api[_-]?key\s*[:=]\s*)['\"]?([A-Za-z0-9/+_=.-]{12,})"),
    re.compile(r"(?i)(password\s*[:=]\s*)['\"]?([^'\"\s]{6,})"),
    re.compile(r"(?i)(token\s*[:=]\s*)['\"]?([A-Za-z0-9/+_=.-]{12,})"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.DOTALL),
]


@dataclass(frozen=True)
class EncryptedPayload:
    nonce: str
    ciphertext: str
    algorithm: str = "AES-256-GCM"
    key_ref: str = "local-master-key"


def _decode_or_derive_key(raw: str) -> bytes:
    if raw:
        try:
            decoded = base64.urlsafe_b64decode(raw.encode())
            if len(decoded) == 32:
                return decoded
        except Exception:
            pass
        return hashlib.sha256(raw.encode()).digest()
    return hashlib.sha256(b"local-ai-ops-development-key").digest()


def master_key() -> bytes:
    return _decode_or_derive_key(get_settings().master_key)


def encrypt_secret(secret: str) -> EncryptedPayload:
    nonce = os.urandom(12)
    aes = AESGCM(master_key())
    ciphertext = aes.encrypt(nonce, secret.encode(), None)
    return EncryptedPayload(
        nonce=base64.urlsafe_b64encode(nonce).decode(),
        ciphertext=base64.urlsafe_b64encode(ciphertext).decode(),
    )


def decrypt_secret(nonce: str, ciphertext: str) -> str:
    aes = AESGCM(master_key())
    plain = aes.decrypt(
        base64.urlsafe_b64decode(nonce.encode()),
        base64.urlsafe_b64decode(ciphertext.encode()),
        None,
    )
    return plain.decode()


def mask_value(value: str, visible_prefix: int = 4, visible_suffix: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= visible_prefix + visible_suffix:
        return "*" * len(value)
    return f"{value[:visible_prefix]}{'*' * 8}{value[-visible_suffix:]}"


def redact_text(text: str) -> str:
    redacted = text
    for pattern in SECRET_PATTERNS:
        if pattern.pattern.startswith("-----BEGIN"):
            redacted = pattern.sub("[REDACTED_PRIVATE_KEY]", redacted)
        else:
            redacted = pattern.sub(lambda m: f"{m.group(1)}[REDACTED_SECRET]" if len(m.groups()) > 1 else "[REDACTED_SECRET]", redacted)
    return redacted


def redact_obj(value):
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, list):
        return [redact_obj(item) for item in value]
    if isinstance(value, dict):
        cleaned = {}
        for key, item in value.items():
            if re.search(r"(?i)(secret|password|private|token|api_key|access_key)", key):
                cleaned[key] = "[REDACTED_SECRET]"
            else:
                cleaned[key] = redact_obj(item)
        return cleaned
    return value
