from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import delete, desc, func, select, update

from app.api.deps import DbSession
from app.core.auth import create_access_token, is_default_admin_password, user_from_request, verify_admin_password
from app.core.config import get_settings
from app.core.security import decrypt_secret, encrypt_secret, mask_value, redact_text
from app.models import (
    Alert,
    AlertRule,
    Asset,
    AssetRelation,
    AuditLog,
    Check,
    CheckResult,
    CloudAccount,
    EncryptedSecret,
    MonitorGroup,
    MonitorGroupAsset,
    ServerAccessProfile,
)
from app.schemas import (
    AccountTestResult,
    AiConfigRead,
    AiConfigTestResult,
    AiConfigUpdate,
    AlertRead,
    AlertUpdate,
    AssetGraphResponse,
    AssetOpsUpdate,
    AssetRead,
    AuthLoginRequest,
    AuthMeResponse,
    AuthTokenResponse,
    BtPanelPasswordReveal,
    BtPanelProfileRead,
    BtPanelProfileUpdate,
    CheckCreate,
    CheckRead,
    CheckResultRead,
    CheckUpdate,
    CloudAccountCreate,
    CloudAccountRead,
    DashboardSummary,
    DiagnosisRead,
    DiagnosisRequest,
    KnowledgeAnswer,
    KnowledgeQuery,
    KnowledgeSummary,
    MonitorGroupCreate,
    MonitorGroupRead,
    MonitorGroupUpdate,
    RenewalCenterResponse,
    ServerAccessProfileRead,
    ServerAccessSecretReveal,
    ServerAccessProfileUpdate,
    SyncRequest,
    SyncResponse,
)
from app.services.ai import generate_diagnosis
from app.services.ai_config import read_ai_config, save_ai_config, test_ai_config
from app.services.aliyun import AliyunClient, AliyunCredentials, AliyunIntegrationError, format_aliyun_error
from app.services.check_runner import execute_check


router = APIRouter()


@router.post("/auth/login", response_model=AuthTokenResponse)
def login(payload: AuthLoginRequest) -> AuthTokenResponse:
    settings = get_settings()
    if not settings.auth_enabled:
        token, expires_at = create_access_token(settings.admin_username)
        return AuthTokenResponse(
            access_token=token,
            expires_at=datetime.fromtimestamp(expires_at, tz=timezone.utc),
            username=settings.admin_username,
            default_password=False,
        )
    if payload.username != settings.admin_username or not verify_admin_password(payload.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token, expires_at = create_access_token(payload.username)
    return AuthTokenResponse(
        access_token=token,
        expires_at=datetime.fromtimestamp(expires_at, tz=timezone.utc),
        username=payload.username,
        default_password=is_default_admin_password(),
    )


@router.get("/auth/me", response_model=AuthMeResponse)
def me(request: Request) -> AuthMeResponse:
    settings = get_settings()
    username = user_from_request(request)
    return AuthMeResponse(username=username, auth_enabled=settings.auth_enabled, default_password=is_default_admin_password())


@router.post("/auth/logout")
def logout() -> dict[str, bool]:
    return {"ok": True}


@router.get("/settings/ai", response_model=AiConfigRead)
def get_ai_settings(db: DbSession) -> AiConfigRead:
    return AiConfigRead(**read_ai_config(db))


@router.put("/settings/ai", response_model=AiConfigRead)
def update_ai_settings(payload: AiConfigUpdate, db: DbSession) -> AiConfigRead:
    base_url = payload.base_url.strip()
    if base_url and not base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="AI Base URL must start with http:// or https://")
    result = save_ai_config(
        db,
        base_url=base_url,
        model=payload.model,
        api_key=payload.api_key,
        clear_api_key=payload.clear_api_key,
    )
    db.add(AuditLog(action="settings.ai.update", resource_type="settings", resource_id="ai", metadata_json={"configured": result["configured"]}))
    db.commit()
    return AiConfigRead(**result)


@router.post("/settings/ai/test", response_model=AiConfigTestResult)
def test_ai_settings(db: DbSession) -> AiConfigTestResult:
    result = test_ai_config(db)
    db.add(AuditLog(action="settings.ai.test", resource_type="settings", resource_id="ai", metadata_json={"status": result["status"]}))
    db.commit()
    return AiConfigTestResult(**result)


@router.get("/dashboard", response_model=DashboardSummary)
def dashboard(db: DbSession) -> DashboardSummary:
    assets = db.scalars(select(Asset)).all()
    access_profiles = {
        profile.asset_id: profile
        for profile in db.scalars(select(ServerAccessProfile)).all()
    }
    assets_by_type: dict[str, int] = {}
    for asset in assets:
        assets_by_type[asset.type] = assets_by_type.get(asset.type, 0) + 1
    open_alerts = db.scalar(select(func.count()).select_from(Alert).where(Alert.status.in_(["open", "acknowledged"]))) or 0
    checks_total = db.scalar(select(func.count()).select_from(Check)) or 0
    http_results = db.scalars(
        select(CheckResult).join(Check, Check.id == CheckResult.check_id).where(Check.type == "http").order_by(desc(CheckResult.checked_at)).limit(50)
    ).all()
    website_uptime_total = len(http_results)
    website_uptime_ok = sum(1 for item in http_results if item.status == "ok")
    website_uptime = round((website_uptime_ok / website_uptime_total) * 100, 2) if website_uptime_total else None
    website_uptime_checked_at = http_results[0].checked_at if http_results else None
    risks: list[dict[str, object]] = []
    risk_summary: dict[str, dict[str, object]] = {}
    for asset in assets:
        meta = asset.metadata_json or {}
        disk_used = _number_or_none(meta.get("disk_used_percent"))
        memory_used = _number_or_none(meta.get("memory_used_percent"))
        expires_in_days = _number_or_none(meta.get("expires_in_days"))
        if disk_used is not None and disk_used >= 85:
            _add_risk(risks, risk_summary, asset, "disk_high", disk_used, "critical" if disk_used >= 90 else "warning")
        if memory_used is not None and memory_used >= 85:
            _add_risk(risks, risk_summary, asset, "memory_high", memory_used, "critical" if memory_used >= 90 else "warning")
        if expires_in_days is not None and expires_in_days <= 45:
            _add_risk(risks, risk_summary, asset, "expiring", expires_in_days, "critical" if expires_in_days <= 15 else "warning")
        if asset.type in {"ecs", "swas"}:
            profile = access_profiles.get(asset.id)
            if not profile or not profile.enabled or not profile.username or not profile.secret_id:
                _add_risk(risks, risk_summary, asset, "access_missing", None, "info")
            if disk_used is None and memory_used is None:
                _add_risk(risks, risk_summary, asset, "usage_missing", None, "info")
    risks.sort(key=lambda item: (_severity_rank(str(item.get("severity"))), str(item.get("asset"))))
    return DashboardSummary(
        assets_total=len(assets),
        assets_by_type=assets_by_type,
        open_alerts=open_alerts,
        checks_total=checks_total,
        website_uptime=website_uptime,
        website_uptime_ok=website_uptime_ok,
        website_uptime_total=website_uptime_total,
        website_uptime_checked_at=website_uptime_checked_at,
        risk_summary=sorted(risk_summary.values(), key=lambda item: (_severity_rank(str(item.get("severity"))), str(item.get("kind")))),
        risk_items=risks[:8],
    )


@router.get("/knowledge/summary", response_model=KnowledgeSummary)
def knowledge_summary(db: DbSession) -> KnowledgeSummary:
    assets = list(db.scalars(select(Asset)).all())
    checks_total = db.scalar(select(func.count()).select_from(Check)) or 0
    open_alerts = db.scalar(select(func.count()).select_from(Alert).where(Alert.status.in_(["open", "acknowledged"]))) or 0
    access_profiles = {
        profile.asset_id: profile
        for profile in db.scalars(select(ServerAccessProfile)).all()
    }
    dashboard_payload = dashboard(db)
    regions: dict[str, int] = {}
    expiring_soon = 0
    credential_configured = 0
    for asset in assets:
        regions[asset.region or "global"] = regions.get(asset.region or "global", 0) + 1
        renewal = _renewal_item_for_asset(asset)
        if renewal["days_left"] is not None and renewal["days_left"] <= 30:
            expiring_soon += 1
        profile = access_profiles.get(asset.id)
        if profile and profile.enabled and profile.secret_id:
            credential_configured += 1
    top_regions = [
        {"region": region, "count": count}
        for region, count in sorted(regions.items(), key=lambda item: (-item[1], item[0]))[:6]
    ]
    return KnowledgeSummary(
        assets_total=len(assets),
        server_total=sum(1 for asset in assets if asset.type in {"ecs", "swas", "server"}),
        open_alerts=open_alerts,
        checks_total=checks_total,
        expiring_soon=expiring_soon,
        credential_configured=credential_configured,
        top_regions=top_regions,
        top_risks=dashboard_payload.risk_items[:5],
        suggested_questions=[
            "哪些服务器快到期了？",
            "哪些资产缺少 SSH 凭据？",
            "当前有哪些告警或失败监控？",
            "哪些服务器内存或磁盘压力较高？",
        ],
    )


