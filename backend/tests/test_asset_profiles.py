from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.security import decrypt_secret
from app.api.routes import _merge_synced_metadata
from app.database import SessionLocal
from app.main import app
from app.models import Asset, AuditLog, EncryptedSecret, ServerAccessProfile
from app.services import check_runner
from app.services.monitoring import ProbeResult


def test_asset_ops_and_access_profile_are_persisted_without_returning_secret() -> None:
    with TestClient(app) as client:
        external_id = f"i-profile-{uuid4().hex[:8]}"
        with SessionLocal() as db:
            asset = Asset(
                provider="aliyun",
                type="ecs",
                name="ops-detail-server",
                external_id=external_id,
                region="cn-hangzhou",
                status="running",
                metadata_json={"public_ip": "203.0.113.10"},
            )
            db.add(asset)
            db.commit()
            db.refresh(asset)
            asset_id = asset.id

        ops_response = client.patch(
            f"/api/assets/{asset_id}/ops",
            json={
                "renewal_expires_at": "2026-12-31",
                "renewal_auto_renew": True,
                "renewal_notes": "Monthly renewal owner: ops",
                "service_url": "https://service.example.com",
                "login_url": "https://console.aliyun.com",
            },
        )
        assert ops_response.status_code == 200
        ops = ops_response.json()["metadata_json"]["ops"]
        assert ops["renewal_expires_at"] == "2026-12-31"
        assert ops["renewal_auto_renew"] is True

        missing_secret_response = client.put(
            f"/api/assets/{asset_id}/access-profile",
            json={
                "method": "ssh_password",
                "host": "203.0.113.10",
                "username": "root",
                "port": 22,
                "enabled": True,
            },
        )
        assert missing_secret_response.status_code == 400
        assert "required" in missing_secret_response.json()["detail"]

        missing_username_response = client.put(
            f"/api/assets/{asset_id}/access-profile",
            json={
                "method": "ssh_password",
                "host": "203.0.113.10",
                "username": "",
                "port": 22,
                "secret": "server-password-value",
                "enabled": True,
            },
        )
        assert missing_username_response.status_code == 400
        assert "username is required" in missing_username_response.json()["detail"]

        profile_response = client.put(
            f"/api/assets/{asset_id}/access-profile",
            json={
                "method": "ssh_password",
                "host": "203.0.113.10",
                "username": "root",
                "port": 22,
                "secret": "server-password-value",
                "enabled": True,
                "notes": "Use only for manual SSH fallback",
            },
        )
        assert profile_response.status_code == 200
        profile_payload = profile_response.json()
        assert profile_payload["secret_configured"] is True
        assert "server-password-value" not in str(profile_payload)

        get_profile_response = client.get(f"/api/assets/{asset_id}/access-profile")
        assert get_profile_response.status_code == 200
        assert get_profile_response.json()["host"] == "203.0.113.10"
        assert "server-password-value" not in str(get_profile_response.json())

        with SessionLocal() as db:
            profile = db.scalar(select(ServerAccessProfile).where(ServerAccessProfile.asset_id == asset_id))
            assert profile is not None
            assert profile.secret_id is not None
            secret = db.get(EncryptedSecret, profile.secret_id)
            assert secret is not None
            assert "server-password-value" not in secret.ciphertext
            assert decrypt_secret(secret.nonce, secret.ciphertext) == "server-password-value"
            profile_id = profile.id

        reveal_response = client.post(f"/api/assets/{asset_id}/access-profile/secret/reveal")
        assert reveal_response.status_code == 200
        reveal_payload = reveal_response.json()
        assert reveal_payload == {"secret": "server-password-value", "method": "ssh_password"}

        with SessionLocal() as db:
            audit = db.scalar(
                select(AuditLog).where(AuditLog.action == "server_access_profile.secret_reveal", AuditLog.resource_id == str(asset_id))
            )
            assert audit is not None
            assert audit.metadata_json == {"profile_id": profile_id, "method": "ssh_password"}
            assert "server-password-value" not in str(audit.metadata_json)

        clear_response = client.put(
            f"/api/assets/{asset_id}/access-profile",
            json={
                "method": "cloud_assistant",
                "host": "203.0.113.10",
                "username": "",
                "port": 22,
                "clear_secret": True,
                "enabled": True,
                "notes": "",
            },
        )
        assert clear_response.status_code == 200
        assert clear_response.json()["secret_configured"] is False
        assert client.post(f"/api/assets/{asset_id}/access-profile/secret/reveal").status_code == 400


