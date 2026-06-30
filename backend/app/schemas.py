from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class OrmModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class CloudAccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    access_key_id: str = Field(min_length=1, max_length=160)
    access_key_secret: str = Field(min_length=1, max_length=240)
    default_region: str = "cn-hangzhou"

    @field_validator("name", "access_key_id", "access_key_secret", mode="before")
    @classmethod
    def strip_required_text_fields(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value

    @field_validator("default_region", mode="before")
    @classmethod
    def normalize_default_region(cls, value: str | None) -> str:
        if value is None:
            return "cn-hangzhou"
        region = value.strip() if isinstance(value, str) else str(value).strip()
        return region or "cn-hangzhou"


class CloudAccountRead(OrmModel):
    id: int
    name: str
    provider: str
    default_region: str
    access_key_id_masked: str
    status: str
    last_tested_at: datetime | None = None
    last_error: str | None = None


class AccountTestResult(BaseModel):
    status: str
    checks: list[dict[str, Any]]
    message: str


class AuthLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=500)


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    username: str
    default_password: bool = False


class AuthMeResponse(BaseModel):
    username: str
    auth_enabled: bool
    default_password: bool


class AssetRead(OrmModel):
    id: int
    cloud_account_id: int | None = None
    provider: str
    type: str
    name: str
    external_id: str
    region: str
    status: str
    metadata_json: dict[str, Any]
    runtime_metrics: dict[str, Any] = Field(default_factory=dict)
    data_quality: dict[str, Any] = Field(default_factory=dict)
    last_seen_at: datetime | None = None