@router.post("/knowledge/query", response_model=KnowledgeAnswer)
def query_knowledge(payload: KnowledgeQuery, db: DbSession) -> KnowledgeAnswer:
    question = payload.question
    normalized = question.lower()
    assets = list(db.scalars(select(Asset)).all())
    metrics = _runtime_metrics_for_assets(db, [asset.id for asset in assets])
    quality = _data_quality_for_assets(db, assets, metrics)
    alerts = list(db.scalars(select(Alert).where(Alert.status.in_(["open", "acknowledged"])).order_by(desc(Alert.updated_at)).limit(10)).all())

    if any(token in normalized for token in ["续费", "到期", "expire", "renew"]):
        items = [_renewal_item_for_asset(asset) for asset in assets]
        items.sort(key=lambda item: 999999 if item["days_left"] is None else item["days_left"])
        evidence = items[:8]
        return KnowledgeAnswer(
            question=question,
            intent="renewal",
            answer=_knowledge_answer_text("renewal", evidence, payload.locale),
            evidence=evidence,
            actions=["打开续费中心", "检查自动续费状态", "对 30 天内到期资产确认负责人"],
        )

    if any(token in normalized for token in ["ssh", "密码", "凭据", "宝塔", "bt", "panel"]):
        evidence = []
        for asset in assets:
            if asset.type not in {"ecs", "swas", "server"}:
                continue
            asset_quality = quality.get(asset.id, {})
            sources = asset_quality.get("field_sources", {})
            evidence.append(
                {
                    "asset_id": asset.id,
                    "name": asset.name,
                    "region": asset.region,
                    "ssh": sources.get("ssh", "missing"),
                    "bt_panel": sources.get("bt_panel", "missing"),
                }
            )
        return KnowledgeAnswer(
            question=question,
            intent="access",
            answer=_knowledge_answer_text("access", evidence, payload.locale),
            evidence=evidence[:12],
            actions=["进入资产详情配置 SSH", "复制密码前确认本机环境安全", "优先使用云助手执行只读采集"],
        )

    if any(token in normalized for token in ["磁盘", "内存", "使用率", "disk", "memory", "usage"]):
        evidence = []
        for asset in assets:
            asset_metrics = metrics.get(asset.id, {})
            disk_used = _number_or_none(asset_metrics.get("disk_used_percent"))
            memory_used = _number_or_none(asset_metrics.get("memory_used_percent"))
            if disk_used is not None or memory_used is not None:
                evidence.append(
                    {
                        "asset_id": asset.id,
                        "name": asset.name,
                        "region": asset.region,
                        "disk_used_percent": disk_used,
                        "memory_used_percent": memory_used,
                    }
                )
        evidence.sort(key=lambda item: max(item.get("disk_used_percent") or 0, item.get("memory_used_percent") or 0), reverse=True)
        return KnowledgeAnswer(
            question=question,
            intent="runtime_usage",
            answer=_knowledge_answer_text("runtime_usage", evidence, payload.locale),
            evidence=evidence[:10],
            actions=["对高于 85% 的磁盘或内存资产执行排查", "确认最近采集时间", "必要时进入监控页手动执行"],
        )

    if any(token in normalized for token in ["告警", "异常", "失败", "alert", "fail"]):
        evidence = [
            {
                "alert_id": alert.id,
                "asset_id": alert.asset_id,
                "title": redact_text(alert.title),
                "status": alert.status,
                "severity": alert.severity,
                "failure_count": alert.failure_count,
            }
            for alert in alerts
        ]
        return KnowledgeAnswer(
            question=question,
            intent="alerts",
            answer=_knowledge_answer_text("alerts", evidence, payload.locale),
            evidence=evidence,
            actions=["进入告警列表查看详情", "对未关闭告警生成 AI 诊断", "恢复后关闭告警"],
        )

    summary = knowledge_summary(db)
    return KnowledgeAnswer(
        question=question,
        intent="overview",
        answer=_knowledge_answer_text("overview", [summary.model_dump()], payload.locale),
        evidence=[summary.model_dump()],
        actions=["查看总览态势", "同步资产后再提问", "为关键服务器生成默认监控"],
    )


@router.get("/asset-graph", response_model=AssetGraphResponse)
def asset_graph(db: DbSession) -> AssetGraphResponse:
    assets = list(db.scalars(select(Asset).order_by(Asset.type, Asset.name)).all())
    asset_by_id = {asset.id: asset for asset in assets}
    nodes = [
        {
            "id": f"asset-{asset.id}",
            "asset_id": asset.id,
            "label": asset.name,
            "type": asset.type,
            "region": asset.region,
            "status": asset.status,
        }
        for asset in assets
    ]
    edges: list[dict] = []
    seen_edges: set[tuple[str, str, str]] = set()

    def add_edge(source_id: int, target_id: int, relation: str, confidence: str = "inferred") -> None:
        if source_id == target_id or source_id not in asset_by_id or target_id not in asset_by_id:
            return
        key = (f"asset-{source_id}", f"asset-{target_id}", relation)
        if key in seen_edges:
            return
        seen_edges.add(key)
        edges.append({"source": key[0], "target": key[1], "relation": relation, "confidence": confidence})

    for relation in db.scalars(select(AssetRelation)).all():
        add_edge(relation.source_asset_id, relation.target_asset_id, relation.relation_type, "stored")

    server_ip_map: dict[str, int] = {}
    domain_assets: list[Asset] = []
    dns_assets: list[Asset] = []
    for asset in assets:
        if asset.type in {"ecs", "swas", "server"}:
            for ip in _asset_ips(asset):
                server_ip_map[ip] = asset.id
        if asset.type == "domain":
            domain_assets.append(asset)
        if asset.type == "dns":
            dns_assets.append(asset)

    for dns in dns_assets:
        values = _metadata_strings(dns.metadata_json or {})
        for value in values:
            if value in server_ip_map:
                add_edge(dns.id, server_ip_map[value], "resolves_to")
        for domain in domain_assets:
            if domain.name and any(domain.name in value for value in values + [dns.name]):
                add_edge(domain.id, dns.id, "has_dns_record")

    return AssetGraphResponse(nodes=nodes, edges=edges)


@router.get("/renewals", response_model=RenewalCenterResponse)
def renewal_center(db: DbSession) -> RenewalCenterResponse:
    items = [_renewal_item_for_asset(asset) for asset in db.scalars(select(Asset)).all()]
    items.sort(key=lambda item: 999999 if item["days_left"] is None else item["days_left"])
    return RenewalCenterResponse(
        total=len(items),
        expiring_soon=sum(1 for item in items if item["days_left"] is not None and 0 <= item["days_left"] <= 30),
        expired=sum(1 for item in items if item["days_left"] is not None and item["days_left"] < 0),
        auto_renew_enabled=sum(1 for item in items if item["auto_renew"] is True),
        unknown=sum(1 for item in items if item["expires_at"] is None),
        items=items,
    )


def _knowledge_answer_text(intent: str, evidence: list[dict], locale: str) -> str:
    if locale == "en":
        if intent == "renewal":
            urgent = sum(1 for item in evidence if item.get("days_left") is not None and item["days_left"] <= 30)
            return f"Found {len(evidence)} renewal records in the local database. {urgent} shown items are due within 30 days."
        if intent == "access":
            configured = sum(1 for item in evidence if item.get("ssh") == "encrypted_local_secret")
            return f"Found {len(evidence)} server access records. {configured} have encrypted SSH credentials configured locally."
        if intent == "runtime_usage":
            return f"Found {len(evidence)} assets with collected memory or disk usage. Review items over 85% first."
        if intent == "alerts":
            return f"Found {len(evidence)} open or acknowledged alerts."
        return "This answer is generated from the local operations database: assets, checks, alerts, runtime metrics, and encrypted-credential status."

    if intent == "renewal":
        urgent = sum(1 for item in evidence if item.get("days_left") is not None and item["days_left"] <= 30)
        return f"本地库中找到 {len(evidence)} 条续费记录，其中当前展示项里 {urgent} 个在 30 天内到期。"
    if intent == "access":
        configured = sum(1 for item in evidence if item.get("ssh") == "encrypted_local_secret")
        return f"本地库中找到 {len(evidence)} 台服务器访问资料，其中 {configured} 台已配置本地加密 SSH 凭据。"
    if intent == "runtime_usage":
        return f"本地库中找到 {len(evidence)} 个已采集内存或磁盘使用率的资产，优先关注超过 85% 的项目。"
    if intent == "alerts":
        return f"当前有 {len(evidence)} 条打开或已确认的告警。"
    return "该回答来自本地运维数据库，覆盖资产、监控、告警、运行时指标和凭据配置状态。"


