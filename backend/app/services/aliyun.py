import base64
import json
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from alibabacloud_alidns20150109.client import Client as DnsClient
from alibabacloud_alidns20150109 import models as dns_models
from alibabacloud_bssopenapi20171214.client import Client as BssClient
from alibabacloud_bssopenapi20171214 import models as bss_models
from alibabacloud_cms20190101.client import Client as CmsClient
from alibabacloud_cms20190101 import models as cms_models
from alibabacloud_domain20180129.client import Client as DomainClient
from alibabacloud_domain20180129 import models as domain_models
from alibabacloud_ecs20140526.client import Client as EcsClient
from alibabacloud_ecs20140526 import models as ecs_models
from alibabacloud_oss20190517.client import Client as OssClient
from alibabacloud_oss20190517 import models as oss_models
from alibabacloud_resourcecenter20221201.client import Client as ResourceCenterClient
from alibabacloud_resourcecenter20221201 import models as rc_models
from alibabacloud_sts20150401.client import Client as StsClient
from alibabacloud_swas_open20200601.client import Client as SwasClient
from alibabacloud_swas_open20200601 import models as swas_models
from alibabacloud_tea_openapi.models import Config

from app.core.config import get_settings
from app.core.security import redact_text

SIGNATURE_ERROR_MARKERS = (
    "SignatureDoesNotMatch",
    "IncompleteSignature",
    "InvalidAccessKeyId",
    "InvalidAccessKeySecret",
    "AccessKeyIdNotFound",
)
PERMISSION_ERROR_MARKERS = (
    "AccessDenied",
    "Forbidden",
    "NoPermission",
    "Unauthorized",
    "Forbidden.RAM",
    "ForbiddenUser",
)
NETWORK_TIMEOUT_MARKERS = (
    "Read timed out",
    "ConnectTimeout",
    "Connection to",
    "Max retries exceeded",
    "SSLEOFError",
    "UNEXPECTED_EOF_WHILE_READING",
)
SDK_DEBUG_PATTERNS = (
    r"server StringToSign is \[.*?\]",
    r"server CanonicalRequest is \[.*?\]",
)
SIGNATURE_ERROR_MESSAGE = (
    "Alibaba Cloud signature verification failed. Check that AccessKey ID and AccessKey Secret are an exact "
    "matching RAM AccessKey pair, with no extra spaces or line breaks. If the Secret was not saved, create a "
    "new RAM AccessKey and replace the saved cloud account."
)
PERMISSION_ERROR_MESSAGE = "Alibaba Cloud permission denied. Check that the RAM user has the required read-only policies for this service."
NETWORK_TIMEOUT_MESSAGE = "Alibaba Cloud endpoint timed out or closed the TLS connection. This is usually a regional network issue; other regions can still sync."


class AliyunIntegrationError(RuntimeError):
    """Raised when a real Alibaba Cloud SDK call cannot produce usable data."""


@dataclass
class AliyunCredentials:
    access_key_id: str
    access_key_secret: str
    region: str


@dataclass
class SyncWarning:
    service: str
    message: str


