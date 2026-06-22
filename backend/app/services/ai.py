import json
from typing import Any

import httpx
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.core.security import redact_obj, redact_text
from app.models import AiDiagnosis, Alert, Asset, CheckResult
from app.services.ai_config import get_ai_runtime_config


DEFAULT_COMMANDS_EN = [
    {"command": "df -h", "reason": "Check disk pressure on Linux servers."},
    {"command": "free -m", "reason": "Check memory pressure on Linux servers."},
    {"command": "ss -lntp", "reason": "Confirm listening ports."},
    {"command": "systemctl status <service>", "reason": "Check service runtime status after identifying the service name."},
]

DEFAULT_COMMANDS_ZH = [
    {"command": "df -h", "reason": "检查 Linux 服务器磁盘使用率。"},
    {"command": "free -m", "reason": "检查 Linux 服务器内存压力。"},
    {"command": "ss -lntp", "reason": "确认服务监听端口。"},
    {"command": "systemctl status <service>", "reason": "确认具体服务的运行状态。"},
]


def build_diagnosis_context(db: Session, alert_id: int | None, asset_id: int | None) -> dict[str, Any]:
    alert = db.get(Alert, alert_id) if alert_id else None
    asset = db.get(Asset, asset_id or (alert.asset_id if alert else None)) if (asset_id or (alert and alert.asset_id)) else None
    recent_results = []
    if alert and alert.check_id:
        recent_results = db.scalars(select(CheckResult).where(CheckResult.check_id == alert.check_id).order_by(desc(CheckResult.checked_at)).limit(5)).all()
    context = {
        "alert": {
            "id": alert.id,
            "title": alert.title,
            "status": alert.status,
            "severity": alert.severity,
            "message": alert.message,
            "failure_count": alert.failure_count,
        }
        if alert
        else None,
        "asset": {
            "id": asset.id,
            "type": asset.type,
            "name": asset.name,
            "region": asset.region,
            "status": asset.status,
            "metadata": asset.metadata_json,
        }
        if asset
        else None,
        "recent_results": [
            {
                "status": item.status,
                "latency_ms": item.latency_ms,
                "value": item.value,
                "message": item.message,
                "checked_at": item.checked_at.isoformat(),
            }
            for item in recent_results
        ],
    }
    return redact_obj(context)


def generate_diagnosis(db: Session, alert_id: int | None, asset_id: int | None, locale: str = "zh") -> AiDiagnosis:
    context = build_diagnosis_context(db, alert_id, asset_id)
    ai_config = get_ai_runtime_config(db)
    ai_result = _call_ai_if_configured(ai_config.base_url, ai_config.api_key, ai_config.model, context, locale)
    if ai_result is None:
        ai_result = _rule_based_diagnosis(context, locale)

    diagnosis = AiDiagnosis(
        alert_id=alert_id,
        asset_id=asset_id or (context.get("asset") or {}).get("id"),
        summary=ai_result["summary"],
        root_causes=ai_result["root_causes"],
        steps=ai_result["steps"],
        commands=ai_result["commands"],
        context_json=context,
        model=ai_result["model"],
    )
    db.add(diagnosis)
    db.commit()
    db.refresh(diagnosis)
    return diagnosis


def build_prompt(context: dict[str, Any], locale: str = "zh") -> str:
    safe_context = redact_obj(context)
    language = "Simplified Chinese" if locale == "zh" else "English"
    return redact_text(
        "You are an SRE assistant for a local Alibaba Cloud operations tool. "
        f"Do not execute commands. Return JSON with summary, root_causes, steps, commands in {language}. "
        f"Context: {json.dumps(safe_context, ensure_ascii=False)}"
    )


