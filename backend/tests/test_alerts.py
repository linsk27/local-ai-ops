from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Check, CheckResult
from app.services.alerts import evaluate_alert_for_result
from app.worker import _check_is_due


def test_alert_created_after_failure_threshold() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as db:
        check = Check(name="API", type="http", target="https://example.invalid", failure_threshold=2)
        db.add(check)
        db.commit()
        db.refresh(check)

        first = CheckResult(check_id=check.id, status="failed", message="timeout", details_json={})
        db.add(first)
        db.commit()
        assert evaluate_alert_for_result(db, first, check) is None

        second = CheckResult(check_id=check.id, status="failed", message="timeout", details_json={})
        db.add(second)
        db.commit()
        alert = evaluate_alert_for_result(db, second, check)

        assert alert is not None
        assert alert.status == "open"
        assert alert.failure_count == 2


def test_alert_closes_on_recovery() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as db:
        check = Check(name="API", type="http", target="https://example.invalid", failure_threshold=1)
        db.add(check)
        db.commit()
        failed = CheckResult(check_id=check.id, status="failed", message="timeout", details_json={})
        db.add(failed)
        db.commit()
        alert = evaluate_alert_for_result(db, failed, check)
        assert alert is not None

        ok = CheckResult(check_id=check.id, status="ok", message="HTTP 200", details_json={})
        db.add(ok)
        db.commit()
        closed = evaluate_alert_for_result(db, ok, check)

        assert closed is not None
        assert closed.status == "closed"


def test_worker_respects_check_interval() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as db:
        check = Check(name="API", type="http", target="https://example.invalid", interval_seconds=300)
        db.add(check)
        db.commit()
        db.refresh(check)

        assert _check_is_due(db, check) is True

        recent = CheckResult(check_id=check.id, status="ok", message="HTTP 200", details_json={})
        db.add(recent)
        db.commit()

        assert _check_is_due(db, check) is False
