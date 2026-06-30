from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Alert, Asset, Check, CheckResult, MonitorGroup, MonitorGroupAsset


def purge_legacy_sample_data(db: Session) -> None:
    legacy_assets = db.scalars(
        select(Asset).where(
            Asset.provider == "aliyun",
            (Asset.cloud_account_id.is_(None)) | (Asset.external_id.in_(["i-demo-web-01", "domain-demo-example-cn"])),
        )
    ).all()
    asset_ids = [asset.id for asset in legacy_assets]
    legacy_checks = db.scalars(
        select(Check).where((Check.name == "Demo API health") | (Check.asset_id.in_(asset_ids) if asset_ids else False))
    ).all()
    check_ids = [check.id for check in legacy_checks]
    group_ids = []
    if asset_ids:
        group_ids = list(
            db.scalars(select(MonitorGroupAsset.group_id).where(MonitorGroupAsset.asset_id.in_(asset_ids))).all()
        )
    if check_ids:
        db.execute(delete(Alert).where(Alert.check_id.in_(check_ids)))
        db.execute(delete(CheckResult).where(CheckResult.check_id.in_(check_ids)))
        db.execute(delete(Check).where(Check.id.in_(check_ids)))
    if asset_ids:
        db.execute(delete(Alert).where(Alert.asset_id.in_(asset_ids)))
        db.execute(delete(CheckResult).where(CheckResult.asset_id.in_(asset_ids)))
        db.execute(delete(MonitorGroupAsset).where(MonitorGroupAsset.asset_id.in_(asset_ids)))
        db.execute(delete(Asset).where(Asset.id.in_(asset_ids)))
    if group_ids:
        remaining_group_ids = set(
            db.scalars(select(MonitorGroupAsset.group_id).where(MonitorGroupAsset.group_id.in_(group_ids))).all()
        )
        stale_group_ids = [group_id for group_id in group_ids if group_id not in remaining_group_ids]
        if stale_group_ids:
            db.execute(delete(MonitorGroup).where(MonitorGroup.id.in_(stale_group_ids)))
    db.commit()