class AssetOpsUpdate(BaseModel):
    renewal_expires_at: str | None = Field(default=None, max_length=80)
    renewal_auto_renew: bool | None = None
    renewal_notes: str | None = Field(default=None, max_length=500)
    service_url: str | None = Field(default=None, max_length=500)
    login_url: str | None = Field(default=None, max_length=500)

    @field_validator("renewal_expires_at", "renewal_notes", "service_url", "login_url", mode="before")
    @classmethod
    def strip_optional_text_fields(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value


AccessMethod = Literal["cloud_assistant", "ssh_password", "ssh_key"]


class ServerAccessProfileRead(BaseModel):
    asset_id: int
    method: str = "cloud_assistant"
    host: str = ""
    username: str = ""
    port: int = 22
    enabled: bool = True
    secret_configured: bool = False
    notes: str = ""


class ServerAccessSecretReveal(BaseModel):
    secret: str
    method: AccessMethod


class ServerAccessProfileUpdate(BaseModel):
    method: AccessMethod = "cloud_assistant"
    host: str | None = Field(default=None, max_length=200)
    username: str | None = Field(default=None, max_length=120)
    port: int = Field(default=22, ge=1, le=65535)
    secret: str | None = Field(default=None, max_length=10000)
    clear_secret: bool = False
    enabled: bool = True
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("host", "username", "secret", "notes", mode="before")
    @classmethod
    def strip_optional_text_fields(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value


class BtPanelProfileRead(BaseModel):
    asset_id: int
    url: str = ""
    username: str = ""
    enabled: bool = True
    password_configured: bool = False
    notes: str = ""


class BtPanelProfileUpdate(BaseModel):
    url: str | None = Field(default=None, max_length=500)
    username: str | None = Field(default=None, max_length=120)
    password: str | None = Field(default=None, max_length=500)
    clear_password: bool = False
    enabled: bool = True
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("url", "username", "password", "notes", mode="before")
    @classmethod
    def strip_optional_text_fields(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value


class BtPanelPasswordReveal(BaseModel):
    password: str


class SyncRequest(BaseModel):
    account_id: int | None = None


class SyncResponse(BaseModel):
    task_id: str
    synced: int
    mode: str
    message: str


MonitorGroupType = Literal["server", "domain", "oss", "dns", "custom"]


class MonitorGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    type: MonitorGroupType = "custom"
    description: str = Field(default="", max_length=1000)
    asset_ids: list[int] = Field(default_factory=list)


class MonitorGroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    type: MonitorGroupType | None = None
    description: str | None = Field(default=None, max_length=1000)
    asset_ids: list[int] | None = None


class MonitorGroupRead(OrmModel):
    id: int
    name: str
    type: str
    description: str
    status: str
    asset_ids: list[int] = Field(default_factory=list)
    asset_count: int
    check_count: int
    failing_count: int
    last_checked_at: datetime | None = None


CheckType = Literal["http", "tcp", "ssh", "ecs_metric", "cloud_assistant"]


class CheckCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    type: CheckType
    target: str = Field(min_length=1, max_length=500)
    asset_id: int | None = None
    group_id: int | None = None
    interval_seconds: int = Field(default=60, ge=15, le=86400)
    timeout_seconds: int = Field(default=5, ge=1, le=60)
    threshold: float | None = None
    failure_threshold: int = Field(default=2, ge=1, le=10)
    config_json: dict[str, Any] = Field(default_factory=dict)


class CheckUpdate(BaseModel):
    group_id: int | None = None
    enabled: bool | None = None
    interval_seconds: int | None = Field(default=None, ge=15, le=86400)
    timeout_seconds: int | None = Field(default=None, ge=1, le=60)
    threshold: float | None = None
    failure_threshold: int | None = Field(default=None, ge=1, le=10)


class CheckRead(OrmModel):
    id: int
    asset_id: int | None
    group_id: int | None = None
    name: str
    type: str
    target: str
    interval_seconds: int
    timeout_seconds: int
    threshold: float | None
    failure_threshold: int
    enabled: bool
    config_json: dict[str, Any]
    asset_name: str | None = None
    asset_type: str | None = None
    asset_region: str | None = None
    group_name: str | None = None
    group_type: str | None = None
    last_status: str | None = None
    last_message: str | None = None
    last_value: float | None = None
    last_latency_ms: float | None = None
    last_checked_at: datetime | None = None
    open_alert_id: int | None = None
    open_alert_status: str | None = None
    result_count: int = 0


class CheckResultRead(OrmModel):
    id: int
    check_id: int
    asset_id: int | None
    status: str
    latency_ms: float | None
    value: float | None
    message: str
    details_json: dict[str, Any]
    checked_at: datetime


class AlertRead(OrmModel):
    id: int
    check_id: int | None
    asset_id: int | None
    severity: str
    status: str
    title: str
    message: str
    failure_count: int
    created_at: datetime
    updated_at: datetime
    acknowledged_at: datetime | None = None
    closed_at: datetime | None = None


class AlertUpdate(BaseModel):
    status: Literal["acknowledged", "closed"]


class DiagnosisRequest(BaseModel):
    alert_id: int | None = None
    asset_id: int | None = None
    locale: Literal["zh", "en"] = "zh"


class DiagnosisRead(OrmModel):
    id: int
    alert_id: int | None
    asset_id: int | None
    summary: str
    root_causes: list[Any]
    steps: list[Any]
    commands: list[Any]
    context_json: dict[str, Any]
    model: str
    created_at: datetime


class DashboardSummary(BaseModel):
    assets_total: int
    assets_by_type: dict[str, int]
    open_alerts: int
    checks_total: int
    website_uptime: float | None
    website_uptime_ok: int = 0
    website_uptime_total: int = 0
    website_uptime_checked_at: datetime | None = None
    website_uptime_window: str = "latest_50_http_checks"
    risk_summary: list[dict[str, Any]] = Field(default_factory=list)
    risk_items: list[dict[str, Any]]


class KnowledgeSummary(BaseModel):
    assets_total: int
    server_total: int
    open_alerts: int
    checks_total: int
    expiring_soon: int
    credential_configured: int
    top_regions: list[dict[str, Any]] = Field(default_factory=list)
    top_risks: list[dict[str, Any]] = Field(default_factory=list)
    suggested_questions: list[str] = Field(default_factory=list)


class KnowledgeQuery(BaseModel):
    question: str = Field(min_length=1, max_length=400)
    locale: Literal["zh", "en"] = "zh"

    @field_validator("question", mode="before")
    @classmethod
    def strip_question(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value


class KnowledgeAnswer(BaseModel):
    question: str
    intent: str
    answer: str
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    actions: list[str] = Field(default_factory=list)


class AssetGraphNode(BaseModel):
    id: str
    asset_id: int
    label: str
    type: str
    region: str
    status: str


class AssetGraphEdge(BaseModel):
    source: str
    target: str
    relation: str
    confidence: str = "inferred"


class AssetGraphResponse(BaseModel):
    nodes: list[AssetGraphNode]
    edges: list[AssetGraphEdge]


class RenewalItem(BaseModel):
    asset_id: int
    name: str
    type: str
    region: str
    expires_at: str | None
    days_left: int | None
    auto_renew: bool | None
    status: str
    source: str
    console_url: str | None = None


class RenewalCenterResponse(BaseModel):
    total: int
    expiring_soon: int
    expired: int
    auto_renew_enabled: int
    unknown: int
    items: list[RenewalItem]


class AiConfigRead(BaseModel):
    base_url: str
    model: str
    api_key_masked: str
    configured: bool
    source: str


class AiConfigTestResult(BaseModel):
    status: str
    message: str
    base_url: str
    model: str
    latency_ms: float | None = None


class AiConfigUpdate(BaseModel):
    base_url: str = Field(default="", max_length=500)
    model: str = Field(default="gpt-4.1-mini", min_length=1, max_length=120)
    api_key: str | None = Field(default=None, max_length=500)
    clear_api_key: bool = False
