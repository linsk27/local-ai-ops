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
  data_quality: AssetDataQuality;
  last_seen_at: string | null;
}

export interface AssetCollectionStatus {
  status: string;
  message: string;
  checked_at: string | null;
  check_type: string;
  target: string;
  value?: number | null;
  latency_ms?: number | null;
}

export interface AssetDataQuality {
  field_sources: Record<string, string>;
  collection: AssetCollectionStatus;
  gaps: string[];
  recommended_actions: string[];
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

export interface MonitorGroup {
  id: number;
  name: string;
  type: string;
  description: string;
  status: string;
  asset_ids: number[];
  asset_count: number;
  check_count: number;
  failing_count: number;
  last_checked_at: string | null;
}

export interface Check {
  id: number;
  asset_id: number | null;
  group_id: number | null;
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
  group_name: string | null;
  group_type: string | null;
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
  website_uptime: number | null;
  website_uptime_ok: number;
  website_uptime_total: number;
  website_uptime_checked_at: string | null;
  website_uptime_window: string;
  risk_summary: Array<{ kind: string; count: number; severity: string }>;
  risk_items: Array<{ asset_id: number; asset: string; asset_type?: string; kind: string; value: number | null; severity?: string }>;
}

export interface KnowledgeSummary {
  assets_total: number;
  server_total: number;
  open_alerts: number;
  checks_total: number;
  expiring_soon: number;
  credential_configured: number;
  top_regions: Array<{ region: string; count: number }>;
  top_risks: Array<{ asset_id: number; asset: string; asset_type?: string; kind: string; value: number | null; severity?: string }>;
  suggested_questions: string[];
}

export interface KnowledgeAnswer {
  question: string;
  intent: string;
  answer: string;
  evidence: Array<Record<string, unknown>>;
  actions: string[];
}

export interface AssetGraphNode {
  id: string;
  asset_id: number;
  label: string;
  type: string;
  region: string;
  status: string;
}

export interface AssetGraphEdge {
  source: string;
  target: string;
  relation: string;
  confidence: string;
}

export interface AssetGraph {
  nodes: AssetGraphNode[];
  edges: AssetGraphEdge[];
}

export interface RenewalItem {
  asset_id: number;
  name: string;
  type: string;
  region: string;
  expires_at: string | null;
  days_left: number | null;
  auto_renew: boolean | null;
  status: string;
  source: string;
  console_url: string | null;
}

export interface RenewalCenter {
  total: number;
  expiring_soon: number;
  expired: number;
  auto_renew_enabled: number;
  unknown: number;
  items: RenewalItem[];
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