@dataclass
class AliyunClient:
    """Real Alibaba Cloud integration facade.

    Runtime product behavior intentionally avoids generated sample assets.
    Tests can still replace this class with a fake client at the API boundary.
    """

    credentials: AliyunCredentials | None = None
    warnings: list[SyncWarning] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.settings = get_settings()

    def test_account(self) -> dict[str, Any]:
        if not self.credentials:
            return self._error_result("Missing encrypted Alibaba Cloud credentials.")

        checks: list[dict[str, str]] = []
        self._add_check(checks, "RAM / STS", self._probe_sts)
        self._add_check(checks, "Resource Center", self._probe_resource_center)
        self._add_check(checks, "ECS", self._probe_ecs)
        self._add_check(checks, "CloudMonitor", self._probe_cloud_monitor)
        self._add_optional_check(checks, "BssOpenAPI renewal", self._probe_bss_renewal)

        failed = [check for check in checks if check["status"] == "failed"]
        warnings = [check for check in checks if check["status"] == "warning"]
        if failed:
            status = "error"
            failed_messages = [check.get("message", "") for check in failed]
            if any(_is_signature_error_message(message) for message in failed_messages):
                message = SIGNATURE_ERROR_MESSAGE
            elif any(_is_permission_error_message(message) for message in failed_messages):
                message = PERMISSION_ERROR_MESSAGE
            else:
                message = "Alibaba Cloud credentials were saved, but required read permissions failed."
        elif warnings:
            status = "degraded"
            message = "Alibaba Cloud credentials work, but some optional services need permissions."
        else:
            status = "healthy"
            message = "Alibaba Cloud credentials and read-only service permissions are reachable."
        return {"status": status, "message": message, "checks": checks}

    def list_assets(self) -> list[dict[str, Any]]:
        if not self.credentials:
            raise AliyunIntegrationError("Missing Alibaba Cloud account. Add a RAM AccessKey before syncing assets.")

        self.warnings.clear()
        assets: list[dict[str, Any]] = []
        assets.extend(self._safe_asset_call("Resource Center", self._list_resource_center_assets))
        assets.extend(self._safe_asset_call("Simple Application Server", self._list_swas_assets))
        assets.extend(self._safe_asset_call("ECS", self._list_ecs_assets))
        assets.extend(self._safe_asset_call("OSS", self._list_oss_assets))
        assets.extend(self._safe_asset_call("Domain", self._list_domain_assets))
        assets.extend(self._safe_asset_call("AliDNS", self._list_dns_assets))

        deduped: dict[tuple[str, str, str], dict[str, Any]] = {}
        for asset in assets:
            key = (asset["type"], asset["external_id"], asset.get("region", "global"))
            existing = deduped.get(key)
            if existing:
                existing["metadata_json"] = {**existing.get("metadata_json", {}), **asset.get("metadata_json", {})}
                if existing.get("status") in {"unknown", "active"} and asset.get("status") not in {None, "unknown"}:
                    existing["status"] = asset["status"]
            else:
                deduped[key] = asset

        if not deduped and self.warnings:
            raise AliyunIntegrationError(summarize_aliyun_warnings(self.warnings))
        final_assets = list(deduped.values())
        self._enrich_renewal_status(final_assets)
        return final_assets

    def query_metric(self, metric_name: str, instance_id: str, region: str | None = None) -> dict[str, Any]:
        if not self.credentials:
            return {"status": "error", "message": "Missing Alibaba Cloud account credentials."}
        if not instance_id:
            return {"status": "error", "message": "ECS instance_id is required for CloudMonitor checks."}

        metric_aliases = {
            "cpu_total": "CPUUtilization",
            "memory_used_percent": "memory_usedutilization",
            "disk_used_percent": "diskusage_utilization",
            "network_out": "InternetOutRate",
        }
        cms_metric = metric_aliases.get(metric_name, metric_name)
        end = datetime.now(timezone.utc)
        start = end - timedelta(minutes=15)
        try:
            client = self._cms_client(region)
            request = cms_models.DescribeMetricListRequest(
                namespace="acs_ecs_dashboard",
                metric_name=cms_metric,
                dimensions=json.dumps([{"instanceId": instance_id}]),
                start_time=start.strftime("%Y-%m-%d %H:%M:%S"),
                end_time=end.strftime("%Y-%m-%d %H:%M:%S"),
                period="60",
                length="20",
            )
            body = _response_body_map(client.describe_metric_list(request))
            datapoints = _json_maybe(body.get("Datapoints") or body.get("datapoints") or "[]")
            if not datapoints:
                return {"status": "error", "message": f"No CloudMonitor datapoints returned for {metric_name}."}
            latest = datapoints[-1]
            value = _first_number(latest, ["Average", "average", "Value", "value", "Maximum", "maximum"])
            if value is None:
                return {"status": "error", "message": f"CloudMonitor datapoint did not include a numeric value for {metric_name}."}
            return {
                "status": "ok",
                "metric": metric_name,
                "provider_metric": cms_metric,
                "instance_id": instance_id,
                "value": value,
                "unit": "%" if "percent" in metric_name or metric_name == "cpu_total" else "",
                "observed_at": latest.get("timestamp") or latest.get("Timestamp") or end.isoformat(),
            }
        except Exception as exc:
            return {"status": "error", "message": format_aliyun_error(exc)}

    def run_cloud_assistant(self, instance_id: str, command: str, region: str | None = None) -> dict[str, Any]:
        from app.services.monitoring import validate_cloud_assistant_command

        if not validate_cloud_assistant_command(command):
            return {"status": "blocked", "message": "Command is not in the read-only Cloud Assistant whitelist."}
        if not self.credentials:
            return {"status": "error", "message": "Missing Alibaba Cloud account credentials."}
        if not instance_id:
            return {"status": "error", "message": "ECS instance_id is required for Cloud Assistant checks."}

        try:
            client = self._ecs_client(region)
            encoded = base64.b64encode(command.encode("utf-8")).decode("ascii")
            request = ecs_models.RunCommandRequest(
                region_id=region or self.credentials.region,
                instance_id=[instance_id],
                command_content=encoded,
                content_encoding="Base64",
                type=_cloud_assistant_command_type(command),
                timeout=30,
                keep_command=False,
                name="local-ai-ops-readonly",
            )
            body = _response_body_map(client.run_command(request))
            command_id = body.get("CommandId") or body.get("command_id")
            invoke_id = body.get("InvokeId") or body.get("invoke_id")
            if not command_id and not invoke_id:
                return {"status": "error", "message": "Cloud Assistant did not return command_id or invoke_id."}

            output = self._wait_cloud_assistant_result(client, instance_id, command_id, invoke_id, region)
            return {"status": "ok", "instance_id": instance_id, "command": command, **output}
        except Exception as exc:
            return {"status": "error", "message": format_aliyun_error(exc)}

    def warning_messages(self) -> list[str]:
        return warning_messages(self.warnings)

    def _add_check(self, checks: list[dict[str, str]], name: str, probe: Any) -> None:
        try:
            probe()
            checks.append({"name": name, "status": "ok"})
        except Exception as exc:
            checks.append({"name": name, "status": "failed", "message": format_aliyun_error(exc)})

    def _add_optional_check(self, checks: list[dict[str, str]], name: str, probe: Any) -> None:
        try:
            probe()
            checks.append({"name": name, "status": "ok"})
        except Exception as exc:
            checks.append({"name": name, "status": "warning", "message": format_aliyun_error(exc)})

    def _probe_sts(self) -> None:
        self._sts_client().get_caller_identity()

    def _probe_resource_center(self) -> None:
        self._resource_center_client().get_resource_center_service_status()

    def _probe_ecs(self) -> None:
        request = ecs_models.DescribeRegionsRequest(accept_language="zh-CN")
        self._ecs_client().describe_regions(request)

    def _probe_cloud_monitor(self) -> None:
        request = cms_models.DescribeMetricListRequest(namespace="acs_ecs_dashboard", metric_name="CPUUtilization", length="1")
        self._cms_client().describe_metric_list(request)

    def _probe_bss_renewal(self) -> None:
        request = bss_models.QueryAvailableInstancesRequest(page_num=1, page_size=1)
        self._bss_client().query_available_instances(request)

    def _safe_asset_call(self, service: str, func: Any) -> list[dict[str, Any]]:
        try:
            return func()
        except Exception as exc:
            self.warnings.append(SyncWarning(service=service, message=format_aliyun_error(exc)))
            return []

    def _enrich_renewal_status(self, assets: list[dict[str, Any]]) -> None:
        instance_ids = [
            str(asset.get("external_id"))
            for asset in assets
            if asset.get("type") in {"ecs", "swas"} and asset.get("external_id")
        ]
        if not instance_ids:
            return
        try:
            renewal_by_id = self._query_renewal_status(instance_ids)
        except Exception as exc:
            self.warnings.append(SyncWarning(service="BssOpenAPI renewal", message=format_aliyun_error(exc)))
            return
        for asset in assets:
            info = renewal_by_id.get(str(asset.get("external_id")))
            if not info:
                continue
            metadata = asset.setdefault("metadata_json", {})
            metadata.update(
                {
                    "renew_status": info.get("renew_status"),
                    "auto_renew_enabled": info.get("auto_renew_enabled"),
                    "renewal_duration": info.get("renewal_duration"),
                    "renewal_duration_unit": info.get("renewal_duration_unit"),
                    "billing_end_time": info.get("end_time"),
                    "billing_product_code": info.get("product_code"),
                    "billing_product_type": info.get("product_type"),
                    "billing_subscription_type": info.get("subscription_type"),
                }
            )
            ops = metadata.get("ops") if isinstance(metadata.get("ops"), dict) else {}
            merged_ops = dict(ops)
            if info.get("end_time"):
                merged_ops["renewal_expires_at"] = _date_part(info["end_time"])
            if info.get("auto_renew_enabled") is not None:
                merged_ops["renewal_auto_renew"] = info["auto_renew_enabled"]
            metadata["ops"] = merged_ops

    def _query_renewal_status(self, instance_ids: list[str]) -> dict[str, dict[str, Any]]:
        client = self._bss_client()
        renewal: dict[str, dict[str, Any]] = {}
        for chunk in _chunks(list(dict.fromkeys(instance_ids)), 100):
            request = bss_models.QueryAvailableInstancesRequest(
                instance_ids=",".join(chunk),
                page_num=1,
                page_size=100,
            )
            while True:
                body = _response_body_map(client.query_available_instances(request))
                data = body.get("Data") or body.get("data") or {}
                instances = _as_list(_dig(data, ["InstanceList"]) or _dig(data, ["instance_list"]))
                for item in instances:
                    instance_id = item.get("InstanceID") or item.get("InstanceId") or item.get("instance_id") or item.get("instanceId")
                    if not instance_id:
                        continue
                    renew_status = item.get("RenewStatus") or item.get("renew_status")
                    renewal[str(instance_id)] = {
                        "renew_status": renew_status,
                        "auto_renew_enabled": _renew_status_to_bool(renew_status),
                        "renewal_duration": item.get("RenewalDuration") or item.get("renewal_duration"),
                        "renewal_duration_unit": item.get("RenewalDurationUnit") or item.get("renewal_duration_unit"),
                        "end_time": item.get("EndTime") or item.get("end_time"),
                        "product_code": item.get("ProductCode") or item.get("product_code"),
                        "product_type": item.get("ProductType") or item.get("product_type"),
                        "subscription_type": item.get("SubscriptionType") or item.get("subscription_type"),
                    }
                total = int(body.get("TotalCount") or body.get("total_count") or _dig(data, ["TotalCount"]) or _dig(data, ["total_count"]) or len(instances))
                if request.page_num * request.page_size >= total or not instances:
                    break
                request.page_num += 1
        return renewal

    def _list_resource_center_assets(self) -> list[dict[str, Any]]:
        client = self._resource_center_client()
        assets: list[dict[str, Any]] = []
        next_token: str | None = None
        while True:
            request = rc_models.SearchResourcesRequest(max_results=100, next_token=next_token)
            body = _response_body_map(client.search_resources(request))
            for item in _as_list(body.get("Resources") or body.get("resources")):
                asset = self._resource_center_asset(item)
                if asset:
                    assets.append(asset)
            next_token = body.get("NextToken") or body.get("next_token")
            if not next_token:
                return assets
        return assets

    def _resource_center_asset(self, item: dict[str, Any]) -> dict[str, Any] | None:
        resource_type = item.get("ResourceType") or item.get("resource_type")
        resource_id = item.get("ResourceId") or item.get("resource_id")
        name = item.get("ResourceName") or item.get("resource_name") or resource_id
        region = item.get("RegionId") or item.get("region_id") or "global"
        if not resource_type or not resource_id:
            return None
        type_map = {
            "ACS::ECS::Instance": "ecs",
            "ACS::SWAS::Instance": "swas",
            "ACS::OSS::Bucket": "oss",
            "ACS::Alidns::Domain": "dns",
            "ACS::DNS::Domain": "dns",
            "ACS::Domain::Domain": "domain",
        }
        asset_type = type_map.get(resource_type)
        if not asset_type:
            return None
        return {
            "type": asset_type,
            "name": str(name),
            "external_id": str(resource_id),
            "region": str(region),
            "status": "active",
            "metadata_json": {
                "source": "resource_center",
                "resource_type": resource_type,
                "resource_group_id": item.get("ResourceGroupId") or item.get("resource_group_id"),
                "zone_id": item.get("ZoneId") or item.get("zone_id"),
            },
        }

    def _list_ecs_assets(self) -> list[dict[str, Any]]:
        assets: list[dict[str, Any]] = []
        for region in self._discover_ecs_regions():
            try:
                assets.extend(self._list_ecs_assets_for_region(region))
            except Exception as exc:
                self.warnings.append(SyncWarning(service=f"ECS {region}", message=format_aliyun_error(exc)))
        return assets

    def _discover_ecs_regions(self) -> list[str]:
        try:
            body = _response_body_map(self._ecs_client().describe_regions(ecs_models.DescribeRegionsRequest(accept_language="zh-CN")))
            items = _as_list(_dig(body, ["Regions", "Region"]) or _dig(body, ["regions", "region"]))
            regions = [
                str(item.get("RegionId") or item.get("region_id"))
                for item in items
                if item.get("RegionId") or item.get("region_id")
            ]
        except Exception as exc:
            self.warnings.append(SyncWarning(service="ECS regions", message=f"Falling back to startup region: {format_aliyun_error(exc)}"))
            regions = []
        fallback = self.credentials.region if self.credentials else self.settings.aliyun_default_region
        ordered = [fallback, *regions]
        return list(dict.fromkeys(region for region in ordered if region))

    def _list_ecs_assets_for_region(self, region: str) -> list[dict[str, Any]]:
        client = self._ecs_client(region)
        assets: list[dict[str, Any]] = []
        page = 1
        while True:
            request = ecs_models.DescribeInstancesRequest(region_id=region, page_number=page, page_size=100)
            body = _response_body_map(client.describe_instances(request))
            instances = _as_list(_dig(body, ["Instances", "Instance"]) or _dig(body, ["instances", "instance"]))
            for item in instances:
                instance_id = item.get("InstanceId") or item.get("instance_id")
                if not instance_id:
                    continue
                public_ips = _string_list(_dig(item, ["PublicIpAddress", "IpAddress"]) or _dig(item, ["public_ip_address", "ip_address"]))
                private_ips = _string_list(_dig(item, ["VpcAttributes", "PrivateIpAddress", "IpAddress"]) or _dig(item, ["vpc_attributes", "private_ip_address", "ip_address"]))
                assets.append(
                    {
                        "type": "ecs",
                        "name": item.get("InstanceName") or item.get("instance_name") or instance_id,
                        "external_id": instance_id,
                        "region": item.get("RegionId") or item.get("region_id") or region,
                        "status": _status_lower(item.get("Status") or item.get("status")),
                        "metadata_json": {
                            "source": "ecs",
                            "zone_id": item.get("ZoneId") or item.get("zone_id"),
                            "instance_type": item.get("InstanceType") or item.get("instance_type"),
                            "os": item.get("OSName") or item.get("OSNameEn") or item.get("osname") or item.get("osname_en"),
                            "cpu": item.get("Cpu") or item.get("cpu"),
                            "memory_mb": item.get("Memory") or item.get("memory"),
                            "public_ips": public_ips,
                            "private_ips": private_ips,
                            "vpc_id": _dig(item, ["VpcAttributes", "VpcId"]) or _dig(item, ["vpc_attributes", "vpc_id"]),
                        },
                    }
                )
            total = int(body.get("TotalCount") or body.get("total_count") or len(assets))
            if page * 100 >= total or not instances:
                return assets
            page += 1

    def _list_swas_assets(self) -> list[dict[str, Any]]:
        assets: list[dict[str, Any]] = []
        for region in self._discover_swas_regions():
            try:
                assets.extend(self._list_swas_assets_for_region(region))
            except Exception as exc:
                self.warnings.append(SyncWarning(service=f"Simple Application Server {region}", message=format_aliyun_error(exc)))
        return assets

    def _discover_swas_regions(self) -> list[str]:
        try:
            body = _response_body_map(self._swas_client().list_regions(swas_models.ListRegionsRequest(accept_language="zh-CN")))
            items = _as_list(body.get("Regions") or body.get("regions"))
            regions = [
                str(item.get("RegionId") or item.get("region_id"))
                for item in items
                if item.get("RegionId") or item.get("region_id")
            ]
        except Exception as exc:
            self.warnings.append(SyncWarning(service="Simple Application Server regions", message=f"Falling back to startup region: {format_aliyun_error(exc)}"))
            regions = []
        fallback = self.credentials.region if self.credentials else self.settings.aliyun_default_region
        ordered = [fallback, *regions]
        return list(dict.fromkeys(region for region in ordered if region))

    def _list_swas_assets_for_region(self, region: str) -> list[dict[str, Any]]:
        client = self._swas_client(region)
        assets: list[dict[str, Any]] = []
        page = 1
        while True:
            request = swas_models.ListInstancesRequest(region_id=region, page_number=page, page_size=100)
            body = _response_body_map(client.list_instances(request))
            instances = _as_list(body.get("Instances") or body.get("instances"))
            for item in instances:
                asset = _swas_asset_from_instance(item, region)
                if asset:
                    assets.append(asset)
            total = int(body.get("TotalCount") or body.get("total_count") or len(assets))
            if page * 100 >= total or not instances:
                return assets
            page += 1

    def _list_oss_assets(self) -> list[dict[str, Any]]:
        client = self._oss_client()
        assets: list[dict[str, Any]] = []
        marker: str | None = None
        while True:
            request = oss_models.ListBucketsRequest(marker=marker, max_keys=100)
            body = _response_body_map(client.list_buckets(request))
            buckets = _as_list(body.get("buckets") or _dig(body, ["Buckets", "Bucket"]) or body.get("Bucket"))
            for item in buckets:
                name = item.get("name") or item.get("Name")
                if not name:
                    continue
                assets.append(
                    {
                        "type": "oss",
                        "name": name,
                        "external_id": f"oss:{name}",
                        "region": item.get("region") or item.get("Region") or item.get("location") or item.get("Location") or "global",
                        "status": "active",
                        "metadata_json": {
                            "source": "oss",
                            "storage_class": item.get("storage_class") or item.get("StorageClass"),
                            "creation_date": item.get("creation_date") or item.get("CreationDate"),
                            "extranet_endpoint": item.get("extranet_endpoint") or item.get("ExtranetEndpoint"),
                            "intranet_endpoint": item.get("intranet_endpoint") or item.get("IntranetEndpoint"),
                        },
                    }
                )
            is_truncated = body.get("is_truncated") or body.get("IsTruncated")
            marker = body.get("next_marker") or body.get("NextMarker")
            if not is_truncated or not marker:
                return assets

    def _list_domain_assets(self) -> list[dict[str, Any]]:
        client = self._domain_client()
        assets: list[dict[str, Any]] = []
        page = 1
        while True:
            request = domain_models.QueryDomainListRequest(page_num=page, page_size=100)
            body = _response_body_map(client.query_domain_list(request))
            domains = _as_list(_dig(body, ["Data", "Domain"]) or _dig(body, ["data", "domain"]))
            for item in domains:
                name = item.get("DomainName") or item.get("domain_name")
                if not name:
                    continue
                domain_status = item.get("DomainStatus") or item.get("domain_status") or "active"
                assets.append(
                    {
                        "type": "domain",
                        "name": name,
                        "external_id": item.get("InstanceId") or item.get("instance_id") or f"domain:{name}",
                        "region": "global",
                        "status": _domain_status(domain_status),
                        "metadata_json": {
                            "source": "domain",
                            "domain_status_code": domain_status,
                            "expiration_date": item.get("ExpirationDate") or item.get("expiration_date"),
                            "expiration_date_long": item.get("ExpirationDateLong") or item.get("expiration_date_long"),
                            "auto_renew_enabled": item.get("AutoRenewEnabled") or item.get("auto_renew_enabled"),
                            "registrar": item.get("Registrar") or item.get("registrar"),
                        },
                    }
                )
            total_pages = int(body.get("TotalPageNum") or body.get("total_page_num") or page)
            if page >= total_pages or not domains:
                return assets
            page += 1

    def _list_dns_assets(self) -> list[dict[str, Any]]:
        client = self._dns_client()
        domains: list[dict[str, Any]] = []
        records: list[dict[str, Any]] = []
        page = 1
        while True:
            request = dns_models.DescribeDomainsRequest(page_number=page, page_size=100)
            body = _response_body_map(client.describe_domains(request))
            items = _as_list(_dig(body, ["Domains", "Domain"]) or _dig(body, ["domains", "domain"]))
            domains.extend(items)
            total = int(body.get("TotalCount") or body.get("total_count") or len(domains))
            if page * 100 >= total or not items:
                break
            page += 1

        for domain in domains[:25]:
            domain_name = domain.get("DomainName") or domain.get("domain_name")
            if not domain_name:
                continue
            records.extend(self._list_dns_records(client, domain_name))

        assets = []
        for item in domains:
            name = item.get("DomainName") or item.get("domain_name")
            if name:
                assets.append(
                    {
                        "type": "dns",
                        "name": name,
                        "external_id": item.get("DomainId") or item.get("domain_id") or f"dns-domain:{name}",
                        "region": "global",
                        "status": "active",
                        "metadata_json": {
                            "source": "alidns",
                            "record_count": item.get("RecordCount") or item.get("record_count"),
                            "version_name": item.get("VersionName") or item.get("version_name"),
                        },
                    }
                )
        for item in records:
            record_id = item.get("RecordId") or item.get("record_id")
            rr = item.get("RR") or item.get("rr")
            domain_name = item.get("DomainName") or item.get("domain_name")
            value = item.get("Value") or item.get("value")
            if not record_id:
                continue
            assets.append(
                {
                    "type": "dns",
                    "name": f"{rr}.{domain_name}".strip(".") if rr and domain_name else str(record_id),
                    "external_id": str(record_id),
                    "region": "global",
                    "status": _status_lower(item.get("Status") or item.get("status") or "active"),
                    "metadata_json": {
                        "source": "alidns",
                        "record_type": item.get("Type") or item.get("type"),
                        "value": value,
                        "ttl": item.get("TTL") or item.get("ttl"),
                        "line": item.get("Line") or item.get("line"),
                    },
                }
            )
        return assets

    def _list_dns_records(self, client: DnsClient, domain_name: str) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        page = 1
        while True:
            request = dns_models.DescribeDomainRecordsRequest(domain_name=domain_name, page_number=page, page_size=100)
            body = _response_body_map(client.describe_domain_records(request))
            items = _as_list(_dig(body, ["DomainRecords", "Record"]) or _dig(body, ["domain_records", "record"]))
            records.extend(items)
            total = int(body.get("TotalCount") or body.get("total_count") or len(records))
            if page * 100 >= total or not items:
                return records
            page += 1

    def _wait_cloud_assistant_result(
        self,
        client: EcsClient,
        instance_id: str,
        command_id: str | None,
        invoke_id: str | None,
        region: str | None,
    ) -> dict[str, str]:
        for _ in range(10):
            time.sleep(1)
            request = ecs_models.DescribeInvocationResultsRequest(
                region_id=region or self.credentials.region,
                command_id=command_id,
                invoke_id=invoke_id,
                instance_id=instance_id,
                page_size=1,
            )
            body = _response_body_map(client.describe_invocation_results(request))
            result = _first_invocation_result(body)
            if not result:
                continue
            status = result.get("InvocationStatus") or result.get("invocation_status") or result.get("InvokeRecordStatus") or result.get("invoke_record_status")
            if status in {"Finished", "Success", "Failed"}:
                stdout = _decode_output(result.get("Output") or result.get("output") or "")
                return {
                    "stdout": stdout,
                    "stderr": redact_text(result.get("ErrorInfo") or result.get("error_info") or ""),
                    "exit_code": str(result.get("ExitCode") or result.get("exit_code") or ""),
                }
        return {"stdout": "", "stderr": "Cloud Assistant result timed out.", "exit_code": ""}

    def _config(self, region: str | None = None, endpoint: str | None = None) -> Config:
        if not self.credentials:
            raise AliyunIntegrationError("Missing Alibaba Cloud credentials.")
        return Config(
            access_key_id=self.credentials.access_key_id,
            access_key_secret=self.credentials.access_key_secret,
            region_id=region or self.credentials.region,
            endpoint=endpoint,
            connect_timeout=5000,
            read_timeout=10000,
        )

    def _sts_client(self) -> StsClient:
        return StsClient(self._config(endpoint="sts.aliyuncs.com"))

    def _ecs_client(self, region: str | None = None) -> EcsClient:
        return EcsClient(self._config(region=region))

    def _cms_client(self, region: str | None = None) -> CmsClient:
        resolved_region = region or (self.credentials.region if self.credentials else self.settings.aliyun_default_region)
        return CmsClient(self._config(region=resolved_region, endpoint=f"metrics.{resolved_region}.aliyuncs.com"))

    def _resource_center_client(self) -> ResourceCenterClient:
        return ResourceCenterClient(self._config())

    def _swas_client(self, region: str | None = None) -> SwasClient:
        resolved_region = region or (self.credentials.region if self.credentials else self.settings.aliyun_default_region)
        return SwasClient(self._config(region=resolved_region, endpoint=f"swas.{resolved_region}.aliyuncs.com"))

    def _dns_client(self) -> DnsClient:
        return DnsClient(self._config())

    def _domain_client(self) -> DomainClient:
        return DomainClient(self._config())

    def _oss_client(self) -> OssClient:
        endpoint = f"oss-{self.credentials.region}.aliyuncs.com" if self.credentials else None
        return OssClient(self._config(endpoint=endpoint))

    def _bss_client(self) -> BssClient:
        return BssClient(self._config(endpoint="business.aliyuncs.com"))

    def _error_result(self, message: str) -> dict[str, Any]:
        return {"status": "error", "message": format_aliyun_error(message), "checks": [{"name": "Alibaba Cloud credentials", "status": "failed"}]}


