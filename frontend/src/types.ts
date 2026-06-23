export interface CloudAccount {
  id: number;
  name: string;
  provider: string;
  default_region: string;
  access_key_id_masked: string;
  status: string;
  last_tested_at: string | null;
  last_error: string | null;
}

export interface AuthSession {
  access_token: string;
  token_type: string;
  expires_at: string;
  username: string;
  default_password: boolean;
}

export interface AuthMe {
  username: string;
  auth_enabled: boolean;
  default_password: boolean;
}

export interface Asset {
  id: number;
  cloud_account_id: number | null;
  provider: string;
  type: string;
  name: string;
  external_id: string;
  region: string;
  status: string;
  metadata_json: Record<string, unknown>;
  runtime_metrics: Record<string, unknown>;
  last_seen_at: string | null;
}

export interface ServerAccessProfile {
  asset_id: number;
  method: string;
  host: string;
  username: string;
  port: number;
  enabled: boolean;
  secret_configured: boolean;
  notes: string;
}

export interface BtPanelProfile {
  asset_id: number;
  url: string;
  username: string;
  enabled: boolean;
  password_configured: boolean;
  notes: string;
}

export interface Check {
  id: number;
  asset_id: number | null;
  name: string;
  type: string;
  target: string;
  interval_seconds: number;
  timeout_seconds: number;
  threshold: number | null;
  failure_threshold: number;
  enabled: boolean;
  config_json: Record<string, unknown>;
  asset_name: string | null;
  asset_type: string | null;
  asset_region: string | null;
  last_status: string | null;
  last_message: string | null;
  last_value: number | null;
  last_latency_ms: number | null;
  last_checked_at: string | null;
  open_alert_id: number | null;
  open_alert_status: string | null;
  result_count: number;
}

export interface CheckResult {
  id: number;
  check_id: number;
  asset_id: number | null;
  status: string;
  latency_ms: number | null;
  value: number | null;
  message: string;
  details_json: Record<string, unknown>;
  checked_at: string;
}

export interface Alert {
  id: number;
  check_id: number | null;
  asset_id: number | null;
  severity: string;
  status: string;
  title: string;
  message: string;
  failure_count: number;
  created_at: string;
  updated_at: string;
  acknowledged_at: string | null;
  closed_at: string | null;
}

export interface Diagnosis {
  id: number;
  alert_id: number | null;
  asset_id: number | null;
  summary: string;
  root_causes: string[];
  steps: string[];
  commands: Array<{ command: string; reason: string }>;
  context_json: Record<string, unknown>;
  model: string;
  created_at: string;
}

export interface DashboardSummary {
  assets_total: number;
  assets_by_type: Record<string, number>;
  open_alerts: number;
  checks_total: number;
  website_uptime: number;
  risk_items: Array<{ asset_id: number; asset: string; kind: string; value: number }>;
}

export interface AiConfig {
  base_url: string;
  model: string;
  api_key_masked: string;
  configured: boolean;
  source: string;
}

export interface AiConfigTestResult {
  status: string;
  message: string;
  base_url: string;
  model: string;
  latency_ms: number | null;
}