def _renewal_item_for_asset(asset: Asset) -> dict:
    metadata = dict(asset.metadata_json or {})
    ops = metadata.get("ops") if isinstance(metadata.get("ops"), dict) else {}
    source = _renewal_source(metadata, ops if isinstance(ops, dict) else {})
    expires_at = _first_text(
        ops.get("renewal_expires_at") if isinstance(ops, dict) else None,
        metadata.get("expires_at"),
        metadata.get("expired_time"),
        metadata.get("expiration_date"),
        metadata.get("billing_end_time"),
    )
    days_left = _days_until(expires_at)
    auto_renew = _auto_renew_value(metadata, ops if isinstance(ops, dict) else {})
    if days_left is None:
        status = "unknown"
    elif days_left < 0:
        status = "expired"
    elif days_left <= 7:
        status = "urgent"
    elif days_left <= 30:
        status = "soon"
    else:
        status = "ok"
    return {
        "asset_id": asset.id,
        "name": asset.name,
        "type": asset.type,
        "region": asset.region,
        "expires_at": expires_at,
        "days_left": days_left,
        "auto_renew": auto_renew,
        "status": status,
        "source": source,
        "console_url": _console_url_for_asset(asset),
    }


def _first_text(*values: object) -> str | None:
    for value in values:
        if value in (None, "", [], {}):
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _days_until(value: str | None) -> int | None:
    if not value:
        return None
    text = value.strip()
    for part in (text[:10], text.replace("/", "-")[:10]):
        try:
            expires = datetime.fromisoformat(part).date()
            return (expires - datetime.now(timezone.utc).date()).days
        except ValueError:
            continue
    return None


def _auto_renew_value(metadata: dict, ops: dict) -> bool | None:
    if "renewal_auto_renew" in ops and ops["renewal_auto_renew"] is not None:
        return bool(ops["renewal_auto_renew"])
    for key in ("auto_renew_enabled", "auto_renew", "autoRenew"):
        value = metadata.get(key)
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"true", "enabled", "enable", "on", "yes", "1"}:
                return True
            if normalized in {"false", "disabled", "disable", "off", "no", "0"}:
                return False
    renew_status = str(metadata.get("renew_status") or metadata.get("renewStatus") or "").lower()
    if renew_status:
        if "auto" in renew_status or "renewal" in renew_status:
            return True
        if "manual" in renew_status or "normal" in renew_status:
            return False
    return None


def _console_url_for_asset(asset: Asset) -> str | None:
    if asset.type == "swas":
        return f"https://swas.console.aliyun.com/servers/{asset.region}/{asset.external_id}"
    if asset.type == "ecs":
        return f"https://ecs.console.aliyun.com/server/{asset.region}/{asset.external_id}/detail"
    if asset.type == "oss":
        return "https://oss.console.aliyun.com/bucket"
    if asset.type == "domain":
        return "https://dc.console.aliyun.com/next/index"
    if asset.type == "dns":
        return "https://dns.console.aliyun.com/"
    return None