def test_bt_panel_profile_is_encrypted_and_reveal_is_explicit() -> None:
    with TestClient(app) as client:
        external_id = f"swas-bt-{uuid4().hex[:8]}"
        with SessionLocal() as db:
            asset = Asset(
                provider="aliyun",
                type="swas",
                name="bt-panel-server",
                external_id=external_id,
                region="cn-guangzhou",
                status="running",
                metadata_json={"public_ip_address": "203.0.113.20"},
            )
            db.add(asset)
            db.commit()
            db.refresh(asset)
            asset_id = asset.id

        save_response = client.put(
            f"/api/assets/{asset_id}/bt-panel",
            json={
                "url": "http://203.0.113.20:8888/secret-entry",
                "username": "bt-admin",
                "password": "bt-panel-password",
                "enabled": True,
                "notes": "Main BT panel login",
            },
        )
        assert save_response.status_code == 200
        save_payload = save_response.json()
        assert save_payload["url"] == "http://203.0.113.20:8888/secret-entry"
        assert save_payload["username"] == "bt-admin"
        assert save_payload["password_configured"] is True
        assert "bt-panel-password" not in str(save_payload)

        get_response = client.get(f"/api/assets/{asset_id}/bt-panel")
        assert get_response.status_code == 200
        assert get_response.json()["password_configured"] is True
        assert "bt-panel-password" not in str(get_response.json())

        with SessionLocal() as db:
            secret = db.scalar(select(EncryptedSecret).where(EncryptedSecret.name == f"bt_panel:{asset_id}:password"))
            assert secret is not None
            assert "bt-panel-password" not in secret.ciphertext
            assert decrypt_secret(secret.nonce, secret.ciphertext) == "bt-panel-password"

        reveal_response = client.post(f"/api/assets/{asset_id}/bt-panel/password/reveal")
        assert reveal_response.status_code == 200
        assert reveal_response.json()["password"] == "bt-panel-password"

        with SessionLocal() as db:
            audit = db.scalar(
                select(AuditLog).where(AuditLog.action == "asset.bt_panel.password_reveal", AuditLog.resource_id == str(asset_id))
            )
            assert audit is not None

        clear_response = client.put(
            f"/api/assets/{asset_id}/bt-panel",
            json={
                "url": "http://203.0.113.20:8888/secret-entry",
                "username": "bt-admin",
                "clear_password": True,
                "enabled": True,
            },
        )
        assert clear_response.status_code == 200
        assert clear_response.json()["password_configured"] is False
        assert client.post(f"/api/assets/{asset_id}/bt-panel/password/reveal").status_code == 404


def test_asset_sync_preserves_local_bt_panel_metadata() -> None:
    merged = _merge_synced_metadata(
        {"source": "aliyun", "ops": {"renewal_expires_at": "2026-12-31"}},
        {
            "bt_panel": {"url": "http://203.0.113.20:8888/secret-entry", "username": "bt-admin", "enabled": True},
            "ops": {"renewal_auto_renew": True},
        },
    )
    assert merged["bt_panel"]["username"] == "bt-admin"
    assert merged["bt_panel"]["url"] == "http://203.0.113.20:8888/secret-entry"
    assert merged["ops"]["renewal_expires_at"] == "2026-12-31"
    assert merged["ops"]["renewal_auto_renew"] is True


def test_asset_sync_drops_generated_public_ip_service_url() -> None:
    merged = _merge_synced_metadata(
        {
            "source": "swas",
            "public_ip_address": "203.0.113.20",
            "ops": {"renewal_expires_at": "2026-12-31"},
        },
        {"ops": {"service_url": "http://203.0.113.20", "renewal_notes": "keep owner note"}},
    )
    assert "service_url" not in merged["ops"]
    assert merged["ops"]["renewal_notes"] == "keep owner note"


def test_asset_sync_preserves_manual_domain_service_url() -> None:
    merged = _merge_synced_metadata(
        {
            "source": "swas",
            "public_ip_address": "203.0.113.20",
            "ops": {"renewal_expires_at": "2026-12-31"},
        },
        {"ops": {"service_url": "https://app.example.com"}},
    )
    assert merged["ops"]["service_url"] == "https://app.example.com"


