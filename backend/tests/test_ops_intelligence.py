from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.database import SessionLocal
from app.main import app
from app.models import AiDiagnosis, Alert, AlertRule, Asset, AssetRelation, Check, CheckResult, Incident, ServerAccessProfile


def _clear_data() -> None:
    with SessionLocal() as db:
        db.execute(delete(AiDiagnosis))
        db.execute(delete(Incident))
        db.execute(delete(Alert))
        db.execute(delete(AlertRule))
        db.execute(delete(CheckResult))
        db.execute(delete(Check))
        db.execute(delete(ServerAccessProfile))
        db.execute(delete(AssetRelation))
        db.execute(delete(Asset))
        db.commit()


def test_renewal_center_uses_asset_and_ops_metadata() -> None:
    expires = (datetime.now(timezone.utc).date() + timedelta(days=9)).isoformat()
    with TestClient(app) as client:
        _clear_data()
        with SessionLocal() as db:
            db.add(
                Asset(
                    provider="aliyun",
                    type="swas",
                    name="renew-me",
                    external_id="swas-renew-me",
                    region="cn-hangzhou",
                    status="running",
                    metadata_json={"ops": {"renewal_expires_at": expires, "renewal_auto_renew": True}},
                )
            )
            db.commit()

        response = client.get("/api/renewals")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["expiring_soon"] == 1
    assert payload["auto_renew_enabled"] == 1
    assert payload["items"][0]["name"] == "renew-me"
    assert payload["items"][0]["source"] == "local_profile"


def test_knowledge_query_answers_from_local_runtime_data() -> None:
    with TestClient(app) as client:
        _clear_data()
        with SessionLocal() as db:
            db.add(
                Asset(
                    provider="aliyun",
                    type="swas",
                    name="pressure-box",
                    external_id="swas-pressure",
                    region="cn-guangzhou",
                    status="running",
                    metadata_json={"disk_used_percent": 92, "memory_used_percent": 76},
                )
            )
            db.commit()

        response = client.post("/api/knowledge/query", json={"question": "哪些服务器磁盘压力高", "locale": "zh"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "runtime_usage"
    assert payload["evidence"][0]["name"] == "pressure-box"
    assert payload["evidence"][0]["disk_used_percent"] == 92


def test_asset_graph_infers_dns_to_server_edges() -> None:
    with TestClient(app) as client:
        _clear_data()
        with SessionLocal() as db:
            server = Asset(
                provider="aliyun",
                type="swas",
                name="web-server",
                external_id="swas-web",
                region="cn-hangzhou",
                status="running",
                metadata_json={"public_ip_address": "203.0.113.10"},
            )
            domain = Asset(
                provider="aliyun",
                type="domain",
                name="example.com",
                external_id="domain-example",
                region="global",
                status="active",
                metadata_json={},
            )
            dns = Asset(
                provider="aliyun",
                type="dns",
                name="www.example.com",
                external_id="dns-example",
                region="global",
                status="active",
                metadata_json={"rr": "www", "domain": "example.com", "value": "203.0.113.10"},
            )
            db.add_all([server, domain, dns])
            db.commit()

        response = client.get("/api/asset-graph")

    assert response.status_code == 200
    payload = response.json()
    relations = {(edge["source"], edge["target"], edge["relation"]) for edge in payload["edges"]}
    nodes_by_label = {node["label"]: node["id"] for node in payload["nodes"]}
    assert (nodes_by_label["www.example.com"], nodes_by_label["web-server"], "resolves_to") in relations
    assert (nodes_by_label["example.com"], nodes_by_label["www.example.com"], "has_dns_record") in relations
