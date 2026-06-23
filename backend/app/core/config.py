from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "local"
    app_name: str = "Local AI Ops"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    cors_origin_regex: str = (
        r"^https?://("
        r"localhost|127\.0\.0\.1|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|"
        r"172\.(1[6-9]|2[0-9]|3[0-1])(\.\d{1,3}){2}"
        r")(:[0-9]+)?$"
    )

    database_url: str = "sqlite:///./local.db"
    redis_url: str = "redis://localhost:6379/0"

    master_key: str = ""

    auth_enabled: bool = True
    admin_username: str = "admin"
    admin_password: str = "change-me-now"
    auth_token_ttl_minutes: int = 720

    aliyun_mode: str = Field(default="real", pattern="^real$")
    aliyun_default_region: str = "cn-hangzhou"
    auto_sync_enabled: bool = False
    auto_sync_interval_seconds: int = 900

    ai_base_url: str = ""
    ai_api_key: str = ""
    ai_model: str = "gpt-4.1-mini"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