def test_ssh_check_uses_encrypted_asset_access_profile(monkeypatch) -> None:
    captured: dict[str, str | None] = {}

    def fake_run_ssh_check(target: str, timeout_seconds: int, username: str | None = None, password: str | None = None, private_key: str | None = None) -> ProbeResult:
        captured.update({"target": target, "username": username, "password": password, "private_key": private_key})
        return ProbeResult("ok", 12.0, 1.0, "SSH login succeeded", {"target": target})

    monkeypatch.setattr(check_runner, "run_ssh_check", fake_run_ssh_check)

    with TestClient(app) as client:
        external_id = f"i-ssh-{uuid4().hex[:8]}"
        with SessionLocal() as db:
            asset = Asset(
                provider="aliyun",
                type="ecs",
                name="ssh-profile-server",
                external_id=external_id,
                region="cn-hangzhou",
                status="running",
                metadata_json={"public_ip": "203.0.113.11"},
            )
            db.add(asset)
            db.commit()
            db.refresh(asset)
            asset_id = asset.id

        profile_response = client.put(
            f"/api/assets/{asset_id}/access-profile",
            json={
                "method": "ssh_password",
                "host": "203.0.113.11",
                "username": "root",
                "port": 22,
                "secret": "asset-ssh-password",
                "enabled": True,
            },
        )
        assert profile_response.status_code == 200

        check_response = client.post(
            "/api/checks",
            json={
                "name": "SSH reachability",
                "type": "ssh",
                "target": "203.0.113.11:22",
                "asset_id": asset_id,
                "failure_threshold": 1,
                "config_json": {},
            },
        )
        assert check_response.status_code == 200

        run_response = client.post(f"/api/checks/{check_response.json()['id']}/run")
        assert run_response.status_code == 200
        assert run_response.json()["status"] == "ok"
        assert captured["username"] == "root"
        assert captured["password"] == "asset-ssh-password"
        assert captured["private_key"] is None
        assert "asset-ssh-password" not in str(run_response.json())


def test_readonly_command_check_falls_back_to_ssh_profile_for_non_ecs_asset(monkeypatch) -> None:
    captured: dict[str, str | None] = {}

    def fake_run_ssh_command_check(
        target: str,
        timeout_seconds: int,
        command: str,
        username: str | None = None,
        password: str | None = None,
        private_key: str | None = None,
    ) -> ProbeResult:
        captured.update({"target": target, "command": command, "username": username, "password": password})
        return ProbeResult(
            "ok",
            20.0,
            None,
            "SSH read-only command completed",
            {"stdout": "Filesystem Size Used Avail Use% Mounted on\n/dev/vda1 40G 31G 9G 78% /\n", "stderr": "", "exit_code": 0},
        )

    monkeypatch.setattr(check_runner, "run_ssh_command_check", fake_run_ssh_command_check)

    with TestClient(app) as client:
        external_id = f"swas-ssh-{uuid4().hex[:8]}"
        with SessionLocal() as db:
            asset = Asset(
                provider="aliyun",
                type="swas",
                name="swas-runtime-server",
                external_id=external_id,
                region="cn-guangzhou",
                status="running",
                metadata_json={"public_ip_address": "203.0.113.12"},
            )
            db.add(asset)
            db.commit()
            db.refresh(asset)
            asset_id = asset.id

        profile_response = client.put(
            f"/api/assets/{asset_id}/access-profile",
            json={
                "method": "ssh_password",
                "host": "203.0.113.12",
                "username": "root",
                "port": 22,
                "secret": "asset-ssh-password",
                "enabled": True,
            },
        )
        assert profile_response.status_code == 200

        check_response = client.post(
            "/api/checks",
            json={
                "name": "Disk usage",
                "type": "cloud_assistant",
                "target": "df -h",
                "asset_id": asset_id,
                "threshold": 90,
                "failure_threshold": 1,
                "config_json": {},
            },
        )
        assert check_response.status_code == 200

        run_response = client.post(f"/api/checks/{check_response.json()['id']}/run")
        assert run_response.status_code == 200
        assert run_response.json()["status"] == "ok"
        assert run_response.json()["value"] == 78.0
        assert captured == {
            "target": "203.0.113.12:22",
            "command": "df -h",
            "username": "root",
            "password": "asset-ssh-password",
        }

        asset_response = client.get(f"/api/assets/{asset_id}")
        assert asset_response.status_code == 200
        assert asset_response.json()["runtime_metrics"]["disk_used_percent"] == 78.0
        assert asset_response.json()["runtime_metrics"]["disk_used_percent_source"] == "cloud_assistant"