def _asset_ips(asset: Asset) -> list[str]:
    metadata = dict(asset.metadata_json or {})
    ips: list[str] = []
    for key in ("public_ip", "public_ip_address", "private_ip", "private_ip_address", "inner_ip_address", "eip"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            ips.append(value.strip())
        elif isinstance(value, list):
            ips.extend(str(item).strip() for item in value if str(item).strip())
    return sorted(set(ips))


def _metadata_strings(metadata: dict) -> list[str]:
    values: list[str] = []

    def collect(value: object) -> None:
        if isinstance(value, str):
            stripped = value.strip()
            if stripped:
                values.append(stripped)
        elif isinstance(value, dict):
            for nested in value.values():
                collect(nested)
        elif isinstance(value, list):
            for nested in value:
                collect(nested)

    collect(metadata)
    return values


def _add_risk(
    risks: list[dict[str, object]],
    summary: dict[str, dict[str, object]],
    asset: Asset,
    kind: str,
    value: float | None,
    severity: str,
) -> None:
    risks.append(
        {
            "asset_id": asset.id,
            "asset": asset.name,
            "asset_type": asset.type,
            "kind": kind,
            "value": value,
            "severity": severity,
        }
    )
    item = summary.setdefault(kind, {"kind": kind, "count": 0, "severity": severity})
    item["count"] = int(item["count"]) + 1
    if _severity_rank(severity) < _severity_rank(str(item["severity"])):
        item["severity"] = severity


def _severity_rank(severity: str) -> int:
    return {"critical": 0, "warning": 1, "info": 2}.get(severity, 3)


def _number_or_none(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


@router.post("/cloud-accounts", response_model=CloudAccountRead)
def create_cloud_account(payload: CloudAccountCreate, db: DbSession) -> CloudAccount:
    account = CloudAccount(
        name=payload.name,
        provider="aliyun",
        default_region=payload.default_region,
        access_key_id_masked=mask_value(payload.access_key_id),
    )
    db.add(account)
    db.flush()
    for name, value in {"access_key_id": payload.access_key_id, "access_key_secret": payload.access_key_secret}.items():
        encrypted = encrypt_secret(value)
        db.add(
            EncryptedSecret(
                cloud_account_id=account.id,
                name=name,
                nonce=encrypted.nonce,
                ciphertext=encrypted.ciphertext,
                algorithm=encrypted.algorithm,
                key_ref=encrypted.key_ref,
            )
        )
    db.add(AuditLog(action="cloud_account.create", resource_type="cloud_account", resource_id=str(account.id), metadata_json={"name": payload.name}))
    db.commit()
    db.refresh(account)
    return account


@router.get("/cloud-accounts", response_model=list[CloudAccountRead])
def list_cloud_accounts(db: DbSession) -> list[CloudAccount]:
    return list(db.scalars(select(CloudAccount).order_by(desc(CloudAccount.created_at))).all())


@router.post("/cloud-accounts/{account_id}/test", response_model=AccountTestResult)
def test_cloud_account(account_id: int, db: DbSession) -> AccountTestResult:
    account = db.get(CloudAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Cloud account not found")
    result = AliyunClient(_credentials_for_account(db, account)).test_account()
    account.status = result["status"]
    account.last_tested_at = datetime.now(timezone.utc)
    account.last_error = None if result["status"] in {"healthy", "degraded"} else redact_text(result.get("message", ""))
    db.add(account)
    db.add(AuditLog(action="cloud_account.test", resource_type="cloud_account", resource_id=str(account.id), metadata_json={"status": account.status}))
    db.commit()
    return AccountTestResult(**result)


@router.delete("/cloud-accounts/{account_id}")
def delete_cloud_account(account_id: int, db: DbSession) -> dict[str, int | bool]:
    account = db.get(CloudAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Cloud account not found")
    result = db.execute(update(Asset).where(Asset.cloud_account_id == account.id).values(cloud_account_id=None))
    detached_assets = result.rowcount or 0
    db.add(
        AuditLog(
            action="cloud_account.delete",
            resource_type="cloud_account",
            resource_id=str(account.id),
            metadata_json={"name": account.name, "detached_assets": detached_assets},
        )
    )
    db.delete(account)
    db.commit()
    return {"deleted": True, "detached_assets": detached_assets}


@router.post("/assets/sync", response_model=SyncResponse)
def sync_assets(payload: SyncRequest, db: DbSession) -> SyncResponse:
    account = db.get(CloudAccount, payload.account_id) if payload.account_id else db.scalar(select(CloudAccount).order_by(desc(CloudAccount.created_at)))
    if not account:
        raise HTTPException(status_code=400, detail="Add a RAM AccessKey account before syncing real Alibaba Cloud assets.")
    client = AliyunClient(_credentials_for_account(db, account) if account else None)
    try:
        assets = client.list_assets()
    except AliyunIntegrationError as exc:
        safe_message = format_aliyun_error(exc)
        db.add(AuditLog(action="assets.sync.failed", resource_type="cloud_account", resource_id=str(account.id), metadata_json={"error": safe_message}))
        db.commit()
        raise HTTPException(status_code=502, detail=safe_message) from exc
    synced = 0
    for item in assets:
        existing = db.scalar(
            select(Asset).where(
                Asset.provider == "aliyun",
                Asset.external_id == item["external_id"],
                Asset.region == item.get("region", "global"),
            )
        )
        if not existing:
            existing = Asset(
                cloud_account_id=account.id if account else None,
                provider="aliyun",
                type=item["type"],
                name=item["name"],
                external_id=item["external_id"],
                region=item.get("region", "global"),
            )
        existing.status = item.get("status", "unknown")
        incoming_metadata = _merge_synced_metadata(
            dict(item.get("metadata_json", {}) or {}),
            dict(existing.metadata_json or {}),
        )
        existing.metadata_json = incoming_metadata
        existing.last_seen_at = datetime.now(timezone.utc)
        db.add(existing)
        synced += 1
    warnings = client.warning_messages()
    db.add(AuditLog(action="assets.sync", resource_type="cloud_account", resource_id=str(account.id), metadata_json={"synced": synced, "warnings": warnings}))
    db.commit()
    message = "Real Alibaba Cloud asset sync completed"
    if warnings:
        message = f"{message} with warnings: {'; '.join(warnings)}"
    return SyncResponse(task_id=f"sync-{uuid4().hex[:12]}", synced=synced, mode=get_settings().aliyun_mode, message=message)


@router.get("/assets", response_model=list[AssetRead])
def list_assets(
    db: DbSession,
    type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    region: str | None = Query(default=None),
    account_id: int | None = Query(default=None),
) -> list[dict]:
    stmt = select(Asset).order_by(desc(Asset.updated_at))
    if type:
        stmt = stmt.where(Asset.type == type)
    if status:
        stmt = stmt.where(Asset.status == status)
    if region:
        stmt = stmt.where(Asset.region == region)
    if account_id:
        stmt = stmt.where(Asset.cloud_account_id == account_id)
    assets = list(db.scalars(stmt).all())
    metrics = _runtime_metrics_for_assets(db, [asset.id for asset in assets])
    quality = _data_quality_for_assets(db, assets, metrics)
    return [_asset_read(asset, metrics.get(asset.id, {}), quality.get(asset.id, {})) for asset in assets]


@router.get("/assets/{asset_id}", response_model=AssetRead)
def get_asset(asset_id: int, db: DbSession) -> dict:
    asset = _get_asset_or_404(db, asset_id)
    metrics = _runtime_metrics_for_assets(db, [asset.id])
    quality = _data_quality_for_assets(db, [asset], metrics)
    return _asset_read(asset, metrics.get(asset.id, {}), quality.get(asset.id, {}))


@router.patch("/assets/{asset_id}/ops", response_model=AssetRead)
def update_asset_ops(asset_id: int, payload: AssetOpsUpdate, db: DbSession) -> dict:
    asset = _get_asset_or_404(db, asset_id)
    metadata = dict(asset.metadata_json or {})
    existing_ops = metadata.get("ops")
    ops = dict(existing_ops) if isinstance(existing_ops, dict) else {}
    for key, value in payload.model_dump().items():
        if value is not None:
            ops[key] = value
    metadata["ops"] = ops
    asset.metadata_json = metadata
    db.add(asset)
    db.add(
        AuditLog(
            action="asset.ops.update",
            resource_type="asset",
            resource_id=str(asset.id),
            metadata_json={"fields": sorted(payload.model_dump(exclude_none=True).keys())},
        )
    )
    db.commit()
    db.refresh(asset)
    metrics = _runtime_metrics_for_assets(db, [asset.id])
    quality = _data_quality_for_assets(db, [asset], metrics)
    return _asset_read(asset, metrics.get(asset.id, {}), quality.get(asset.id, {}))


@router.get("/assets/{asset_id}/access-profile", response_model=ServerAccessProfileRead)
def get_access_profile(asset_id: int, db: DbSession) -> ServerAccessProfileRead:
    asset = _get_asset_or_404(db, asset_id)
    return _server_access_profile_read(db, asset)


@router.put("/assets/{asset_id}/access-profile", response_model=ServerAccessProfileRead)
def upsert_access_profile(asset_id: int, payload: ServerAccessProfileUpdate, db: DbSession) -> ServerAccessProfileRead:
    asset = _get_asset_or_404(db, asset_id)
    metadata = dict(asset.metadata_json or {})
    existing_access_metadata = metadata.get("access_profile")
    access_metadata = dict(existing_access_metadata) if isinstance(existing_access_metadata, dict) else {}
    access_metadata["host"] = payload.host or ""
    access_metadata["notes"] = payload.notes or ""
    metadata["access_profile"] = access_metadata
    asset.metadata_json = metadata

    profile = db.scalar(select(ServerAccessProfile).where(ServerAccessProfile.asset_id == asset.id))
    existing_secret_configured = bool(profile and profile.secret_id and db.get(EncryptedSecret, profile.secret_id))
    will_have_secret = bool(payload.secret) or (existing_secret_configured and not payload.clear_secret)
    if payload.method in {"ssh_password", "ssh_key"} and not (payload.username or "").strip():
        raise HTTPException(
            status_code=400,
            detail="SSH username is required when using SSH password or private key. Use root or the server login user.",
        )
    if payload.method in {"ssh_password", "ssh_key"} and not will_have_secret:
        raise HTTPException(
            status_code=400,
            detail="SSH password or private key is required on first SSH access setup. Enter the server login credential or switch back to Cloud Assistant first.",
        )

    if not profile:
        profile = ServerAccessProfile(asset_id=asset.id, method=payload.method, username=payload.username or None)
    profile.method = payload.method
    profile.username = payload.username or None
    profile.port = payload.port
    profile.enabled = payload.enabled

    if payload.secret:
        encrypted = encrypt_secret(payload.secret)
        if profile.secret_id:
            secret = db.get(EncryptedSecret, profile.secret_id)
            if secret:
                secret.nonce = encrypted.nonce
                secret.ciphertext = encrypted.ciphertext
                secret.algorithm = encrypted.algorithm
                secret.key_ref = encrypted.key_ref
                db.add(secret)
            else:
                profile.secret_id = None
        if not profile.secret_id:
            secret = EncryptedSecret(
                cloud_account_id=None,
                name=f"asset_access:{asset.id}",
                nonce=encrypted.nonce,
                ciphertext=encrypted.ciphertext,
                algorithm=encrypted.algorithm,
                key_ref=encrypted.key_ref,
            )
            db.add(secret)
            db.flush()
            profile.secret_id = secret.id
    elif payload.clear_secret and profile.secret_id:
        secret = db.get(EncryptedSecret, profile.secret_id)
        profile.secret_id = None
        if secret:
            db.delete(secret)

    db.add(asset)
    db.add(profile)
    db.add(
        AuditLog(
            action="server_access_profile.upsert",
            resource_type="asset",
            resource_id=str(asset.id),
            metadata_json={"method": payload.method, "enabled": payload.enabled, "secret_configured": bool(profile.secret_id)},
        )
    )
    db.commit()
    db.refresh(asset)
    return _server_access_profile_read(db, asset)


@router.post("/assets/{asset_id}/access-profile/secret/reveal", response_model=ServerAccessSecretReveal)
def reveal_access_profile_secret(asset_id: int, db: DbSession) -> ServerAccessSecretReveal:
    asset = _get_asset_or_404(db, asset_id)
    profile = db.scalar(select(ServerAccessProfile).where(ServerAccessProfile.asset_id == asset.id))
    if not profile or profile.method not in {"ssh_password", "ssh_key"}:
        raise HTTPException(status_code=400, detail="SSH password or private key is not configured for this asset")
    if not profile.secret_id:
        raise HTTPException(status_code=404, detail="SSH password or private key is not configured for this asset")
    secret = db.get(EncryptedSecret, profile.secret_id)
    if not secret:
        raise HTTPException(status_code=404, detail="SSH password or private key is not configured for this asset")

    value = decrypt_secret(secret.nonce, secret.ciphertext)
    db.add(
        AuditLog(
            action="server_access_profile.secret_reveal",
            resource_type="asset",
            resource_id=str(asset.id),
            metadata_json={"profile_id": profile.id, "method": profile.method},
        )
    )
    db.commit()
    return ServerAccessSecretReveal(secret=value, method=profile.method)


@router.get("/assets/{asset_id}/bt-panel", response_model=BtPanelProfileRead)
def get_bt_panel_profile(asset_id: int, db: DbSession) -> BtPanelProfileRead:
    asset = _get_asset_or_404(db, asset_id)
    return _bt_panel_profile_read(db, asset)


@router.put("/assets/{asset_id}/bt-panel", response_model=BtPanelProfileRead)
def upsert_bt_panel_profile(asset_id: int, payload: BtPanelProfileUpdate, db: DbSession) -> BtPanelProfileRead:
    asset = _get_asset_or_404(db, asset_id)
    metadata = dict(asset.metadata_json or {})
    bt_panel = dict(metadata.get("bt_panel")) if isinstance(metadata.get("bt_panel"), dict) else {}
    bt_panel["url"] = payload.url or ""
    bt_panel["username"] = payload.username or ""
    bt_panel["enabled"] = payload.enabled
    bt_panel["notes"] = payload.notes or ""
    metadata["bt_panel"] = bt_panel
    asset.metadata_json = metadata

    secret = _bt_panel_secret(db, asset.id)
    if payload.password:
        encrypted = encrypt_secret(payload.password)
        if secret:
            secret.nonce = encrypted.nonce
            secret.ciphertext = encrypted.ciphertext
            secret.algorithm = encrypted.algorithm
            secret.key_ref = encrypted.key_ref
            db.add(secret)
        else:
            secret = EncryptedSecret(
                cloud_account_id=None,
                name=_bt_panel_secret_name(asset.id),
                nonce=encrypted.nonce,
                ciphertext=encrypted.ciphertext,
                algorithm=encrypted.algorithm,
                key_ref=encrypted.key_ref,
            )
            db.add(secret)
    elif payload.clear_password:
        _delete_bt_panel_secrets(db, asset.id)
        secret = None

    db.add(asset)
    db.add(
        AuditLog(
            action="asset.bt_panel.upsert",
            resource_type="asset",
            resource_id=str(asset.id),
            metadata_json={"enabled": payload.enabled, "password_configured": bool(secret)},
        )
    )
    db.commit()
    db.refresh(asset)
    return _bt_panel_profile_read(db, asset)


@router.post("/assets/{asset_id}/bt-panel/password/reveal", response_model=BtPanelPasswordReveal)
def reveal_bt_panel_password(asset_id: int, db: DbSession) -> BtPanelPasswordReveal:
    asset = _get_asset_or_404(db, asset_id)
    secret = _bt_panel_secret(db, asset.id)
    if not secret:
        raise HTTPException(status_code=404, detail="BT panel password is not configured")
    password = decrypt_secret(secret.nonce, secret.ciphertext)
    db.add(
        AuditLog(
            action="asset.bt_panel.password_reveal",
            resource_type="asset",
            resource_id=str(asset.id),
            metadata_json={"revealed": True},
        )
    )
    db.commit()
    return BtPanelPasswordReveal(password=password)


@router.post("/assets/{asset_id}/runtime/collect")
def collect_asset_runtime(asset_id: int, db: DbSession) -> dict:
    asset = _get_asset_or_404(db, asset_id)
    if asset.type not in {"ecs", "swas", "server"}:
        raise HTTPException(status_code=400, detail="Runtime collection is only available for server assets.")

    results: list[dict] = []
    for target in ("df -h", "free -m"):
        check = _runtime_check_for_asset(db, asset, target)
        result = execute_check(db, check)
        results.append(_check_result_payload(result))

    db.refresh(asset)
    metrics = _runtime_metrics_for_assets(db, [asset.id]).get(asset.id, {})
    quality = _data_quality_for_assets(db, [asset], {asset.id: metrics})
    return {"asset": _asset_read(asset, metrics, quality.get(asset.id, {})), "results": results}


@router.get("/monitor-groups", response_model=list[MonitorGroupRead])
def list_monitor_groups(db: DbSession) -> list[dict]:
    groups = list(db.scalars(select(MonitorGroup).order_by(MonitorGroup.type, MonitorGroup.name)).all())
    return [_monitor_group_read(db, group) for group in groups]


@router.post("/monitor-groups", response_model=MonitorGroupRead)
def create_monitor_group(payload: MonitorGroupCreate, db: DbSession) -> dict:
    group = MonitorGroup(name=payload.name.strip(), type=payload.type, description=payload.description.strip(), status="active")
    db.add(group)
    db.flush()
    _replace_monitor_group_assets(db, group, payload.asset_ids)
    db.add(AuditLog(action="monitor_group.create", resource_type="monitor_group", resource_id=str(group.id), metadata_json={"name": group.name, "type": group.type}))
    db.commit()
    db.refresh(group)
    return _monitor_group_read(db, group)


@router.patch("/monitor-groups/{group_id}", response_model=MonitorGroupRead)
def update_monitor_group(group_id: int, payload: MonitorGroupUpdate, db: DbSession) -> dict:
    group = db.get(MonitorGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Monitor group not found")
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is not None:
        group.name = changes["name"].strip()
    if "type" in changes and changes["type"] is not None:
        group.type = changes["type"]
    if "description" in changes and changes["description"] is not None:
        group.description = changes["description"].strip()
    if "asset_ids" in changes and changes["asset_ids"] is not None:
        _replace_monitor_group_assets(db, group, changes["asset_ids"])
    db.add(group)
    db.add(AuditLog(action="monitor_group.update", resource_type="monitor_group", resource_id=str(group.id), metadata_json=changes))
    db.commit()
    db.refresh(group)
    return _monitor_group_read(db, group)


@router.delete("/monitor-groups/{group_id}")
def delete_monitor_group(group_id: int, db: DbSession) -> dict:
    group = db.get(MonitorGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Monitor group not found")
    db.execute(update(Check).where(Check.group_id == group.id).values(group_id=None))
    db.delete(group)
    db.add(AuditLog(action="monitor_group.delete", resource_type="monitor_group", resource_id=str(group.id), metadata_json={"name": group.name}))
    db.commit()
    return {"deleted": True, "id": group_id}


@router.post("/assets/{asset_id}/checks/defaults", response_model=list[CheckRead])
def create_default_checks(asset_id: int, db: DbSession) -> list[dict]:
    asset = _get_asset_or_404(db, asset_id)
    group = _monitor_group_for_asset(db, asset)
    checks: list[Check] = []
    created = 0
    for spec in _default_check_specs(asset):
        check, was_created = _get_or_create_check(db, asset, spec, group)
        checks.append(check)
        if was_created:
            created += 1
    db.add(
        AuditLog(
            action="check.create_defaults",
            resource_type="asset",
            resource_id=str(asset.id),
            metadata_json={"created": created, "total": len(checks)},
        )
    )
    db.commit()
    return [_check_read(db, check) for check in checks]


@router.post("/checks", response_model=CheckRead)
def create_check(payload: CheckCreate, db: DbSession) -> dict:
    data = payload.model_dump()
    asset = _get_asset_or_404(db, payload.asset_id) if payload.asset_id else None
    group = db.get(MonitorGroup, payload.group_id) if payload.group_id else None
    if payload.group_id and not group:
        raise HTTPException(status_code=404, detail="Monitor group not found")
    if asset and group:
        _ensure_monitor_group_asset(db, group, asset)
    if asset and not group:
        group = _monitor_group_for_asset(db, asset)
        data["group_id"] = group.id
    check = Check(**data)
    db.add(check)
    db.add(AuditLog(action="check.create", resource_type="check", resource_id="pending", metadata_json={"name": payload.name, "type": payload.type}))
    db.commit()
    db.refresh(check)
    return _check_read(db, check)


@router.get("/checks", response_model=list[CheckRead])
def list_checks(db: DbSession) -> list[dict]:
    checks = list(db.scalars(select(Check).order_by(desc(Check.created_at))).all())
    return [_check_read(db, check) for check in checks]


@router.delete("/checks")
def delete_all_checks(db: DbSession) -> dict:
    check_ids = list(db.scalars(select(Check.id)).all())
    if not check_ids:
        return {"deleted": 0, "results_deleted": 0}

    result_ids = list(db.scalars(select(CheckResult.id).where(CheckResult.check_id.in_(check_ids))).all())
    db.execute(update(Alert).where(Alert.check_id.in_(check_ids)).values(check_id=None, last_result_id=None))
    if result_ids:
        db.execute(update(Alert).where(Alert.last_result_id.in_(result_ids)).values(last_result_id=None))
    db.execute(delete(AlertRule).where(AlertRule.check_id.in_(check_ids)))
    db.execute(delete(CheckResult).where(CheckResult.check_id.in_(check_ids)))
    db.execute(delete(Check).where(Check.id.in_(check_ids)))
    db.add(AuditLog(action="check.delete_all", resource_type="check", resource_id="all", metadata_json={"count": len(check_ids)}))
    db.commit()
    return {"deleted": len(check_ids), "results_deleted": len(result_ids)}


@router.patch("/checks/{check_id}", response_model=CheckRead)
def update_check(check_id: int, payload: CheckUpdate, db: DbSession) -> dict:
    check = db.get(Check, check_id)
    if not check:
        raise HTTPException(status_code=404, detail="Check not found")
    changes = payload.model_dump(exclude_unset=True)
    if "group_id" in changes and changes["group_id"] is not None:
        group = db.get(MonitorGroup, changes["group_id"])
        if not group:
            raise HTTPException(status_code=404, detail="Monitor group not found")
        asset = db.get(Asset, check.asset_id) if check.asset_id else None
        if asset:
            _ensure_monitor_group_asset(db, group, asset)
    for key, value in changes.items():
        setattr(check, key, value)
    db.add(check)
    db.add(AuditLog(action="check.update", resource_type="check", resource_id=str(check.id), metadata_json=changes))
    db.commit()
    db.refresh(check)
    return _check_read(db, check)


@router.post("/checks/{check_id}/run", response_model=CheckResultRead)
def run_check(check_id: int, db: DbSession) -> CheckResult:
    check = db.get(Check, check_id)
    if not check:
        raise HTTPException(status_code=404, detail="Check not found")
    return execute_check(db, check)


@router.delete("/checks/{check_id}")
def delete_check(check_id: int, db: DbSession) -> dict:
    check = db.get(Check, check_id)
    if not check:
        raise HTTPException(status_code=404, detail="Check not found")

    result_ids = list(db.scalars(select(CheckResult.id).where(CheckResult.check_id == check.id)).all())
    db.execute(update(Alert).where(Alert.check_id == check.id).values(check_id=None, last_result_id=None))
    if result_ids:
        db.execute(update(Alert).where(Alert.last_result_id.in_(result_ids)).values(last_result_id=None))
    db.execute(delete(AlertRule).where(AlertRule.check_id == check.id))
    db.delete(check)
    db.add(AuditLog(action="check.delete", resource_type="check", resource_id=str(check.id), metadata_json={"name": check.name, "type": check.type}))
    db.commit()
    return {"deleted": True, "id": check_id}


@router.get("/check-results", response_model=list[CheckResultRead])
def list_check_results(
    db: DbSession,
    check_id: int | None = Query(default=None),
    asset_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
) -> list[CheckResult]:
    stmt = select(CheckResult).order_by(desc(CheckResult.checked_at)).limit(limit)
    if check_id:
        stmt = stmt.where(CheckResult.check_id == check_id)
    if asset_id:
        stmt = stmt.where(CheckResult.asset_id == asset_id)
    return list(db.scalars(stmt).all())


@router.get("/alerts", response_model=list[AlertRead])
def list_alerts(db: DbSession, status: str | None = Query(default=None)) -> list[Alert]:
    stmt = select(Alert).order_by(desc(Alert.updated_at))
    if status:
        stmt = stmt.where(Alert.status == status)
    return list(db.scalars(stmt).all())


@router.patch("/alerts/{alert_id}", response_model=AlertRead)
def update_alert(alert_id: int, payload: AlertUpdate, db: DbSession) -> Alert:
    alert = db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.status = payload.status
    if payload.status == "acknowledged":
        alert.acknowledged_at = datetime.now(timezone.utc)
    if payload.status == "closed":
        alert.closed_at = datetime.now(timezone.utc)
    db.add(alert)
    db.add(AuditLog(action=f"alert.{payload.status}", resource_type="alert", resource_id=str(alert.id), metadata_json={}))
    db.commit()
    db.refresh(alert)
    return alert


@router.post("/diagnoses", response_model=DiagnosisRead)
def create_diagnosis(payload: DiagnosisRequest, db: DbSession):
    if not payload.alert_id and not payload.asset_id:
        raise HTTPException(status_code=400, detail="alert_id or asset_id is required")
    return generate_diagnosis(db, payload.alert_id, payload.asset_id, payload.locale)


def _monitor_group_type_for_asset(asset: Asset) -> str:
    if asset.type in {"ecs", "swas", "server"}:
        return "server"
    if asset.type in {"domain", "dns", "oss"}:
        return asset.type
    return "custom"


def _ensure_monitor_group_asset(db: DbSession, group: MonitorGroup, asset: Asset) -> None:
    existing = db.scalar(
        select(MonitorGroupAsset).where(MonitorGroupAsset.group_id == group.id, MonitorGroupAsset.asset_id == asset.id)
    )
    if existing:
        return
    db.add(MonitorGroupAsset(group_id=group.id, asset_id=asset.id, role="primary"))
    db.flush()


def _replace_monitor_group_assets(db: DbSession, group: MonitorGroup, asset_ids: list[int]) -> None:
    unique_asset_ids = list(dict.fromkeys(asset_ids))
    if unique_asset_ids:
        existing_ids = set(db.scalars(select(Asset.id).where(Asset.id.in_(unique_asset_ids))).all())
        missing_ids = [asset_id for asset_id in unique_asset_ids if asset_id not in existing_ids]
        if missing_ids:
            raise HTTPException(status_code=404, detail=f"Assets not found: {missing_ids}")
    db.execute(delete(MonitorGroupAsset).where(MonitorGroupAsset.group_id == group.id))
    for asset_id in unique_asset_ids:
        db.add(MonitorGroupAsset(group_id=group.id, asset_id=asset_id, role="primary"))
    db.flush()


def _monitor_group_for_asset(db: DbSession, asset: Asset) -> MonitorGroup:
    group_type = _monitor_group_type_for_asset(asset)
    group = db.scalar(
        select(MonitorGroup)
        .join(MonitorGroupAsset, MonitorGroupAsset.group_id == MonitorGroup.id)
        .where(MonitorGroupAsset.asset_id == asset.id, MonitorGroup.type == group_type)
        .order_by(MonitorGroup.id)
    )
    if group:
        return group
    group = MonitorGroup(name=asset.name, type=group_type, description=f"Default group for {asset.external_id}", status="active")
    db.add(group)
    db.flush()
    _ensure_monitor_group_asset(db, group, asset)
    return group


def _monitor_group_read(db: DbSession, group: MonitorGroup) -> dict:
    asset_ids = list(db.scalars(select(MonitorGroupAsset.asset_id).where(MonitorGroupAsset.group_id == group.id)).all())
    checks = list(db.scalars(select(Check).where(Check.group_id == group.id)).all())
    check_ids = [check.id for check in checks]
    latest_by_check: dict[int, CheckResult] = {}
    if check_ids:
        rows = list(
            db.scalars(
                select(CheckResult)
                .where(CheckResult.check_id.in_(check_ids))
                .order_by(desc(CheckResult.checked_at))
            ).all()
        )
        for result in rows:
            latest_by_check.setdefault(result.check_id, result)
    failing_count = sum(1 for result in latest_by_check.values() if result.status == "failed")
    last_checked_at = max((result.checked_at for result in latest_by_check.values()), default=None)
    return {
        "id": group.id,
        "name": group.name,
        "type": group.type,
        "description": group.description,
        "status": group.status,
        "asset_ids": asset_ids,
        "asset_count": len(asset_ids),
        "check_count": len(checks),
        "failing_count": failing_count,
        "last_checked_at": last_checked_at,
    }


def _default_check_specs(asset: Asset) -> list[dict]:
    host = _default_asset_host(asset)
    specs: list[dict] = []
    if asset.type in {"ecs", "swas", "server"}:
        if host:
            specs.extend(
                [
                    {
                        "name": f"{asset.name} SSH reachability",
                        "type": "ssh",
                        "target": f"{host}:22",
                        "interval_seconds": 300,
                        "timeout_seconds": 5,
                        "threshold": None,
                        "failure_threshold": 2,
                        "config_json": {},
                    },
                    {
                        "name": f"{asset.name} TCP 22",
                        "type": "tcp",
                        "target": f"{host}:22",
                        "interval_seconds": 300,
                        "timeout_seconds": 5,
                        "threshold": None,
                        "failure_threshold": 2,
                        "config_json": {},
                    },
                ]
            )
        runtime_config = {"region": asset.region}
        if asset.type == "ecs":
            runtime_config["instance_id"] = asset.external_id
        specs.extend(
            [
                {
                    "name": f"{asset.name} disk usage",
                    "type": "cloud_assistant",
                    "target": "df -h",
                    "interval_seconds": 300,
                    "timeout_seconds": 10,
                    "threshold": 90,
                    "failure_threshold": 1,
                    "config_json": runtime_config,
                },
                {
                    "name": f"{asset.name} memory usage",
                    "type": "cloud_assistant",
                    "target": "free -m",
                    "interval_seconds": 300,
                    "timeout_seconds": 10,
                    "threshold": 90,
                    "failure_threshold": 1,
                    "config_json": runtime_config,
                },
            ]
        )
        return specs
    if asset.type in {"domain", "dns"}:
        domain = asset.name.strip()
        if domain:
            specs.append(
                {
                    "name": f"{asset.name} HTTPS health",
                    "type": "http",
                    "target": f"https://{domain}",
                    "interval_seconds": 300,
                    "timeout_seconds": 8,
                    "threshold": None,
                    "failure_threshold": 2,
                    "config_json": {},
                }
            )
    if asset.type == "oss":
        endpoint = _metadata_text(asset.metadata_json or {}, ["extranet_endpoint", "endpoint", "bucket_endpoint"])
        if not endpoint and asset.region and asset.region != "global":
            endpoint = f"https://{asset.name}.oss-{asset.region}.aliyuncs.com"
        if endpoint:
            if not endpoint.startswith(("http://", "https://")):
                endpoint = f"https://{endpoint}"
            specs.append(
                {
                    "name": f"{asset.name} bucket endpoint",
                    "type": "http",
                    "target": endpoint,
                    "interval_seconds": 600,
                    "timeout_seconds": 8,
                    "threshold": None,
                    "failure_threshold": 2,
                    "config_json": {"purpose": "oss_endpoint_probe"},
                }
            )
    return specs


def _get_or_create_check(db: DbSession, asset: Asset, spec: dict, group: MonitorGroup | None = None) -> tuple[Check, bool]:
    check = db.scalar(
        select(Check).where(
            Check.asset_id == asset.id,
            Check.type == spec["type"],
            Check.target == spec["target"],
        )
    )
    if check:
        if group and check.group_id != group.id:
            check.group_id = group.id
            db.add(check)
            db.flush()
        return check, False
    check = Check(asset_id=asset.id, group_id=group.id if group else None, **spec)
    db.add(check)
    db.flush()
    return check, True


def _asset_read(asset: Asset, runtime_metrics: dict | None = None, data_quality: dict | None = None) -> dict:
    return {
        "id": asset.id,
        "cloud_account_id": asset.cloud_account_id,
        "provider": asset.provider,
        "type": asset.type,
        "name": asset.name,
        "external_id": asset.external_id,
        "region": asset.region,
        "status": asset.status,
        "metadata_json": asset.metadata_json or {},
        "runtime_metrics": runtime_metrics or {},
        "data_quality": data_quality or {},
        "last_seen_at": asset.last_seen_at,
    }


def _data_quality_for_assets(db: DbSession, assets: list[Asset], metrics_by_asset: dict[int, dict]) -> dict[int, dict]:
    if not assets:
        return {}
    asset_ids = [asset.id for asset in assets]
    profiles = {
        profile.asset_id: profile
        for profile in db.scalars(select(ServerAccessProfile).where(ServerAccessProfile.asset_id.in_(asset_ids))).all()
    }
    checks = list(db.scalars(select(Check).where(Check.asset_id.in_(asset_ids))).all())
    checks_by_asset: dict[int, list[Check]] = {}
    for check in checks:
        if check.asset_id is not None:
            checks_by_asset.setdefault(check.asset_id, []).append(check)

    latest_result_by_asset: dict[int, tuple[CheckResult, Check]] = {}
    latest_runtime_by_asset: dict[int, tuple[CheckResult, Check]] = {}
    result_rows = (
        db.execute(
            select(CheckResult, Check)
            .join(Check, CheckResult.check_id == Check.id)
            .where(CheckResult.asset_id.in_(asset_ids))
            .order_by(desc(CheckResult.checked_at))
            .limit(2000)
        )
        .all()
    )
    for result, check in result_rows:
        if result.asset_id is None:
            continue
        latest_result_by_asset.setdefault(result.asset_id, (result, check))
        if _metric_key_for_result(check):
            latest_runtime_by_asset.setdefault(result.asset_id, (result, check))

    quality_by_asset: dict[int, dict] = {}
    for asset in assets:
        metadata = dict(asset.metadata_json or {})
        ops = metadata.get("ops") if isinstance(metadata.get("ops"), dict) else {}
        profile = profiles.get(asset.id)
        profile_secret_configured = bool(profile and profile.secret_id and db.get(EncryptedSecret, profile.secret_id))
        metrics = metrics_by_asset.get(asset.id, {})
        has_usage = _asset_has_usage_metrics(metadata, metrics)
        asset_checks = checks_by_asset.get(asset.id, [])
        latest = latest_runtime_by_asset.get(asset.id) or latest_result_by_asset.get(asset.id)
        collection = _collection_status_payload(latest)
        field_sources = {
            "identity": "aliyun_api" if asset.last_seen_at else "local_database",
            "network": "aliyun_api" if _has_any(metadata, ["public_ip", "public_ip_address", "private_ip_address", "inner_ip_address"]) else "missing",
            "spec": "aliyun_api" if _has_any(metadata, ["cpu", "memory", "memory_gb", "disk", "disk_gb", "bandwidth"]) else "missing",
            "renewal": _renewal_source(metadata, ops if isinstance(ops, dict) else {}),
            "entrypoint": "local_profile" if isinstance(ops, dict) and _has_any(ops, ["service_url", "login_url"]) else "derived",
            "usage": _usage_source(metadata, metrics),
            "ssh": "encrypted_local_secret" if profile_secret_configured else ("local_profile" if profile else "missing"),
            "bt_panel": "encrypted_local_secret" if _bt_panel_secret(db, asset.id) else ("local_profile" if isinstance(metadata.get("bt_panel"), dict) else "missing"),
        }
        gaps: list[str] = []
        recommended_actions: list[str] = []
        if asset.type in {"ecs", "swas", "server"}:
            if not profile or not profile.enabled or not profile.username or not profile_secret_configured:
                gaps.append("ssh_access_missing")
                recommended_actions.append("configure_ssh_access")
            if not has_usage:
                gaps.append("runtime_usage_missing")
                recommended_actions.append("collect_runtime")
            if not asset_checks:
                gaps.append("checks_missing")
                recommended_actions.append("create_default_checks")
        elif asset.type in {"domain", "dns", "oss"} and not asset_checks:
            gaps.append("checks_missing")
            recommended_actions.append("create_default_checks")
        if collection["status"] == "failed":
            gaps.append("last_collection_failed")

        quality_by_asset[asset.id] = {
            "field_sources": field_sources,
            "collection": collection,
            "gaps": sorted(set(gaps)),
            "recommended_actions": sorted(set(recommended_actions)),
        }
    return quality_by_asset


def _collection_status_payload(latest: tuple[CheckResult, Check] | None) -> dict:
    if not latest:
        return {"status": "never", "message": "", "checked_at": None, "check_type": "", "target": ""}
    result, check = latest
    return {
        "status": result.status,
        "message": redact_text(result.message),
        "checked_at": result.checked_at.isoformat(),
        "check_type": check.type,
        "target": check.target,
        "value": result.value,
        "latency_ms": result.latency_ms,
    }


def _asset_has_usage_metrics(metadata: dict, metrics: dict) -> bool:
    return _number_or_none(metrics.get("disk_used_percent")) is not None or _number_or_none(metrics.get("memory_used_percent")) is not None or _number_or_none(metadata.get("disk_used_percent")) is not None or _number_or_none(metadata.get("memory_used_percent")) is not None


def _usage_source(metadata: dict, metrics: dict) -> str:
    disk_source = metrics.get("disk_used_percent_source")
    memory_source = metrics.get("memory_used_percent_source")
    if disk_source or memory_source:
        return "runtime_check" if "asset_metadata" not in {disk_source, memory_source} else "aliyun_api"
    if _number_or_none(metadata.get("disk_used_percent")) is not None or _number_or_none(metadata.get("memory_used_percent")) is not None:
        return "aliyun_api"
    return "missing"


def _renewal_source(metadata: dict, ops: dict) -> str:
    if _has_any(
        metadata,
        [
            "expires_at",
            "expired_time",
            "expiration_date",
            "auto_renew_enabled",
            "renew_status",
            "billing_end_time",
            "billing_product_code",
        ],
    ):
        return "aliyun_api"
    if _has_any(ops, ["renewal_expires_at", "renewal_auto_renew", "renewal_notes"]):
        return "local_profile"
    return "missing"


def _has_any(values: dict, keys: list[str]) -> bool:
    for key in keys:
        value = values.get(key)
        if value not in (None, "", [], {}):
            return True
    return False


def _runtime_metrics_for_assets(db: DbSession, asset_ids: list[int]) -> dict[int, dict]:
    if not asset_ids:
        return {}
    assets = list(db.scalars(select(Asset).where(Asset.id.in_(asset_ids))).all())
    metrics = {asset.id: _runtime_metrics_from_metadata(asset.metadata_json or {}) for asset in assets}
    stmt = (
        select(CheckResult, Check)
        .join(Check, CheckResult.check_id == Check.id)
        .where(CheckResult.asset_id.in_(asset_ids))
        .order_by(desc(CheckResult.checked_at))
        .limit(2000)
    )
    for result, check in db.execute(stmt).all():
        if result.asset_id is None or result.value is None:
            continue
        metric_key = _metric_key_for_result(check)
        if not metric_key:
            continue
        asset_metrics = metrics.setdefault(result.asset_id, {})
        if metric_key in asset_metrics and asset_metrics.get(f"{metric_key}_checked_at"):
            continue
        asset_metrics[metric_key] = round(float(result.value), 2)
        asset_metrics[f"{metric_key}_checked_at"] = result.checked_at.isoformat()
        asset_metrics[f"{metric_key}_status"] = result.status
        asset_metrics[f"{metric_key}_source"] = check.type
    return metrics


def _runtime_metrics_from_metadata(metadata: dict) -> dict:
    metrics: dict = {}
    for key in ("disk_used_percent", "memory_used_percent", "cpu_used_percent", "cpu_total"):
        value = metadata.get(key)
        if isinstance(value, (int, float)):
            normalized_key = "cpu_used_percent" if key == "cpu_total" else key
            metrics[normalized_key] = round(float(value), 2)
            metrics[f"{normalized_key}_source"] = "asset_metadata"
    return metrics


def _runtime_check_for_asset(db: DbSession, asset: Asset, target: str) -> Check:
    group = _monitor_group_for_asset(db, asset)
    check = db.scalar(select(Check).where(Check.asset_id == asset.id, Check.type == "cloud_assistant", Check.target == target))
    if check:
        if check.group_id != group.id:
            check.group_id = group.id
            db.add(check)
            db.commit()
            db.refresh(check)
        return check
    label = "disk usage" if target.startswith("df ") else "memory usage"
    config_json: dict = {}
    if asset.type == "ecs":
        config_json = {"instance_id": asset.external_id, "region": asset.region}
    check = Check(
        asset_id=asset.id,
        group_id=group.id,
        name=f"{asset.name} {label}",
        type="cloud_assistant",
        target=target,
        interval_seconds=300,
        timeout_seconds=10,
        threshold=90,
        failure_threshold=1,
        enabled=True,
        config_json=config_json,
    )
    db.add(check)
    db.add(AuditLog(action="check.create.runtime", resource_type="asset", resource_id=str(asset.id), metadata_json={"target": target}))
    db.commit()
    db.refresh(check)
    return check


def _check_result_payload(result: CheckResult) -> dict:
    return {
        "id": result.id,
        "check_id": result.check_id,
        "asset_id": result.asset_id,
        "status": result.status,
        "latency_ms": result.latency_ms,
        "value": result.value,
        "message": result.message,
        "details_json": result.details_json,
        "checked_at": result.checked_at.isoformat(),
    }


def _check_read(db: DbSession, check: Check) -> dict:
    asset = db.get(Asset, check.asset_id) if check.asset_id else None
    group = db.get(MonitorGroup, check.group_id) if check.group_id else None
    latest_result = db.scalar(
        select(CheckResult).where(CheckResult.check_id == check.id).order_by(desc(CheckResult.checked_at))
    )
    open_alert = db.scalar(
        select(Alert)
        .where(Alert.check_id == check.id, Alert.status.in_(["open", "acknowledged"]))
        .order_by(desc(Alert.updated_at))
    )
    result_count = db.scalar(select(func.count()).select_from(CheckResult).where(CheckResult.check_id == check.id)) or 0
    return {
        "id": check.id,
        "asset_id": check.asset_id,
        "group_id": check.group_id,
        "name": check.name,
        "type": check.type,
        "target": check.target,
        "interval_seconds": check.interval_seconds,
        "timeout_seconds": check.timeout_seconds,
        "threshold": check.threshold,
        "failure_threshold": check.failure_threshold,
        "enabled": check.enabled,
        "config_json": check.config_json or {},
        "asset_name": asset.name if asset else None,
        "asset_type": asset.type if asset else None,
        "asset_region": asset.region if asset else None,
        "group_name": group.name if group else None,
        "group_type": group.type if group else None,
        "last_status": latest_result.status if latest_result else None,
        "last_message": latest_result.message if latest_result else None,
        "last_value": latest_result.value if latest_result else None,
        "last_latency_ms": latest_result.latency_ms if latest_result else None,
        "last_checked_at": latest_result.checked_at if latest_result else None,
        "open_alert_id": open_alert.id if open_alert else None,
        "open_alert_status": open_alert.status if open_alert else None,
        "result_count": result_count,
    }


def _metric_key_for_result(check: Check) -> str:
    target = " ".join((check.target or "").strip().split())
    if check.type == "cloud_assistant":
        if target.startswith("df "):
            return "disk_used_percent"
        if target.startswith("free "):
            return "memory_used_percent"
    if check.type == "ecs_metric":
        if target in {"disk_used_percent", "diskusage_utilization"}:
            return "disk_used_percent"
        if target in {"memory_used_percent", "memory_usedutilization"}:
            return "memory_used_percent"
        if target in {"cpu_used_percent", "cpu_total", "CPUUtilization"}:
            return "cpu_used_percent"
    return ""


def _get_asset_or_404(db: DbSession, asset_id: int) -> Asset:
    asset = db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


def _merge_synced_metadata(incoming: dict, existing: dict) -> dict:
    if not existing:
        return incoming
    if "access_profile" in existing:
        incoming["access_profile"] = existing["access_profile"]
    if "bt_panel" in existing:
        incoming["bt_panel"] = existing["bt_panel"]

    incoming_ops = incoming.get("ops") if isinstance(incoming.get("ops"), dict) else {}
    existing_ops = existing.get("ops") if isinstance(existing.get("ops"), dict) else {}
    merged_ops = dict(incoming_ops)
    for key, value in existing_ops.items():
        if key == "service_url" and _is_generated_public_ip_service_url(value, incoming):
            continue
        if value not in (None, "", []):
            merged_ops[key] = value
        elif key not in merged_ops:
            merged_ops[key] = value
    if merged_ops:
        incoming["ops"] = merged_ops
    return incoming


def _is_generated_public_ip_service_url(value: object, incoming: dict) -> bool:
    if not isinstance(value, str) or not value:
        return False
    public_ip = incoming.get("public_ip_address") or incoming.get("public_ip")
    if not public_ip:
        return False
    normalized = value.rstrip("/")
    return normalized in {f"http://{public_ip}", f"https://{public_ip}"}


def _bt_panel_secret_name(asset_id: int) -> str:
    return f"bt_panel:{asset_id}:password"


def _bt_panel_secret(db: DbSession, asset_id: int) -> EncryptedSecret | None:
    return db.scalar(
        select(EncryptedSecret)
        .where(EncryptedSecret.cloud_account_id.is_(None), EncryptedSecret.name == _bt_panel_secret_name(asset_id))
        .order_by(desc(EncryptedSecret.id))
    )


def _delete_bt_panel_secrets(db: DbSession, asset_id: int) -> None:
    db.execute(delete(EncryptedSecret).where(EncryptedSecret.cloud_account_id.is_(None), EncryptedSecret.name == _bt_panel_secret_name(asset_id)))


def _bt_panel_profile_read(db: DbSession, asset: Asset) -> BtPanelProfileRead:
    metadata = dict(asset.metadata_json or {})
    bt_panel = dict(metadata.get("bt_panel")) if isinstance(metadata.get("bt_panel"), dict) else {}
    return BtPanelProfileRead(
        asset_id=asset.id,
        url=bt_panel.get("url") or "",
        username=bt_panel.get("username") or "",
        enabled=bt_panel.get("enabled") if isinstance(bt_panel.get("enabled"), bool) else True,
        password_configured=_bt_panel_secret(db, asset.id) is not None,
        notes=bt_panel.get("notes") or "",
    )


def _server_access_profile_read(db: DbSession, asset: Asset) -> ServerAccessProfileRead:
    profile = db.scalar(select(ServerAccessProfile).where(ServerAccessProfile.asset_id == asset.id))
    metadata = dict(asset.metadata_json or {})
    existing_access_metadata = metadata.get("access_profile")
    access_metadata = dict(existing_access_metadata) if isinstance(existing_access_metadata, dict) else {}
    secret_configured = False
    if profile and profile.secret_id:
        secret_configured = db.get(EncryptedSecret, profile.secret_id) is not None
    return ServerAccessProfileRead(
        asset_id=asset.id,
        method=profile.method if profile else "cloud_assistant",
        host=access_metadata.get("host") or _default_asset_host(asset),
        username=(profile.username or "") if profile else "",
        port=profile.port if profile else 22,
        enabled=profile.enabled if profile else True,
        secret_configured=secret_configured,
        notes=access_metadata.get("notes") or "",
    )


def _default_asset_host(asset: Asset) -> str:
    metadata = dict(asset.metadata_json or {})
    for key in ("public_ip", "public_ip_address", "ip_address", "internet_ip", "eip_address"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, list) and value and isinstance(value[0], str):
            return value[0].strip()
    return ""


def _metadata_text(metadata: dict, keys: list[str]) -> str:
    for key in keys:
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, list):
            first = next((item.strip() for item in value if isinstance(item, str) and item.strip()), "")
            if first:
                return first
    return ""


def _credentials_for_account(db: DbSession, account: CloudAccount | None) -> AliyunCredentials | None:
    if not account:
        return None
    secrets = db.scalars(select(EncryptedSecret).where(EncryptedSecret.cloud_account_id == account.id)).all()
    secret_map = {secret.name: decrypt_secret(secret.nonce, secret.ciphertext) for secret in secrets}
    return AliyunCredentials(
        access_key_id=secret_map.get("access_key_id", "").strip(),
        access_key_secret=secret_map.get("access_key_secret", "").strip(),
        region=account.default_region.strip(),
    )