def format_aliyun_error(error: Exception | str) -> str:
    text = redact_text(str(error))
    if _contains_any(text, SIGNATURE_ERROR_MARKERS):
        return SIGNATURE_ERROR_MESSAGE
    if _contains_any(text, PERMISSION_ERROR_MARKERS):
        return PERMISSION_ERROR_MESSAGE
    if _contains_any(text, NETWORK_TIMEOUT_MARKERS):
        return NETWORK_TIMEOUT_MESSAGE
    text = _collapse_sdk_debug(text)
    if len(text) > 900:
        return f"{text[:900].rstrip()}..."
    return text


def summarize_aliyun_warnings(warnings: list[SyncWarning]) -> str:
    messages = warning_messages(warnings)
    return "; ".join(messages)


def warning_messages(warnings: list[SyncWarning]) -> list[str]:
    if any(_is_signature_error_message(f"{warning.service}: {warning.message}") for warning in warnings):
        return [SIGNATURE_ERROR_MESSAGE]
    if any(_is_permission_error_message(f"{warning.service}: {warning.message}") for warning in warnings):
        return [PERMISSION_ERROR_MESSAGE]

    grouped: dict[str, list[str]] = {}
    for warning in warnings:
        grouped.setdefault(warning.message, []).append(warning.service)

    messages: list[str] = []
    for message, services in grouped.items():
        service_label = ", ".join(services[:3])
        if len(services) > 3:
            service_label = f"{service_label}, +{len(services) - 3} more"
        messages.append(_limit_message(f"{service_label}: {message}"))
    return messages


