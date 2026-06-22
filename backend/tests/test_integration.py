from typing import Any

from fastapi.testclient import TestClient

from app.api import routes
from app.main import app
from app.services import check_runner


class FakeAliyunClient:
    def __init__(self, credentials: Any = None) -> None:
        self.credentials = credentials

    def test_account(self) -> dict[str, Any]:
        return {
            "status": "healthy",
            "message": "Alibaba Cloud credentials and read-only service permissions are reachable.",
            "checks": [
                {"name": "RAM / STS", "status": "ok"},
                {"name": "Resource Center", "status": "ok"},
                {"name": "ECS", "status": "ok"},
                {"name": "CloudMonitor", "status": "ok"},
            ],
        }

    def list_assets(self) -> list[dict[str, Any]]:
        return [
            {
                "type": "ecs",
                "name": "prod-web-01",
                "external_id": "i-real-flow-001",
                "region": "cn-hangzhou",
                "status": "running",
                "metadata_json": {"disk_used_percent": 91.4, "memory_used_percent": 78.2},
            }
        ]

    def warning_messages(self) -> list[str]:
        return []

    def run_cloud_assistant(self, instance_id: str, command: str, region: str | None = None) -> dict[str, Any]:
        return {
            "status": "ok",
            "instance_id": instance_id,
            "command": command,
            "stdout": "Filesystem Size Used Avail Use% Mounted on\n/dev/vda1 80G 73G 7G 91% /\n",
            "stderr": "",
        }


def test_real_mode_flow_with_fake_aliyun_client(monkeypatch) -> None:
    monkeypatch.setattr(routes, "AliyunClient", FakeAliyunClient)
    monkeypatch.setattr(check_runner, "AliyunClient", FakeAliyunClient)

    with TestClient(app) as client:
        account_response = client.post(
            "/api/cloud-accounts",
            json={
                "name": " Readonly RAM ",
                "access_key_id": " LTAI1234567890 ",
                "access_key_secret": " abcDEF1234567890 ",
                "default_region": " cn-hangzhou ",
            },
        )
        assert account_response.status_code == 200
        account = account_response.json()
        assert account["access_key_id_masked"] == "LTAI********7890"
        assert account["name"] == "Readonly RAM"
        assert account["default_region"] == "cn-hangzhou"

        test_response = client.post(f"/api/cloud-accounts/{account['id']}/test")
        assert test_response.status_code == 200
        assert test_response.json()["status"] == "healthy"

        sync_response = client.post("/api/assets/sync", json={"account_id": account["id"]})
        assert sync_response.status_code == 200
        assert sync_response.json()["mode"] == "real"
        assert sync_response.json()["synced"] >= 1

        assets = client.get("/api/assets?type=ecs").json()
        assert assets
        assert assets[0]["external_id"] == "i-real-flow-001"
        assert assets[0]["runtime_metrics"]["disk_used_percent"] == 91.4
        assert assets[0]["runtime_metrics"]["memory_used_percent"] == 78.2

        check_response = client.post(
            "/api/checks",
            json={
                "name": "Disk pressure",
                "type": "cloud_assistant",
                "target": "df -h",
                "asset_id": assets[0]["id"],
                "threshold": 60,
                "failure_threshold": 1,
                "config_json": {"instance_id": assets[0]["external_id"]},
            },
        )
        assert check_response.status_code == 200
        check = check_response.json()
        assert check["asset_name"] == "prod-web-01"
        assert check["last_status"] is None

        checks_before_run = client.get("/api/checks").json()
        created_row = next(item for item in checks_before_run if item["id"] == check["id"])
        assert created_row["asset_type"] == "ecs"
        assert created_row["result_count"] == 0

        toggle_response = client.patch(f"/api/checks/{check['id']}", json={"enabled": False})
        assert toggle_response.status_code == 200
        assert toggle_response.json()["enabled"] is False
        toggle_back_response = client.patch(f"/api/checks/{check['id']}", json={"enabled": True, "interval_seconds": 300})
        assert toggle_back_response.status_code == 200
        assert toggle_back_response.json()["interval_seconds"] == 300

        result_response = client.post(f"/api/checks/{check['id']}/run")
        assert result_response.status_code == 200
        assert result_response.json()["status"] == "failed"
        checks_after_run = client.get("/api/checks").json()
        failed_row = next(item for item in checks_after_run if item["id"] == check["id"])
        assert failed_row["last_status"] == "failed"
        assert failed_row["last_value"] == 91.0
        assert failed_row["open_alert_id"] is not None
        updated_asset = client.get(f"/api/assets/{assets[0]['id']}").json()
        assert updated_asset["runtime_metrics"]["disk_used_percent"] == 91.0
        assert updated_asset["runtime_metrics"]["disk_used_percent_source"] == "cloud_assistant"
        assert updated_asset["runtime_metrics"]["disk_used_percent_checked_at"]

        alerts = client.get("/api/alerts?status=open").json()
        assert alerts

        diagnosis_response = client.post("/api/diagnoses", json={"alert_id": alerts[0]["id"]})
        assert diagnosis_response.status_code == 200
        diagnosis = diagnosis_response.json()
        assert diagnosis["summary"]
        assert "commands" in diagnosis

        delete_checks_response = client.delete("/api/checks")
        assert delete_checks_response.status_code == 200
        assert delete_checks_response.json()["deleted"] >= 1
        assert delete_checks_response.json()["results_deleted"] >= 1
        assert client.get("/api/checks").json() == []
        assert client.get("/api/check-results").json() == []
        remaining_alerts = client.get("/api/alerts").json()
        assert remaining_alerts
        assert remaining_alerts[0]["check_id"] is None

        delete_response = client.delete(f"/api/cloud-accounts/{account['id']}")
        assert delete_response.status_code == 200
        assert delete_response.json()["detached_assets"] >= 1
        detached_asset = next(item for item in client.get("/api/assets?type=ecs").json() if item["external_id"] == "i-real-flow-001")
        assert detached_asset["cloud_account_id"] is None
