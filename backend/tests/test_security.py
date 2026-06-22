from app.core.security import decrypt_secret, encrypt_secret, mask_value, redact_obj, redact_text


def test_encrypt_decrypt_roundtrip() -> None:
    encrypted = encrypt_secret("super-secret-value")

    assert encrypted.ciphertext != "super-secret-value"
    assert decrypt_secret(encrypted.nonce, encrypted.ciphertext) == "super-secret-value"


def test_mask_value() -> None:
    assert mask_value("LTAI1234567890") == "LTAI********7890"


def test_redact_text_and_objects() -> None:
    text = "access_key_secret=abcDEF1234567890 token=secretToken123456"
    assert "abcDEF1234567890" not in redact_text(text)
    assert "secretToken123456" not in redact_text(text)

    obj = {"access_key_secret": "abcDEF1234567890", "nested": {"password": "passw0rd!"}}
    redacted = redact_obj(obj)
    assert redacted["access_key_secret"] == "[REDACTED_SECRET]"
    assert redacted["nested"]["password"] == "[REDACTED_SECRET]"
