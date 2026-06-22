from app.services.aliyun import AliyunClient, AliyunCredentials, _renew_status_to_bool, _swas_asset_from_instance


def test_swas_instance_maps_detail_fields_for_asset_page() -> None:
    asset = _swas_asset_from_instance(
        {
            "InstanceId": "a123",
            "InstanceName": "light-app",
            "RegionId": "cn-hangzhou",
            "Status": "Running",
            "PublicIpAddress": "203.0.113.88",
            "InnerIpAddress": "172.16.0.8",
            "ExpiredTime": "2026-12-31T16:00:00Z",
            "ResourceSpec": {"Cpu": 2, "Memory": 2.0, "DiskSize": 60, "Bandwidth": 5, "Flow": 1024},
            "Image": {"ImageName": "BT-Panel", "ImageType": "app", "ImageVersion": "8.0", "OsType": "linux"},
        },
        "cn-hangzhou",
    )

    assert asset is not None
    assert asset["type"] == "swas"
    assert asset["status"] == "running"
    assert asset["metadata_json"]["public_ip_address"] == "203.0.113.88"
    assert asset["metadata_json"]["inner_ip_address"] == "172.16.0.8"
    assert asset["metadata_json"]["expired_time"] == "2026-12-31T16:00:00Z"
    assert asset["metadata_json"]["cpu"] == 2
    assert asset["metadata_json"]["image_name"] == "BT-Panel"
    assert asset["metadata_json"]["ops"]["renewal_expires_at"] == "2026-12-31"
    assert "service_url" not in asset["metadata_json"]["ops"]


def test_swas_instance_does_not_guess_business_entry_from_public_ip() -> None:
    asset = _swas_asset_from_instance(
        {
            "InstanceId": "a124",
            "InstanceName": "light-app",
            "RegionId": "cn-hangzhou",
            "Status": "Running",
            "PublicIpAddress": "203.0.113.89",
            "ResourceSpec": {"Cpu": 2, "Memory": 2.0, "DiskSize": 60, "Bandwidth": 5},
            "Image": {"ImageName": "Ubuntu 22.04", "ImageType": "system", "OsType": "linux"},
        },
        "cn-hangzhou",
    )

    assert asset is not None
    assert "service_url" not in asset["metadata_json"]["ops"]


def test_renewal_status_is_enriched_from_bss_openapi(monkeypatch) -> None:
    class FakeBssClient:
        def query_available_instances(self, request):
            assert request.instance_ids == "a123,b456"
            return {
                "Data": {
                    "InstanceList": [
                        {
                            "InstanceID": "a123",
                            "RenewStatus": "AutoRenewal",
                            "RenewalDuration": 1,
                            "RenewalDurationUnit": "M",
                            "EndTime": "2026-12-31T16:00:00Z",
                            "ProductCode": "swas",
                            "ProductType": "swas",
                            "SubscriptionType": "Subscription",
                        },
                        {
                            "InstanceID": "b456",
                            "RenewStatus": "NotRenewal",
                            "EndTime": "2026-10-01T16:00:00Z",
                        },
                    ]
                },
                "TotalCount": 2,
            }

    client = AliyunClient(AliyunCredentials("ak", "secret", "cn-hangzhou"))
    monkeypatch.setattr(client, "_bss_client", lambda: FakeBssClient())
    assets = [
        {
            "type": "swas",
            "external_id": "a123",
            "metadata_json": {"ops": {"renewal_expires_at": "2026-09-01", "renewal_auto_renew": False}},
        },
        {"type": "ecs", "external_id": "b456", "metadata_json": {}},
    ]

    client._enrich_renewal_status(assets)

    assert assets[0]["metadata_json"]["renew_status"] == "AutoRenewal"
    assert assets[0]["metadata_json"]["auto_renew_enabled"] is True
    assert assets[0]["metadata_json"]["ops"]["renewal_auto_renew"] is True
    assert assets[0]["metadata_json"]["ops"]["renewal_expires_at"] == "2026-12-31"
    assert assets[0]["metadata_json"]["renewal_duration"] == 1
    assert assets[0]["metadata_json"]["renewal_duration_unit"] == "M"
    assert assets[1]["metadata_json"]["renew_status"] == "NotRenewal"
    assert assets[1]["metadata_json"]["auto_renew_enabled"] is False
    assert assets[1]["metadata_json"]["ops"]["renewal_auto_renew"] is False
    assert assets[1]["metadata_json"]["ops"]["renewal_expires_at"] == "2026-10-01"


def test_renew_status_to_bool() -> None:
    assert _renew_status_to_bool("AutoRenewal") is True
    assert _renew_status_to_bool("ManualRenewal") is False
    assert _renew_status_to_bool("NotRenewal") is False
    assert _renew_status_to_bool("Unknown") is None
