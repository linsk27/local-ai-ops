from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Alert, Asset, Check, CheckResult


def purge_legacy_sample_data(db: Session) -> None:
    legacy_assets = db.scalars(
        select(Asset).where(
            Asset.provider == "aliyun",
            (Asset.cloud_account_id.is_(None)) | (Asset.external_id.in_(["i-demo-web-01", "domain-demo-example-cn"])),
        )
    ).all()
    legacy_checks = db.scalars(select(Check).where(Check.name == "Demo API health")).all()
    asset_ids = [asset.id for asset in legacy_assets]
    check_ids = [check.id for check in legacy_checks]
    if check_ids:
        db.execute(delete(Alert).where(Alert.check_id.in_(check_ids)))
        db.execute(delete(CheckResult).where(CheckResult.check_id.in_(check_ids)))
        db.execute(delete(Check).where(Check.id.in_(check_ids)))
    if asset_ids:
        db.execute(delete(Alert).where(Alert.asset_id.in_(asset_ids)))
        db.execute(delete(CheckResult).where(CheckResult.asset_id.in_(asset_ids)))
        db.execute(delete(Asset).where(Asset.id.in_(asset_ids)))
    db.commit()
