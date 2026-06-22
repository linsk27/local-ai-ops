from datetime import datetime, timedelta, timezone

from celery import Celery
from sqlalchemy import desc, select

from app.core.config import get_settings
from app.database import SessionLocal, init_db
from app.models import Check, CheckResult
from app.services.check_runner import execute_check


settings = get_settings()
celery_app = Celery("local_ai_ops", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.beat_schedule = {
    "run-enabled-checks-every-minute": {
        "task": "app.worker.run_enabled_checks",
        "schedule": 60.0,
    },
    "sync-assets-every-15-minutes": {
        "task": "app.worker.sync_assets_placeholder",
        "schedule": 900.0,
    },
}
celery_app.conf.timezone = "UTC"


@celery_app.task(name="app.worker.run_enabled_checks")
def run_enabled_checks() -> dict[str, int]:
    init_db()
    executed = 0
    with SessionLocal() as db:
        checks = db.scalars(select(Check).where(Check.enabled.is_(True))).all()
        for check in checks:
            if not _check_is_due(db, check):
                continue
            execute_check(db, check)
            executed += 1
    return {"executed": executed}


def _check_is_due(db, check: Check) -> bool:
    latest = db.scalar(select(CheckResult).where(CheckResult.check_id == check.id).order_by(desc(CheckResult.checked_at)))
    if not latest:
        return True
    checked_at = latest.checked_at
    if checked_at.tzinfo is None:
        checked_at = checked_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - checked_at >= timedelta(seconds=check.interval_seconds)


@celery_app.task(name="app.worker.sync_assets_placeholder")
def sync_assets_placeholder() -> dict[str, str]:
    # Asset sync is exposed as an API-triggered flow in the MVP. This heartbeat
    # keeps Celery Beat visible and ready for scheduled sync expansion.
    return {"status": "ready"}
