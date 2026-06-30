from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class CloudAccount(Base, TimestampMixin):
    __tablename__ = "cloud_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), default="aliyun", nullable=False)
    default_region: Mapped[str] = mapped_column(String(64), default="cn-hangzhou", nullable=False)
    access_key_id_masked: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="untested", nullable=False)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    secrets: Mapped[list["EncryptedSecret"]] = relationship(back_populates="cloud_account", cascade="all, delete-orphan")
    assets: Mapped[list["Asset"]] = relationship(back_populates="cloud_account")


class EncryptedSecret(Base, TimestampMixin):
    __tablename__ = "encrypted_secrets"
    __table_args__ = (UniqueConstraint("cloud_account_id", "name", name="uq_secret_account_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cloud_account_id: Mapped[int | None] = mapped_column(ForeignKey("cloud_accounts.id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    nonce: Mapped[str] = mapped_column(String(80), nullable=False)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    algorithm: Mapped[str] = mapped_column(String(40), default="AES-256-GCM", nullable=False)
    key_ref: Mapped[str] = mapped_column(String(80), default="local-master-key", nullable=False)

    cloud_account: Mapped[CloudAccount | None] = relationship(back_populates="secrets")


class Asset(Base, TimestampMixin):
    __tablename__ = "assets"
    __table_args__ = (UniqueConstraint("provider", "external_id", "region", name="uq_asset_provider_external_region"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    cloud_account_id: Mapped[int | None] = mapped_column(ForeignKey("cloud_accounts.id"), nullable=True)
    provider: Mapped[str] = mapped_column(String(40), default="aliyun", nullable=False)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    external_id: Mapped[str] = mapped_column(String(180), nullable=False)
    region: Mapped[str] = mapped_column(String(80), default="global", nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="unknown", nullable=False)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    cloud_account: Mapped[CloudAccount | None] = relationship(back_populates="assets")
    checks: Mapped[list["Check"]] = relationship(back_populates="asset")


class AssetRelation(Base, TimestampMixin):
    __tablename__ = "asset_relations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)
    target_asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)
    relation_type: Mapped[str] = mapped_column(String(80), nullable=False)


class MonitorGroup(Base, TimestampMixin):
    __tablename__ = "monitor_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    type: Mapped[str] = mapped_column(String(40), default="custom", nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="active", nullable=False)

    checks: Mapped[list["Check"]] = relationship(back_populates="group")
    assets: Mapped[list["MonitorGroupAsset"]] = relationship(back_populates="group", cascade="all, delete-orphan")


class MonitorGroupAsset(Base, TimestampMixin):
    __tablename__ = "monitor_group_assets"
    __table_args__ = (UniqueConstraint("group_id", "asset_id", name="uq_monitor_group_asset"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("monitor_groups.id", ondelete="CASCADE"), nullable=False)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(40), default="primary", nullable=False)

    group: Mapped[MonitorGroup] = relationship(back_populates="assets")


class ServerAccessProfile(Base, TimestampMixin):
    __tablename__ = "server_access_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)
    method: Mapped[str] = mapped_column(String(40), nullable=False)
    username: Mapped[str | None] = mapped_column(String(120), nullable=True)
    secret_id: Mapped[int | None] = mapped_column(ForeignKey("encrypted_secrets.id"), nullable=True)
    port: Mapped[int] = mapped_column(Integer, default=22, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Check(Base, TimestampMixin):
    __tablename__ = "checks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id"), nullable=True)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("monitor_groups.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    target: Mapped[str] = mapped_column(String(500), nullable=False)
    interval_seconds: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    failure_threshold: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    config_json: Mapped[dict] = mapped_column(JSON, default=dict)

    asset: Mapped[Asset | None] = relationship(back_populates="checks")
    group: Mapped[MonitorGroup | None] = relationship(back_populates="checks")
    results: Mapped[list["CheckResult"]] = relationship(back_populates="check", cascade="all, delete-orphan")


class CheckResult(Base, TimestampMixin):
    __tablename__ = "check_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    check_id: Mapped[int] = mapped_column(ForeignKey("checks.id", ondelete="CASCADE"), nullable=False)
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    message: Mapped[str] = mapped_column(Text, default="", nullable=False)
    details_json: Mapped[dict] = mapped_column(JSON, default=dict)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    check: Mapped[Check] = relationship(back_populates="results")


class AlertRule(Base, TimestampMixin):
    __tablename__ = "alert_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    check_id: Mapped[int | None] = mapped_column(ForeignKey("checks.id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    failure_threshold: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Alert(Base, TimestampMixin):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    check_id: Mapped[int | None] = mapped_column(ForeignKey("checks.id"), nullable=True)
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id"), nullable=True)
    severity: Mapped[str] = mapped_column(String(40), default="warning", nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="open", nullable=False)
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    failure_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    last_result_id: Mapped[int | None] = mapped_column(ForeignKey("check_results.id"), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Incident(Base, TimestampMixin):
    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="open", nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)


class AiDiagnosis(Base, TimestampMixin):
    __tablename__ = "ai_diagnoses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    alert_id: Mapped[int | None] = mapped_column(ForeignKey("alerts.id"), nullable=True)
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id"), nullable=True)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    root_causes: Mapped[list] = mapped_column(JSON, default=list)
    steps: Mapped[list] = mapped_column(JSON, default=list)
    commands: Mapped[list] = mapped_column(JSON, default=list)
    context_json: Mapped[dict] = mapped_column(JSON, default=dict)
    model: Mapped[str] = mapped_column(String(120), default="local-rule-engine", nullable=False)


class AuditLog(Base, TimestampMixin):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor: Mapped[str] = mapped_column(String(120), default="local-user", nullable=False)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(80), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(80), nullable=False)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class AppSetting(Base, TimestampMixin):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    value_json: Mapped[dict] = mapped_column(JSON, default=dict)