def _contains_any(text: str, markers: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(marker.lower() in lowered for marker in markers)


def _is_signature_error_message(text: str) -> bool:
    return "signature verification failed" in text.lower() or _contains_any(text, SIGNATURE_ERROR_MARKERS)


def _is_permission_error_message(text: str) -> bool:
    return "permission denied" in text.lower() or _contains_any(text, PERMISSION_ERROR_MARKERS)


def _limit_message(text: str, limit: int = 900) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}..."


def _collapse_sdk_debug(text: str) -> str:
    for pattern in SDK_DEBUG_PATTERNS:
        text = re.sub(pattern, "SDK signing debug is redacted", text, flags=re.DOTALL)
    return text


def _response_body_map(response: Any) -> dict[str, Any]:
    body = getattr(response, "body", response)
    if hasattr(body, "to_map"):
        return body.to_map()
    if isinstance(body, dict):
        return body
    return {}


def _dig(value: dict[str, Any], path: list[str]) -> Any:
    current: Any = value
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _as_list(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        return [value]
    return []


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item]
    return [str(value)]


def _chunks(values: list[str], size: int) -> list[list[str]]:
    return [values[index:index + size] for index in range(0, len(values), size)]


def _renew_status_to_bool(value: Any) -> bool | None:
    if value is None:
        return None
    normalized = str(value).strip()
    if normalized == "AutoRenewal":
        return True
    if normalized in {"ManualRenewal", "NotRenewal"}:
        return False
    return None


