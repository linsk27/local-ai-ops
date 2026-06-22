import re
import socket
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from io import StringIO
from typing import Any
from urllib.parse import urlparse

import httpx
import paramiko


COMMAND_WHITELIST = [
    re.compile(r"^df\s+-h$"),
    re.compile(r"^free\s+-m$"),
    re.compile(r"^ss\s+-lntp$"),
    re.compile(r"^systemctl\s+status\s+[A-Za-z0-9_.@-]+$"),
    re.compile(r"^Get-PSDrive\s+-PSProvider\s+FileSystem$"),
    re.compile(r"^Get-CimInstance\s+Win32_OperatingSystem$"),
    re.compile(r"^Get-NetTCPConnection\s+-State\s+Listen$"),
]


@dataclass
class ProbeResult:
    status: str
    latency_ms: float | None
    value: float | None
    message: str
    details: dict[str, Any]


def validate_cloud_assistant_command(command: str) -> bool:
    normalized = " ".join(command.strip().split())
    return any(pattern.match(normalized) for pattern in COMMAND_WHITELIST)


def run_http_check(target: str, timeout_seconds: int) -> ProbeResult:
    started = time.perf_counter()
    try:
        response = httpx.get(target, timeout=timeout_seconds, follow_redirects=True)
        latency = (time.perf_counter() - started) * 1000
        ok = 200 <= response.status_code < 400
        return ProbeResult(
            status="ok" if ok else "failed",
            latency_ms=round(latency, 2),
            value=float(response.status_code),
            message=f"HTTP {response.status_code}",
            details={"url": str(response.url), "status_code": response.status_code},
        )
    except Exception as exc:
        return ProbeResult("failed", None, None, str(exc), {"target": target})


def run_tcp_check(target: str, timeout_seconds: int) -> ProbeResult:
    host, port = _parse_host_port(target)
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout_seconds):
            latency = (time.perf_counter() - started) * 1000
            return ProbeResult("ok", round(latency, 2), 1.0, f"TCP {host}:{port} connected", {"host": host, "port": port})
    except Exception as exc:
        return ProbeResult("failed", None, 0.0, str(exc), {"host": host, "port": port})


def run_ssh_check(
    target: str,
    timeout_seconds: int,
    username: str | None = None,
    password: str | None = None,
    private_key: str | None = None,
) -> ProbeResult:
    host, port = _parse_host_port(target, default_port=22)
    if not username or not (password or private_key):
        return ProbeResult("failed", None, 0.0, "SSH credentials are not configured for this check.", {"host": host, "port": port})
    started = time.perf_counter()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        pkey = _load_private_key(private_key) if private_key else None
        client.connect(
            hostname=host,
            port=port,
            username=username,
            password=password if not pkey else None,
            pkey=pkey,
            timeout=timeout_seconds,
            banner_timeout=timeout_seconds,
        )
        latency = (time.perf_counter() - started) * 1000
        return ProbeResult("ok", round(latency, 2), 1.0, "SSH login succeeded", {"host": host, "port": port})
    except Exception as exc:
        return ProbeResult("failed", None, 0.0, str(exc), {"host": host, "port": port})
    finally:
        client.close()


def run_ssh_command_check(
    target: str,
    timeout_seconds: int,
    command: str,
    username: str | None = None,
    password: str | None = None,
    private_key: str | None = None,
) -> ProbeResult:
    host, port = _parse_host_port(target, default_port=22)
    if not validate_cloud_assistant_command(command):
        return ProbeResult("failed", None, None, "Command is not in the read-only whitelist.", {"host": host, "port": port, "command": command})
    if not username or not (password or private_key):
        return ProbeResult("failed", None, None, "SSH credentials are not configured for this check.", {"host": host, "port": port, "command": command})

    started = time.perf_counter()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        pkey = _load_private_key(private_key) if private_key else None
        client.connect(
            hostname=host,
            port=port,
            username=username,
            password=password if not pkey else None,
            pkey=pkey,
            timeout=timeout_seconds,
            banner_timeout=timeout_seconds,
        )
        _, stdout, stderr = client.exec_command(command, timeout=timeout_seconds)
        exit_code = stdout.channel.recv_exit_status()
        latency = (time.perf_counter() - started) * 1000
        stdout_text = stdout.read().decode("utf-8", errors="replace")
        stderr_text = stderr.read().decode("utf-8", errors="replace")
        return ProbeResult(
            "ok" if exit_code == 0 else "failed",
            round(latency, 2),
            None,
            "SSH read-only command completed" if exit_code == 0 else "SSH read-only command failed",
            {"host": host, "port": port, "command": command, "stdout": stdout_text, "stderr": stderr_text, "exit_code": exit_code},
        )
    except Exception as exc:
        return ProbeResult("failed", None, None, str(exc), {"host": host, "port": port, "command": command})
    finally:
        client.close()


def _load_private_key(private_key: str | None) -> paramiko.PKey | None:
    if not private_key:
        return None
    errors: list[Exception] = []
    for key_cls in (paramiko.Ed25519Key, paramiko.ECDSAKey, paramiko.RSAKey, paramiko.DSSKey):
        try:
            return key_cls.from_private_key(StringIO(private_key))
        except Exception as exc:
            errors.append(exc)
    raise errors[-1]


def parse_disk_percent(df_output: str) -> float | None:
    for line in df_output.splitlines():
        match = re.search(r"\s(\d{1,3})%\s+/$", line)
        if match:
            return float(match.group(1))
    return None


def parse_memory_percent(free_output: str) -> float | None:
    for line in free_output.splitlines():
        if line.startswith("Mem:"):
            parts = [part for part in line.split() if part.isdigit()]
            if len(parts) >= 2 and int(parts[0]) > 0:
                return round((int(parts[1]) / int(parts[0])) * 100, 2)
    return None


def result_timestamp() -> datetime:
    return datetime.now(timezone.utc)


def _parse_host_port(target: str, default_port: int | None = None) -> tuple[str, int]:
    if "://" in target:
        parsed = urlparse(target)
        host = parsed.hostname or target
        port = parsed.port or default_port or (443 if parsed.scheme == "https" else 80)
        return host, port
    if ":" in target:
        host, port_text = target.rsplit(":", 1)
        return host, int(port_text)
    if default_port is None:
        raise ValueError("Target must include a port, for example example.com:443")
    return target, default_port