def _call_ai_if_configured(base_url: str, api_key: str, model: str, context: dict[str, Any], locale: str) -> dict[str, Any] | None:
    if not base_url or not api_key:
        return None
    prompt = build_prompt(context, locale)
    try:
        response = httpx.post(
            base_url.rstrip("/") + "/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "Return concise JSON only."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
            },
            timeout=20.0,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        return {
            "summary": redact_text(parsed.get("summary", "AI diagnosis generated.")),
            "root_causes": redact_obj(parsed.get("root_causes", [])),
            "steps": redact_obj(parsed.get("steps", [])),
            "commands": _sanitize_commands(parsed.get("commands", _default_commands(locale)), locale),
            "model": model,
        }
    except Exception:
        return None


def _rule_based_diagnosis(context: dict[str, Any], locale: str) -> dict[str, Any]:
    alert = context.get("alert") or {}
    asset = context.get("asset") or {}
    metadata = asset.get("metadata") or {}
    root_causes = []
    if locale == "zh":
        subject = _localized_subject(alert.get("title") or asset.get("name") or "资产", locale)
        if metadata.get("disk_used_percent", 0) >= 90:
            root_causes.append("磁盘使用率超过 90%，可能导致部署、日志写入或数据库写入失败。")
        if metadata.get("memory_used_percent", 0) >= 80:
            root_causes.append("内存压力偏高，需要检查进程增长、缓存占用和 swap 行为。")
        if alert.get("failure_count", 0) >= 2:
            root_causes.append("同一检查连续失败，较不像单次探测抖动。")
        if not root_causes:
            root_causes.append("当前信号不完整，建议先确认网络连通性和服务状态。")
        return {
            "summary": f"{subject}，需要人工排查。系统没有执行任何自动修复。",
            "root_causes": root_causes,
            "steps": [
                "先确认最新检查结果中告警是否仍然存在。",
                "使用只读命令检查磁盘、内存和监听端口。",
                "在重启服务前检查最近的部署、配置或证书变更。",
                "确认具体服务和故障模式后，再进入人工修复流程。",
            ],
            "commands": DEFAULT_COMMANDS_ZH,
            "model": "local-rule-engine",
        }
    if metadata.get("disk_used_percent", 0) >= 90:
        root_causes.append("Disk usage is above 90%, which can cause deploys, logs, and databases to fail.")
    if metadata.get("memory_used_percent", 0) >= 80:
        root_causes.append("Memory pressure is high; check process growth and swap behavior.")
    if alert.get("failure_count", 0) >= 2:
        root_causes.append("The same check failed repeatedly, so this is unlikely to be a single transient probe failure.")
    if not root_causes:
        root_causes.append("The signal is incomplete; start with network reachability and service status checks.")
    return {
        "summary": f"{_localized_subject(alert.get('title') or asset.get('name') or 'Asset', locale)} needs manual investigation. No automatic repair was executed.",
        "root_causes": root_causes,
        "steps": [
            "Confirm whether the alert is still active from the latest check result.",
            "Inspect disk, memory, and listening ports using read-only commands.",
            "Check recent deployment or configuration changes before restarting services.",
            "Escalate to manual repair only after confirming the service and failure mode.",
        ],
        "commands": DEFAULT_COMMANDS_EN,
        "model": "local-rule-engine",
    }


def _sanitize_commands(commands: list[Any], locale: str) -> list[dict[str, str]]:
    default_commands = _default_commands(locale)
    allowed = {item["command"] for item in default_commands}
    sanitized = []
    for item in commands:
        if isinstance(item, str):
            command = item
            reason = "AI suggested command; review before execution."
        else:
            command = str(item.get("command", ""))
            reason = str(item.get("reason", "Review before execution."))
        if command in allowed or command.startswith("systemctl status "):
            sanitized.append({"command": command, "reason": redact_text(reason)})
    return sanitized or default_commands


def _default_commands(locale: str) -> list[dict[str, str]]:
    return DEFAULT_COMMANDS_ZH if locale == "zh" else DEFAULT_COMMANDS_EN


def _localized_subject(subject: str, locale: str) -> str:
    if locale != "zh":
        return subject
    return subject