def _swas_asset_from_instance(item: dict[str, Any], region: str) -> dict[str, Any] | None:
    instance_id = item.get("InstanceId") or item.get("instance_id")
    if not instance_id:
        return None
    name = item.get("InstanceName") or item.get("instance_name") or instance_id
    public_ip = item.get("PublicIpAddress") or item.get("public_ip_address")
    private_ip = item.get("InnerIpAddress") or item.get("inner_ip_address")
    expired_time = item.get("ExpiredTime") or item.get("expired_time")
    resource_spec = _dig(item, ["ResourceSpec"]) or _dig(item, ["resource_spec"]) or {}
    image = _dig(item, ["Image"]) or _dig(item, ["image"]) or {}
    image_name = image.get("ImageName") or image.get("image_name")
    network_attributes = _as_list(item.get("NetworkAttributes") or item.get("network_attributes"))
    if not public_ip and network_attributes:
        public_ip = network_attributes[0].get("PublicIpAddress") or network_attributes[0].get("public_ip_address")
    if not private_ip and network_attributes:
        private_ip = network_attributes[0].get("PrivateIpAddress") or network_attributes[0].get("private_ip_address")

    ops: dict[str, Any] = {
        "login_url": "https://swas.console.aliyun.com/",
    }
    if expired_time:
        ops["renewal_expires_at"] = _date_part(expired_time)

    return {
        "type": "swas",
        "name": str(name),
        "external_id": str(instance_id),
        "region": str(item.get("RegionId") or item.get("region_id") or region),
        "status": _status_lower(item.get("Status") or item.get("status") or "unknown"),
        "metadata_json": {
            "source": "swas",
            "public_ip_address": public_ip,
            "inner_ip_address": private_ip,
            "creation_time": item.get("CreationTime") or item.get("creation_time"),
            "expired_time": expired_time,
            "charge_type": item.get("ChargeType") or item.get("charge_type"),
            "business_status": item.get("BusinessStatus") or item.get("business_status"),
            "ddos_status": item.get("DdosStatus") or item.get("ddos_status"),
            "plan_id": item.get("PlanId") or item.get("plan_id"),
            "plan_type": item.get("PlanType") or item.get("plan_type"),
            "cpu": resource_spec.get("Cpu") or resource_spec.get("cpu"),
            "memory_gb": resource_spec.get("Memory") or resource_spec.get("memory"),
            "disk_size_gb": resource_spec.get("DiskSize") or resource_spec.get("disk_size"),
            "bandwidth_mbps": resource_spec.get("Bandwidth") or resource_spec.get("bandwidth"),
            "traffic_gb": resource_spec.get("Flow") or resource_spec.get("flow"),
            "image_name": image_name,
            "image_type": image.get("ImageType") or image.get("image_type"),
            "image_version": image.get("ImageVersion") or image.get("image_version"),
            "os_type": image.get("OsType") or image.get("os_type"),
            "ops": ops,
        },
    }