def test_runtime_collection_runs_disk_and_memory_checks_for_ssh_profile(monkeypatch) -> None:
    captured: list[dict[str, str | None]] = []

    def fake_run_ssh_command_check(
        target: str,
        timeout_seconds: int,
        command: str,
        username: str | None = None,
        password: str | None = None,
        private_key: str | None = None,
    ) -> ProbeResult:
        captured.append({"target": target, "command": command, "username": username, "password": password})
        stdout = (
            "Filesystem Size Used Avail Use% Mounted on\n/dev/vda1 70G 21G 49G 30% /\n"
            if command == "df -h"
            else "              total        used        free      shared  buff/cache   available\nMem:           8000        2000        5000          10        1000        5900\n"
        )
        return ProbeResult("ok", 20.0, None, "SSH read-only command completed", {"stdout": stdout, "stderr": "", "exit_code": 0})

    monkeypatch.setattr(check_runner, "run_ssh_command_check", fake_run_ssh_command_check)

    with TestClient(app) as client:
        external_id = f"swas-collect-{uuid4().hex[:8]}"
        with SessionLocal() as db:
            asset = Asset(
                provider="aliyun",
                type="swas",
                name="swas-collect-server",
                external_id=external_id,
                region="cn-guangzhou",
                status="running",
                metadata_json={"public_ip_address": "203.0.113.13"},
            )
            db.add(asset)
            db.commit()
            db.refresh(asset)
            asset_id = asset.id

        profile_response = client.put(
            f"/api/assets/{asset_id}/access-profile",
            json={
                "method": "ssh_password",
                "host": "203.0.113.13",
                "username": "root",
                "port": 22,
                "secret": "asset-ssh-password",
                "enabled": True,
            },
        )
        assert profile_response.status_code == 200

        collect_response = client.post(f"/api/assets/{asset_id}/runtime/collect")
        assert collect_response.status_code == 200
        payload = collect_response.json()
        assert [item["status"] for item in payload["results"]] == ["ok", "ok"]
        assert payload["asset"]["runtime_metrics"]["disk_used_percent"] == 30.0
        assert payload["asset"]["runtime_metrics"]["memory_used_percent"] == 25.0
        assert payload["asset"]["data_quality"]["field_sources"]["usage"] == "runtime_check"
        assert "runtime_usage_missing" not in payload["asset"]["data_quality"]["gaps"]
        assert [item["command"] for item in captured] == ["df -h", "free -m"]
        assert all(item["username"] == "root" for item in captured)
        assert all(item["password"] == "asset-ssh-password" for item in captured)


def test_default_checks_are_created_idempotently_for_server_asset() -> None:
    with TestClient(app) as client:
        external_id = f"swas-defaults-{uuid4().hex[:8]}"
        with SessionLocal() as db:
            asset = Asset(
                provider="aliyun",
                type="swas",
                name="defaults-server",
                external_id=external_id,
                region="cn-guangzhou",
                status="running",
                metadata_json={"public_ip_address": "203.0.113.15"},
            )
            db.add(asset)
            db.commit()
            db.refresh(asset)
            asset_id = asset.id

        first_response = client.post(f"/api/assets/{asset_id}/checks/defaults")
        assert first_response.status_code == 200
        first_checks = first_response.json()
        assert {item["type"] for item in first_checks} == {"ssh", "tcp", "cloud_assistant"}
        assert {item["target"] for item in first_checks} == {"203.0.113.15:22", "df -h", "free -m"}

        second_response = client.post(f"/api/assets/{asset_id}/checks/defaults")
        assert second_response.status_code == 200
        second_checks = second_response.json()
        assert [item["id"] for item in second_checks] == [item["id"] for item in first_checks]


def test_default_checks_for_domain_create_https_probe() -> None:
    with TestClient(app) as client:
        external_id = f"domain-defaults-{uuid4().hex[:8]}"
        with SessionLocal() as db:
            asset = Asset(
                provider="aliyun",
                type="domain",
                name="example.test",
                external_id=external_id,
                region="global",
                status="active",
                metadata_json={},
            )
            db.add(asset)
            db.commit()
            db.refresh(asset)
            asset_id = asset.id

        response = client.post(f"/api/assets/{asset_id}/checks/defaults")
        assert response.status_code == 200
        checks = response.json()
        assert len(checks) == 1
        assert checks[0]["type"] == "http"
        assert checks[0]["target"] == "https://example.test"


def test_check_can_be_deleted_without_removing_existing_alert(monkeypatch) -> None:
    def fake_run_tcp_check(target: str, timeout_seconds: int) -> ProbeResult:
        return ProbeResult("failed", None, None, "connection refused", {"target": target, "timeout_seconds": timeout_seconds})

    monkeypatch.setattr(check_runner, "run_tcp_check", fake_run_tcp_check)

    with TestClient(app) as client:
        check_response = client.post(
            "/api/checks",
            json={
                "name": f"Disposable TCP {uuid4().hex[:8]}",
                "type": "tcp",
                "target": "203.0.113.99:65530",
                "failure_threshold": 1,
            },
        )
        assert check_response.status_code == 200
        check = check_response.json()

        run_response = client.post(f"/api/checks/{check['id']}/run")
        assert run_response.status_code == 200
        assert run_response.json()["status"] == "failed"

        alerts_before = [item for item in client.get("/api/alerts").json() if item["check_id"] == check["id"]]
        assert len(alerts_before) == 1

        delete_response = client.delete(f"/api/checks/{check['id']}")
        assert delete_response.status_code == 200
        assert delete_response.json() == {"deleted": True, "id": check["id"]}

        checks_after = client.get("/api/checks").json()
        assert all(item["id"] != check["id"] for item in checks_after)
        assert client.get(f"/api/check-results?check_id={check['id']}").json() == []

        alerts_after = client.get("/api/alerts").json()
        preserved_alert = next(item for item in alerts_after if item["id"] == alerts_before[0]["id"])
        assert preserved_alert["check_id"] is None
