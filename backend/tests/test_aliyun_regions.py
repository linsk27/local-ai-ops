from typing import Any

from app.services.aliyun import AliyunClient, AliyunCredentials


class MultiRegionAliyunClient(AliyunClient):
    def _discover_ecs_regions(self) -> list[str]:
        return ["cn-hangzhou", "cn-shanghai", "cn-beijing"]

    def _list_ecs_assets_for_region(self, region: str) -> list[dict[str, Any]]:
        return [
            {
                "type": "ecs",
                "name": f"server-{region}",
                "external_id": f"i-{region}",
                "region": region,
                "status": "running",
                "metadata_json": {"source": "ecs"},
            }
        ]


def test_ecs_sync_collects_all_discovered_regions() -> None:
    client = MultiRegionAliyunClient(AliyunCredentials("LTAI1234567890", "secret", "cn-hangzhou"))

    assets = client._list_ecs_assets()

    assert [asset["region"] for asset in assets] == ["cn-hangzhou", "cn-shanghai", "cn-beijing"]
    assert [asset["external_id"] for asset in assets] == ["i-cn-hangzhou", "i-cn-shanghai", "i-cn-beijing"]


def test_resource_center_maps_simple_application_servers() -> None:
    client = AliyunClient(AliyunCredentials("LTAI1234567890", "secret", "cn-hangzhou"))

    asset = client._resource_center_asset(
        {
            "ResourceType": "ACS::SWAS::Instance",
            "ResourceId": "swas-example-id",
            "ResourceName": "lightweight-web",
            "RegionId": "cn-hangzhou",
        }
    )

    assert asset is not None
    assert asset["type"] == "swas"
    assert asset["name"] == "lightweight-web"
    assert asset["metadata_json"]["resource_type"] == "ACS::SWAS::Instance"
