from datetime import datetime, timezone

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.models import Alert, Check, CheckResult


def evaluate_alert_for_result(db: Session, result: CheckResult, check: Check) -> Alert | None:
    if result.status == "ok":
        open_alert = db.scalar(
            select(Alert).where(Alert.check_id == check.id, Alert.status.in_(["open", "acknowledged"])).order_by(desc(Alert.created_at))
        )
        if open_alert:
            open_alert.status = "closed"
            open_alert.closed_at = datetime.now(timezone.utc)
            open_alert.message = f"Recovered after successful check: {result.message}"
            db.add(open_alert)
            db.commit()
            db.refresh(open_alert)
            return open_alert
        return None

    recent_results = db.scalars(
        select(CheckResult).where(CheckResult.check_id == check.id).order_by(desc(CheckResult.checked_at)).limit(check.failure_threshold)
    ).all()
    failure_count = 0
    for item in recent_results:
        if item.status == "failed":
            failure_count += 1
        else:
            break

    if failure_count < check.failure_threshold:
        return None

    title = f"{check.name} is failing"
    message = f"{check.type} check for {check.target} failed {failure_count} times. Last error: {result.message}"
    open_alert = db.scalar(select(Alert).where(Alert.check_id == check.id, Alert.status.in_(["open", "acknowledged"])).order_by(desc(Alert.created_at)))
    if open_alert:
        open_alert.failure_count = failure_count
        open_alert.message = message
        open_alert.last_result_id = result.id
        db.add(open_alert)
        db.commit()
        db.refresh(open_alert)
        return open_alert

    alert = Alert(
        check_id=check.id,
        asset_id=check.asset_id,
        severity="critical" if failure_count >= max(check.failure_threshold + 1, 3) else "warning",
        status="open",
        title=title,
        message=message,
        failure_count=failure_count,
        last_result_id=result.id,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return alert
