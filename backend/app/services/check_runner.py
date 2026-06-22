from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.core.security import decrypt_secret, redact_obj
from app.models import Asset, Check, CheckResult, CloudAccount, EncryptedSecret, ServerAccessProfile
from app.services.alerts import evaluate_alert_for_result
from app.services.aliyun import AliyunClient, AliyunCredentials
from app.services.monitoring import (
    ProbeResult,
    parse_disk_percent,
    parse_memory_percent,
    run_http_check,
    run_ssh_check,
    run_ssh_command_check,
    run_tcp_check,
)


def execute_check(db: Session, check: Check) -> CheckResult:
    probe = _probe_for_check(db, check)
    result = CheckResult(
        check_id=check.id,
        asset_id=check.asset_id,
        status=probe.status,
        latency_ms=probe.latency_ms,
        value=probe.value,
        message=probe.message,
        details_json=redact_obj(probe.details),
    )
    db.add(result)
    db.commit()
    db.refresh(result)
    evaluate_alert_for_result(db, result, check)
    return result


def _probe_for_check(db: Session, check: Check) -> ProbeResult:
    if check.type == "http":
        return run_http_check(check.target, check.timeout_seconds)
    if check.type == "tcp":
        return run_tcp_check(check.target, check.timeout_seconds)
    if check.type == "ssh":
        config = check.config_json or {}
        username = config.get("username")
        password = config.get("password")
        private_key = config.get("private_key")
        profile_credentials = _ssh_credentials_for_check(db, check)
        username = username or profile_credentials.get("username")
        if not password and not private_key:
            password = profile_credentials.get("password")
            private_key = profile_credentials.get("private_key")
        return run_ssh_check(check.target, check.timeout_seconds, username, password, private_key)
    if check.type == "ecs_metric":
        config = check.config_json or {}
        instance_id = config.get("instance_id") or _asset_external_id(db, check)
        if not instance_id:
            return ProbeResult("failed", None, None, "ECS instance_id is required for CloudMonitor checks.", {})
        client = _aliyun_client_for_check(db, check)
        metric = client.query_metric(check.target, instance_id, config.get("region") or _asset_region(db, check))
        if metric["status"] != "ok":
            return ProbeResult("failed", None, None, metric.get("message", "Metric query failed"), metric)
        value = float(metric["value"])
        threshold = check.threshold
        failed = threshold is not None and value >= threshold
        return ProbeResult("failed" if failed else "ok", None, value, f"{check.target}={value}{metric.get('unit', '')}", metric)
    if check.type == "cloud_assistant":
        config = check.config_json or {}
        instance_id = config.get("instance_id") or _asset_external_id(db, check)
        if instance_id:
            client = _aliyun_client_for_check(db, check)
            output = client.run_cloud_assistant(instance_id, check.target, config.get("region") or _asset_region(db, check))
            if output["status"] != "ok":
                return ProbeResult("failed", None, None, output.get("message", "Cloud Assistant command failed"), output)
        else:
            credentials = _ssh_credentials_for_check(db, check)
            ssh_target = _ssh_target_for_check(db, check)
            probe = run_ssh_command_check(
                ssh_target,
                check.timeout_seconds,
                check.target,
                credentials.get("username"),
                credentials.get("password"),
                credentials.get("private_key"),
            )
            output = probe.details
            if probe.status != "ok":
                return probe
        value = None
        if check.target.startswith("df"):
            value = parse_disk_percent(output.get("stdout", ""))
        elif check.target.startswith("free"):
            value = parse_memory_percent(output.get("stdout", ""))
        failed = check.threshold is not None and value is not None and value >= check.threshold
        return ProbeResult("failed" if failed else "ok", None, value, "Cloud Assistant read-only command completed", output)
    return ProbeResult("failed", None, None, f"Unsupported check type: {check.type}", {})


def _asset_external_id(db: Session, check: Check) -> str | None:
    asset = db.get(Asset, check.asset_id) if check.asset_id else None
    return asset.external_id if asset and asset.type == "ecs" else None


def _asset_region(db: Session, check: Check) -> str | None:
    asset = db.get(Asset, check.asset_id) if check.asset_id else None
    return asset.region if asset and asset.region != "global" else None


def _aliyun_client_for_check(db: Session, check: Check) -> AliyunClient:
    account: CloudAccount | None = None
    if check.asset_id:
        asset = db.get(Asset, check.asset_id)
        if asset and asset.cloud_account_id:
            account = db.get(CloudAccount, asset.cloud_account_id)
    if not account:
        account = db.scalar(select(CloudAccount).order_by(desc(CloudAccount.created_at)))
    return AliyunClient(_credentials_for_account(db, account) if account else None)


def _ssh_credentials_for_check(db: Session, check: Check) -> dict[str, str]:
    if not check.asset_id:
        return {}
    profile = db.scalar(select(ServerAccessProfile).where(ServerAccessProfile.asset_id == check.asset_id))
    if not profile or not profile.enabled or not profile.secret_id:
        return {}
    secret = db.get(EncryptedSecret, profile.secret_id)
    if not secret:
        return {}
    secret_value = decrypt_secret(secret.nonce, secret.ciphertext)
    credentials = {"username": profile.username or ""}
    if profile.method == "ssh_key":
        credentials["private_key"] = secret_value
    elif profile.method == "ssh_password":
        credentials["password"] = secret_value
    return credentials


def _ssh_target_for_check(db: Session, check: Check) -> str:
    if not check.asset_id:
        return check.target
    profile = db.scalar(select(ServerAccessProfile).where(ServerAccessProfile.asset_id == check.asset_id))
    if profile:
        asset = db.get(Asset, check.asset_id)
        metadata = dict(asset.metadata_json or {}) if asset else {}
        access_metadata = metadata.get("access_profile") if isinstance(metadata.get("access_profile"), dict) else {}
        host = access_metadata.get("host") or _default_asset_host(asset)
        if host:
            return f"{host}:{profile.port or 22}"
    return check.target


def _default_asset_host(asset: Asset | None) -> str:
    if not asset:
        return ""
    metadata = dict(asset.metadata_json or {})
    for key in ("public_ip", "public_ip_address", "ip_address", "internet_ip", "eip_address"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, list) and value and isinstance(value[0], str):
            return value[0].strip()
    return ""


def _credentials_for_account(db: Session, account: CloudAccount | None) -> AliyunCredentials | None:
    if not account:
        return None
    secrets = db.scalars(select(EncryptedSecret).where(EncryptedSecret.cloud_account_id == account.id)).all()
    secret_map = {secret.name: decrypt_secret(secret.nonce, secret.ciphertext) for secret in secrets}
    return AliyunCredentials(
        access_key_id=secret_map.get("access_key_id", ""),
        access_key_secret=secret_map.get("access_key_secret", ""),
        region=account.default_region,
    )