def _date_part(value: Any) -> str:
    text = str(value)
    if "T" in text:
        return text.split("T", 1)[0]
    if " " in text:
        return text.split(" ", 1)[0]
    return text[:10] if len(text) >= 10 else text


def _status_lower(value: Any) -> str:
    if value is None:
        return "unknown"
    return str(value).lower()


def _domain_status(value: Any) -> str:
    normalized = str(value).strip().lower() if value is not None else ""
    if normalized == "1":
        return "urgent_renewal"
    if normalized == "2":
        return "urgent_redemption"
    if normalized == "3":
        return "active"
    return _status_lower(value)


def _json_maybe(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return [item for item in parsed if isinstance(item, dict)] if isinstance(parsed, list) else []
    return []


def _first_number(data: dict[str, Any], keys: list[str]) -> float | None:
    for key in keys:
        value = data.get(key)
        if value is None:
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


def _first_invocation_result(body: dict[str, Any]) -> dict[str, Any] | None:
    result = _dig(body, ["Invocation", "InvocationResults", "InvocationResult"]) or _dig(
        body, ["invocation", "invocation_results", "invocation_result"]
    )
    items = _as_list(result)
    return items[0] if items else None


def _decode_output(value: str) -> str:
    if not value:
        return ""
    try:
        return base64.b64decode(value).decode("utf-8", errors="replace")
    except Exception:
        return value


def _cloud_assistant_command_type(command: str) -> str:
    if command.startswith("Get-"):
        return "RunPowerShellScript"
    return "RunShellScript"
