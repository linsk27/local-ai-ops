from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.database import SessionLocal
from app.main import app
from app.models import AiDiagnosis, Alert, AlertRule, Check, CheckResult, Incident


def _clear_check_data() -> None:
    with SessionLocal() as db:
        db.execute(delete(AiDiagnosis))
        db.execute(delete(Incident))
        db.execute(delete(Alert))
        db.execute(delete(AlertRule))
        db.execute(delete(CheckResult))
        db.execute(delete(Check))
        db.commit()


def test_dashboard_does_not_report_100_uptime_without_http_samples() -> None:
    with TestClient(app) as client:
        _clear_check_data()
        response = client.get("/api/dashboard")

    assert response.status_code == 200
    payload = response.json()
    assert payload["website_uptime"] is None
    assert payload["website_uptime_ok"] == 0
    assert payload["website_uptime_total"] == 0


def test_dashboard_uptime_is_calculated_from_latest_http_samples() -> None:
    checked_at = datetime(2026, 6, 26, 7, 30, tzinfo=timezone.utc)
    with TestClient(app) as client:
        _clear_check_data()
        with SessionLocal() as db:
            check = Check(name="Homepage", type="http", target="https://example.com")
            db.add(check)
            db.flush()
            db.add_all(
                [
                    CheckResult(check_id=check.id, status="ok", message="HTTP 200", checked_at=checked_at),
                    CheckResult(check_id=check.id, status="failed", message="HTTP 500", checked_at=checked_at - timedelta(minutes=5)),
                    CheckResult(check_id=check.id, status="ok", message="HTTP 200", checked_at=checked_at - timedelta(minutes=10)),
                ]
            )
            db.commit()
        response = client.get("/api/dashboard")

    assert response.status_code == 200
    payload = response.json()
    assert payload["website_uptime"] == 66.67
    assert payload["website_uptime_ok"] == 2
    assert payload["website_uptime_total"] == 3
    assert payload["website_uptime_checked_at"] is not None
