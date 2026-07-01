import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Cloud,
  Copy,
  Database,
  ExternalLink,
  Gauge,
  Globe2,
  CircleHelp,
  KeyRound,
  LockKeyhole,
  LogOut,
  Play,
  RefreshCcw,
  Save,
  Server,
  Settings,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  XCircle
} from "lucide-react";
import type { EChartsOption } from "echarts";
import { FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ApiAuthError, apiDelete, apiGet, apiPatch, apiPost, apiPut, clearAuthToken, getAuthToken, setAuthToken } from "./api";
import { LoginPage, StartupScreen } from "./components/AuthScreens";
import { FilterToolbar, type FilterToolbarFilter } from "./components/FilterToolbar";
import type { AiConfig, AiConfigTestResult, Alert, Asset, AssetGraph, AuthMe, AuthSession, BtPanelProfile, Check, CheckResult, CloudAccount, DashboardSummary, Diagnosis, KnowledgeAnswer, KnowledgeSummary, MonitorGroup, RenewalCenter, RenewalItem, ServerAccessProfile } from "./types";

type View = "overview" | "accounts" | "assets" | "asset-detail" | "checks" | "alerts" | "diagnosis" | "knowledge" | "graph" | "renewals" | "ai-settings";
type NavView = Exclude<View, "asset-detail">;
type Locale = "zh" | "en";
type LocalizedDiagnosis = Diagnosis & { locale: Locale };
type CheckFilter = "all" | "failing" | "ok" | "never" | "disabled";
type ChartDatum = { name: string; value: number };
type ExpiryDatum = { name: string; days: number; date: string; region: string };
type RuntimeCollection = { asset: Asset; results: CheckResult[] };
type DetailRow = { label: string; value: React.ReactNode; mono?: boolean; source?: string };
type AssetFilter = "all" | "server" | "oss" | "domain" | "dns";
type ConfirmDialogOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: "default" | "danger";
};

const assetFilters: AssetFilter[] = ["all", "server", "oss", "domain", "dns"];
const assetPageSizeOptions = [10, 20, 50];
const riskOverviewKinds = ["disk_high", "memory_high", "expiring", "access_missing", "usage_missing"];
const ALIYUN_RENEWAL_URL = "https://billing-cost.console.aliyun.com/fortune/fund-management/recharge";

const EChart = lazy(() => import("./EChart"));

const mainViews: Array<{ id: NavView; icon: typeof Gauge }> = [
  { id: "overview", icon: Gauge },
  { id: "assets", icon: Database },
  { id: "checks", icon: Activity },
  { id: "alerts", icon: AlertTriangle },
  { id: "diagnosis", icon: Bot },
  { id: "knowledge", icon: BookOpen },
  { id: "renewals", icon: CalendarClock }
];

const utilityViews: Array<{ id: NavView; icon: typeof Gauge }> = [
  { id: "accounts", icon: KeyRound },
  { id: "ai-settings", icon: Settings }
];

const copy = {
  zh: {
    brand: "阿里云本地运维",
    connected: "已连接",
    connecting: "正在连接本地 API...",
    refresh: "刷新数据",
    nav: {
      overview: "总览",
      accounts: "云账号",
      assets: "资产",
      checks: "监控",
      alerts: "告警",
      diagnosis: "AI 诊断",
      "ai-settings": "AI 配置"
    },
    titles: {
      overview: "运维态势",
      accounts: "云账号接入",
      assets: "资源资产",
      "asset-detail": "资产详情",
      checks: "监控编排",
      alerts: "告警列表",
      diagnosis: "AI 诊断",
      "ai-settings": "AI 配置"
    },
    metrics: {
      assets: "资源总数",
      alerts: "开放告警",
      checks: "监控项",
      uptime: "网站探活成功率"
    },
    panels: {
      assetDistribution: "资产分布",
      regionDistribution: "地域分布",
      uptimeChart: "网站探活成功率",
      renewalTimeline: "服务器到期",
      riskQueue: "风险概览",
      recentAlerts: "最近告警",
      addAccount: "添加 RAM 账号",
      accounts: "已接入账号",
      assets: "云资产",
      assetProfile: "资产资料",
      opsProfile: "续费与入口",
      accessProfile: "SSH 访问",
      btPanel: "宝塔面板",
      quickActions: "下一步",
      createCheck: "创建监控项",
      checks: "监控项",
      results: "最近结果",
      alerts: "告警列表",
      diagnosisSource: "诊断对象",
      diagnosis: "AI 诊断建议",
      aiSettings: "AI 接口配置",
      aiStatus: "当前 AI 状态"
    },
    actions: {
      viewAssets: "查看资产",
      openAlerts: "进入告警列表",
      saveEncrypted: "保存并加密",
      syncAssets: "同步资产",
      details: "详情",
      backToAssets: "返回资产",
      saveOps: "保存资料",
      saveAccess: "保存访问资料",
      createAssetCheck: "创建监控",
      test: "测试",
      sync: "同步",
      createCheck: "创建监控",
      collectRuntime: "采集使用率",
      run: "执行",
      diagnose: "诊断",
      acknowledge: "确认",
      close: "关闭",
      saveAiConfig: "保存 AI 配置",
      clearAiKey: "清除 Key",
      testAiConfig: "测试连接",
      delete: "删除",
      openConsole: "控制台",
      openService: "业务入口",
      openBtPanel: "打开面板",
      btLoginHelper: "登录助手",
      openAndCopyPassword: "打开并复制密码",
      saveBtPanel: "保存面板资料",
      copyUsername: "复制账号",
      copyPassword: "复制密码",
      copySshPassword: "复制 SSH 密码",
      copySshKey: "复制 SSH 私钥"
    },
    table: {
      name: "名称",
      key: "Key",
      region: "地域",
      status: "状态",
      action: "操作",
      asset: "资产",
      type: "类型",
      network: "网络",
      spec: "规格",
      usage: "使用率",
      expires: "到期",
      renewal: "续费",
      target: "目标",
      threshold: "阈值",
      severity: "级别",
      failures: "失败"
    },
    form: {
      accountName: "名称",
      accessKeyId: "AccessKey ID",
      accessKeySecret: "AccessKey Secret",
      defaultRegion: "起始地域",
      checkName: "名称",
      checkType: "类型",
      checkTarget: "目标",
      linkedAsset: "关联资产",
      optionalThreshold: "可选，如 90",
      failureThreshold: "连续失败次数",
      noAsset: "不关联",
      renewalExpiresAt: "到期时间",
      renewalAutoRenew: "自动续费状态",
      renewalNotes: "续费备注",
      renewalUnknown: "未开启/未确认",
      renewalEnabled: "已开启",
      serviceUrl: "业务入口 URL",
      loginUrl: "控制台/登录入口",
      accessMethod: "访问方式",
      accessHost: "连接主机",
      accessUsername: "登录用户",
      accessPort: "端口",
      accessSecret: "密码或私钥",
      accessNotes: "访问备注",
      accessEnabled: "启用该访问资料",
      btPanelUrl: "面板地址",
      btPanelUsername: "面板账号",
      btPanelPassword: "面板密码",
      btPanelNotes: "面板备注",
      btPanelEnabled: "启用该面板资料",
      clearBtPanelPassword: "清除已保存面板密码",
      aiBaseUrl: "Base URL",
      aiApiKey: "API Key",
      aiModel: "模型"
    },
    empty: {
      noAssets: "暂无资产",
      noRisks: "暂无风险",
      noAlerts: "暂无告警",
      noDiagnosis: "暂无诊断"
    },
    diagnosis: {
      causes: "可能原因",
      steps: "排查步骤",
      commands: "建议命令（只展示，不自动执行）"
    },
    settings: {
      keyConfigured: "已配置",
      keyMissing: "未配置",
      secretConfigured: "密钥/密码已加密保存",
      secretPlaceholder: "留空保留现有密钥/密码",
      source: "来源",
      database: "本地数据库",
      environment: "环境变量",
      encryptedHint: "Key 已加密保存",
      keepKeyHint: "留空则保持当前 Key。",
      passwordConfigured: "密码已加密保存",
      btLoginHint: "外部宝塔登录页不会被自动填表或提交；请手动粘贴已复制的账号/密码。"
    }
  },
  en: {
    brand: "Local Alibaba Cloud Ops",
    connected: "Connected",
    connecting: "Connecting to local API...",
    refresh: "Refresh data",
    nav: {
      overview: "Overview",
      accounts: "Accounts",
      assets: "Assets",
      checks: "Checks",
      alerts: "Alerts",
      diagnosis: "AI Diagnosis",
      "ai-settings": "AI Config"
    },
    titles: {
      overview: "Ops Posture",
      accounts: "Cloud Accounts",
      assets: "Resource Inventory",
      "asset-detail": "Asset Detail",
      checks: "Monitoring",
      alerts: "Alert List",
      diagnosis: "AI Diagnosis",
      "ai-settings": "AI Config"
    },
    metrics: {
      assets: "Assets",
      alerts: "Open Alerts",
      checks: "Checks",
      uptime: "HTTP Probe Success"
    },
    panels: {
      assetDistribution: "Asset Distribution",
      regionDistribution: "Region Distribution",
      uptimeChart: "HTTP Probe Success",
      renewalTimeline: "Server Expiry",
      riskQueue: "Risk Overview",
      recentAlerts: "Recent Alerts",
      addAccount: "Add RAM Account",
      accounts: "Connected Accounts",
      assets: "Cloud Assets",
      assetProfile: "Asset Profile",
      opsProfile: "Renewal and Entrypoints",
      accessProfile: "SSH Access",
      btPanel: "BT Panel",
      quickActions: "Next Steps",
      createCheck: "Create Check",
      checks: "Checks",
      results: "Recent Results",
      alerts: "Alert List",
      diagnosisSource: "Diagnosis Source",
      diagnosis: "AI Recommendations",
      aiSettings: "AI Endpoint Config",
      aiStatus: "Current AI Status"
    },
    actions: {
      viewAssets: "View Assets",
      openAlerts: "Open Alerts",
      saveEncrypted: "Save Encrypted",
      syncAssets: "Sync Assets",
      details: "Details",
      backToAssets: "Back to Assets",
      saveOps: "Save Profile",
      saveAccess: "Save Access",
      createAssetCheck: "Create Check",
      test: "Test",
      sync: "Sync",
      createCheck: "Create Check",
      collectRuntime: "Collect Usage",
      run: "Run",
      diagnose: "Diagnose",
      acknowledge: "Acknowledge",
      close: "Close",
      saveAiConfig: "Save AI Config",
      clearAiKey: "Clear Key",
      testAiConfig: "Test",
      delete: "Delete",
      openConsole: "Console",
      openService: "Service",
      openBtPanel: "Open Panel",
      btLoginHelper: "Login Helper",
      openAndCopyPassword: "Open and Copy Password",
      saveBtPanel: "Save Panel Profile",
      copyUsername: "Copy Username",
      copyPassword: "Copy Password",
      copySshPassword: "Copy SSH Password",
      copySshKey: "Copy SSH Key"
    },
    table: {
      name: "Name",
      key: "Key",
      region: "Region",
      status: "Status",
      action: "Action",
      asset: "Asset",
      type: "Type",
      network: "Network",
      spec: "Spec",
      usage: "Usage",
      expires: "Expires",
      renewal: "Renewal",
      target: "Target",
      threshold: "Threshold",
      severity: "Severity",
      failures: "Failures"
    },
    form: {
      accountName: "Name",
      accessKeyId: "AccessKey ID",
      accessKeySecret: "AccessKey Secret",
      defaultRegion: "Startup Region",
      checkName: "Name",
      checkType: "Type",
      checkTarget: "Target",
      linkedAsset: "Linked Asset",
      optionalThreshold: "Optional, e.g. 90",
      failureThreshold: "Failure Count",
      noAsset: "None",
      renewalExpiresAt: "Expiration Date",
      renewalAutoRenew: "Auto-renew Status",
      renewalNotes: "Renewal Notes",
      renewalUnknown: "Off or unknown",
      renewalEnabled: "Enabled",
      serviceUrl: "Service URL",
      loginUrl: "Console/Login URL",
      accessMethod: "Access Method",
      accessHost: "Host",
      accessUsername: "Username",
      accessPort: "Port",
      accessSecret: "Password or Private Key",
      accessNotes: "Access Notes",
      accessEnabled: "Enable this access profile",
      btPanelUrl: "Panel URL",
      btPanelUsername: "Panel Username",
      btPanelPassword: "Panel Password",
      btPanelNotes: "Panel Notes",
      btPanelEnabled: "Enable this panel profile",
      clearBtPanelPassword: "Clear saved panel password",
      aiBaseUrl: "Base URL",
      aiApiKey: "API Key",
      aiModel: "Model"
    },
    empty: {
      noAssets: "No assets",
      noRisks: "No risks",
      noAlerts: "No alerts",
      noDiagnosis: "No diagnosis"
    },
    diagnosis: {
      causes: "Possible Causes",
      steps: "Triage Steps",
      commands: "Suggested Commands (display only)"
    },
    settings: {
      keyConfigured: "Configured",
      keyMissing: "Not configured",
      secretConfigured: "Secret encrypted and saved",
      secretPlaceholder: "Leave blank to keep the current secret",
      source: "Source",
      database: "Local database",
      environment: "Environment",
      encryptedHint: "Key encrypted",
      keepKeyHint: "Leave blank to keep the current key.",
      passwordConfigured: "Password encrypted and saved",
      btLoginHint: "The external BT login page is not auto-filled or submitted. Paste the copied username/password manually."
    }
  }
} as const;

const initialDashboard: DashboardSummary = {
  assets_total: 0,
  assets_by_type: {},
  open_alerts: 0,
  checks_total: 0,
  website_uptime: null,
  website_uptime_ok: 0,
  website_uptime_total: 0,
  website_uptime_checked_at: null,
  website_uptime_window: "latest_50_http_checks",
  risk_summary: [],
  risk_items: []
};

const initialAiConfig: AiConfig = {
  base_url: "",
  model: "gpt-4.1-mini",
  api_key_masked: "",
  configured: false,
  source: "environment"
};

const initialKnowledgeSummary: KnowledgeSummary = {
  assets_total: 0,
  server_total: 0,
  open_alerts: 0,
  checks_total: 0,
  expiring_soon: 0,
  credential_configured: 0,
  top_regions: [],
  top_risks: [],
  suggested_questions: []
};

const initialAssetGraph: AssetGraph = {
  nodes: [],
  edges: []
};

const initialRenewalCenter: RenewalCenter = {
  total: 0,
  expiring_soon: 0,
  expired: 0,
  auto_renew_enabled: 0,
  unknown: 0,
  items: []
};

const emptyAccessProfile: ServerAccessProfile = {
  asset_id: 0,
  method: "cloud_assistant",
  host: "",
  username: "",
  port: 22,
  enabled: true,
  secret_configured: false,
  notes: ""
};

const emptyBtPanelProfile: BtPanelProfile = {
  asset_id: 0,
  url: "",
  username: "",
  enabled: true,
  password_configured: false,
  notes: ""
};

export function App(): JSX.Element {
  const [activeView, setActiveView] = useState<View>("overview");
  const [locale, setLocale] = useState<Locale>("zh");
  const [dashboard, setDashboard] = useState<DashboardSummary>(initialDashboard);
  const [accounts, setAccounts] = useState<CloudAccount[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [monitorGroups, setMonitorGroups] = useState<MonitorGroup[]>([]);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [diagnoses, setDiagnoses] = useState<LocalizedDiagnosis[]>([]);
  const [aiConfig, setAiConfig] = useState<AiConfig>(initialAiConfig);
  const [aiTestResult, setAiTestResult] = useState<AiConfigTestResult | null>(null);
  const [knowledgeSummary, setKnowledgeSummary] = useState<KnowledgeSummary>(initialKnowledgeSummary);
  const [knowledgeQuestion, setKnowledgeQuestion] = useState("");
  const [knowledgeAnswer, setKnowledgeAnswer] = useState<KnowledgeAnswer | null>(null);
  const [assetGraph, setAssetGraph] = useState<AssetGraph>(initialAssetGraph);
  const [renewalCenter, setRenewalCenter] = useState<RenewalCenter>(initialRenewalCenter);
  const [selectedAssetType, setSelectedAssetType] = useState<AssetFilter>("all");
  const [assetSearch, setAssetSearch] = useState("");
  const [selectedAssetRegion, setSelectedAssetRegion] = useState("all");
  const [selectedAssetStatus, setSelectedAssetStatus] = useState("all");
  const [assetPage, setAssetPage] = useState(1);
  const [assetPageSize, setAssetPageSize] = useState(10);
  const [selectedCheckFilter, setSelectedCheckFilter] = useState<CheckFilter>("all");
  const [selectedMonitorGroup, setSelectedMonitorGroup] = useState("all");
  const [checkPage, setCheckPage] = useState(1);
  const [alertPage, setAlertPage] = useState(1);
  const [authChecked, setAuthChecked] = useState(false);
  const [authMe, setAuthMe] = useState<AuthMe | null>(null);
  const [loginForm, setLoginForm] = useState({ username: "admin", password: "" });
  const [loginNotice, setLoginNotice] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [accessProfile, setAccessProfile] = useState<ServerAccessProfile>(emptyAccessProfile);
  const [btPanelProfile, setBtPanelProfile] = useState<BtPanelProfile>(emptyBtPanelProfile);
  const t = copy[locale];
  const [notice, setNotice] = useState<string>("");
  const [busyAction, setBusyAction] = useState<string>("");
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [checkModalOpen, setCheckModalOpen] = useState(false);
  const [opsModalOpen, setOpsModalOpen] = useState(false);
  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const [btPanelModalOpen, setBtPanelModalOpen] = useState(false);
  const [aiConfigModalOpen, setAiConfigModalOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogOptions | null>(null);
  const confirmResolver = useRef<((confirmed: boolean) => void) | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [accountForm, setAccountForm] = useState({
    name: "",
    access_key_id: "",
    access_key_secret: "",
    default_region: ""
  });
  const [checkForm, setCheckForm] = useState({
    name: "",
    type: "http",
    target: "",
    asset_id: "",
    group_id: "",
    interval_seconds: "300",
    threshold: "",
    failure_threshold: "2"
  });
  const [opsForm, setOpsForm] = useState({
    renewal_expires_at: "",
    renewal_auto_renew: false,
    renewal_notes: "",
    service_url: "",
    login_url: ""
  });
  const [accessForm, setAccessForm] = useState({
    method: "cloud_assistant",
    host: "",
    username: "",
    port: "22",
    secret: "",
    clear_secret: false,
    enabled: true,
    notes: ""
  });
  const [btPanelForm, setBtPanelForm] = useState({
    url: "",
    username: "",
    password: "",
    clear_password: false,
    enabled: true,
    notes: ""
  });
  const [aiConfigForm, setAiConfigForm] = useState({
    base_url: "",
    api_key: "",
    model: "gpt-4.1-mini"
  });
  const uptimeHasData = dashboard.website_uptime_total > 0 && typeof dashboard.website_uptime === "number" && Number.isFinite(dashboard.website_uptime);
  const uptimeValue = uptimeHasData ? dashboard.website_uptime as number : null;
  const uptimeMetricValue = uptimeValue !== null ? `${uptimeValue}%` : (locale === "zh" ? "未采集" : "No data");
  const uptimeMetricNote = dashboard.website_uptime_total > 0
    ? locale === "zh"
      ? `${dashboard.website_uptime_ok}/${dashboard.website_uptime_total} 探活样本`
      : `${dashboard.website_uptime_ok}/${dashboard.website_uptime_total} probe samples`
    : locale === "zh"
      ? "暂无 HTTP 样本"
      : "No HTTP samples";
  const uptimeMetricTone: "neutral" | "good" | "warn" | "bad" = uptimeValue === null
    ? "neutral"
    : uptimeValue >= 99
      ? "good"
      : uptimeValue >= 95
        ? "warn"
        : "bad";
  const uptimeCaption = formatUptimeCaption(dashboard, locale);

  const filteredAssets = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    return assets.filter((asset) => {
      if (!assetMatchesType(asset, selectedAssetType)) {
        return false;
      }
      if (selectedAssetRegion !== "all" && asset.region !== selectedAssetRegion) {
        return false;
      }
      if (selectedAssetStatus !== "all" && asset.status !== selectedAssetStatus) {
        return false;
      }
      if (!query) {
        return true;
      }
      return assetSearchText(asset, locale).includes(query);
    });
  }, [assetSearch, assets, locale, selectedAssetRegion, selectedAssetStatus, selectedAssetType]);
  const assetFilterCounts = useMemo(() => {
    return assetFilters.reduce<Record<AssetFilter, number>>((counts, type) => {
      counts[type] = type === "all"
        ? assets.length
        : type === "server"
          ? assets.filter((asset) => ["ecs", "swas"].includes(asset.type)).length
          : assets.filter((asset) => asset.type === type).length;
      return counts;
    }, { all: 0, server: 0, oss: 0, domain: 0, dns: 0 });
  }, [assets]);
  const assetRegionOptions = useMemo(
    () => Array.from(new Set(assets.map((asset) => asset.region).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [assets]
  );
  const assetStatusOptions = useMemo(
    () => Array.from(new Set(assets.map((asset) => asset.status).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [assets]
  );
  const assetFilterControls = useMemo<FilterToolbarFilter[]>(
    () => [
      {
        id: "region",
        label: locale === "zh" ? "地域" : "Region",
        value: selectedAssetRegion,
        onChange: setSelectedAssetRegion,
        options: [
          { value: "all", label: locale === "zh" ? "全部地域" : "All regions" },
          ...assetRegionOptions.map((region) => ({ value: region, label: region }))
        ]
      },
      {
        id: "status",
        label: locale === "zh" ? "状态" : "Status",
        value: selectedAssetStatus,
        onChange: setSelectedAssetStatus,
        options: [
          { value: "all", label: locale === "zh" ? "全部状态" : "All statuses" },
          ...assetStatusOptions.map((status) => ({ value: status, label: statusLabel(status, locale) }))
        ]
      }
    ],
    [assetRegionOptions, assetStatusOptions, locale, selectedAssetRegion, selectedAssetStatus]
  );
  const hasActiveAssetFilters = Boolean(
    assetSearch.trim() ||
    selectedAssetType !== "all" ||
    selectedAssetRegion !== "all" ||
    selectedAssetStatus !== "all"
  );
  const assetPageTotal = Math.max(1, Math.ceil(filteredAssets.length / assetPageSize));
  const currentAssetPage = Math.min(assetPage, assetPageTotal);
  const paginatedAssets = useMemo(
    () => filteredAssets.slice((currentAssetPage - 1) * assetPageSize, currentAssetPage * assetPageSize),
    [filteredAssets, currentAssetPage, assetPageSize]
  );
  const assetRangeStart = filteredAssets.length === 0 ? 0 : (currentAssetPage - 1) * assetPageSize + 1;
  const assetRangeEnd = Math.min(filteredAssets.length, currentAssetPage * assetPageSize);
  const checkSummary = useMemo(() => summarizeChecks(checks), [checks]);
  const failingChecks = useMemo(
    () => checks.filter((check) => checkStatusForDisplay(check) === "failed"),
    [checks]
  );
  const alertSummary = useMemo(() => summarizeAlerts(alerts), [alerts]);
  const monitorGroupOptions = useMemo(
    () => [
      { id: "all", name: locale === "zh" ? "全部监控" : "All checks", type: "all", checkCount: checks.length, failingCount: checkSummary.failing },
      {
        id: "ungrouped",
        name: locale === "zh" ? "未分组" : "Ungrouped",
        type: "custom",
        checkCount: checks.filter((check) => !check.group_id).length,
        failingCount: checks.filter((check) => !check.group_id && checkStatusForDisplay(check) === "failed").length
      },
      ...monitorGroups.map((group) => ({
        id: String(group.id),
        name: group.name,
        type: group.type,
        checkCount: group.check_count,
        failingCount: group.failing_count
      }))
    ],
    [checkSummary.failing, checks, locale, monitorGroups]
  );
  const groupScopedChecks = useMemo(
    () => checks.filter((check) => checkMatchesGroup(check, selectedMonitorGroup)),
    [checks, selectedMonitorGroup]
  );
  const filteredChecks = useMemo(
    () => groupScopedChecks.filter((check) => checkMatchesFilter(check, selectedCheckFilter)),
    [groupScopedChecks, selectedCheckFilter]
  );
  const listPageSize = 10;
  const checkPageTotal = Math.max(1, Math.ceil(filteredChecks.length / listPageSize));
  const currentCheckPage = Math.min(checkPage, checkPageTotal);
  const paginatedChecks = useMemo(
    () => filteredChecks.slice((currentCheckPage - 1) * listPageSize, currentCheckPage * listPageSize),
    [filteredChecks, currentCheckPage]
  );
  const alertPageTotal = Math.max(1, Math.ceil(alerts.length / listPageSize));
  const currentAlertPage = Math.min(alertPage, alertPageTotal);
  const paginatedAlerts = useMemo(
    () => alerts.slice((currentAlertPage - 1) * listPageSize, currentAlertPage * listPageSize),
    [alerts, currentAlertPage]
  );

  const activeDiagnosis = diagnoses.find((diagnosis) => diagnosis.locale === locale);
  const activeCheckTypeInfo = checkTypeDescription(checkForm.type, locale);
  const refreshLabel = refreshActionLabel(activeView, locale);
  const quietNotices = [copy.zh.connected, copy.en.connected, copy.zh.connecting, copy.en.connecting];
  const showNotice = Boolean(notice && !quietNotices.some((item) => item === notice));
  const assetDistributionRows = useMemo(
    () => Object.entries(dashboard.assets_by_type).map(([type, count]) => ({ name: assetTypeLabel(type, locale), value: count })),
    [dashboard.assets_by_type, locale]
  );
  const regionDistributionRows = useMemo(() => summarizeRegions(assets), [assets]);
  const expiryRows = useMemo(() => upcomingServerExpiries(assets), [assets]);
  const assetDistributionOption = useMemo(() => buildAssetDistributionOption(assetDistributionRows, locale), [assetDistributionRows, locale]);
  const regionDistributionOption = useMemo(() => buildRegionDistributionOption(regionDistributionRows, locale), [regionDistributionRows, locale]);
  const uptimeOption = useMemo(
    () => buildUptimeOption(dashboard.website_uptime, locale, dashboard.website_uptime_ok, dashboard.website_uptime_total),
    [dashboard.website_uptime, dashboard.website_uptime_ok, dashboard.website_uptime_total, locale]
  );
  const expiryOption = useMemo(() => buildExpiryOption(expiryRows, locale), [expiryRows, locale]);
  const assetGraphOption = useMemo(() => buildAssetGraphOption(assetGraph, locale), [assetGraph, locale]);
  const assetGraphNodeMap = useMemo(() => new Map(assetGraph.nodes.map((node) => [node.id, node])), [assetGraph.nodes]);

  useEffect(() => {
    setAssetPage(1);
  }, [assetPageSize, assetSearch, selectedAssetRegion, selectedAssetStatus, selectedAssetType]);

  useEffect(() => {
    setCheckPage(1);
  }, [selectedCheckFilter, selectedMonitorGroup]);

  useEffect(() => {
    if (selectedMonitorGroup === "all" || selectedMonitorGroup === "ungrouped") {
      return;
    }
    if (!monitorGroups.some((group) => String(group.id) === selectedMonitorGroup)) {
      setSelectedMonitorGroup("all");
    }
  }, [monitorGroups, selectedMonitorGroup]);

  useEffect(() => {
    setAssetPage((page) => Math.min(Math.max(page, 1), assetPageTotal));
  }, [assetPageTotal]);

  useEffect(() => {
    setCheckPage((page) => Math.min(Math.max(page, 1), checkPageTotal));
  }, [checkPageTotal]);

  useEffect(() => {
    setAlertPage((page) => Math.min(Math.max(page, 1), alertPageTotal));
  }, [alertPageTotal]);

  useEffect(() => {
    if (!showNotice || busyAction) {
      return;
    }
    const timeout = window.setTimeout(() => setNotice(""), noticeDismissDelay(notice));
    return () => window.clearTimeout(timeout);
  }, [busyAction, notice, showNotice]);

  useEffect(() => {
    if (!userMenuOpen) {
      return;
    }
    const closeMenu = () => setUserMenuOpen(false);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [userMenuOpen]);

  function handleAuthFailure(error?: unknown): void {
    clearAuthToken();
    setAuthMe(null);
    setAuthChecked(true);
    setBusyAction("");
    setCheckModalOpen(false);
    setConfirmDialog(null);
    if (error instanceof ApiAuthError) {
      setNotice(locale === "zh" ? "登录已过期，请重新登录。" : "Session expired. Please sign in again.");
    }
  }

  async function refreshAll(options: { quiet?: boolean; throwOnError?: boolean } = {}): Promise<void> {
    try {
      const [nextDashboard, nextAccounts, nextAssets, nextChecks, nextMonitorGroups, nextResults, nextAlerts, nextAiConfig, nextKnowledge, nextGraph, nextRenewals] = await Promise.all([
        apiGet<DashboardSummary>("/dashboard"),
        apiGet<CloudAccount[]>("/cloud-accounts"),
        apiGet<Asset[]>("/assets"),
        apiGet<Check[]>("/checks"),
        apiGet<MonitorGroup[]>("/monitor-groups"),
        apiGet<CheckResult[]>("/check-results"),
        apiGet<Alert[]>("/alerts"),
        apiGet<AiConfig>("/settings/ai"),
        apiGet<KnowledgeSummary>("/knowledge/summary"),
        apiGet<AssetGraph>("/asset-graph"),
        apiGet<RenewalCenter>("/renewals")
      ]);
      setDashboard(nextDashboard);
      setAccounts(nextAccounts);
      setAssets(nextAssets);
      setSelectedAsset((current) => {
        if (!current) {
          return current;
        }
        return nextAssets.find((asset) => asset.id === current.id) ?? current;
      });
      setChecks(nextChecks);
      setMonitorGroups(nextMonitorGroups);
      setResults(nextResults);
      setAlerts(nextAlerts);
      setAiConfig(nextAiConfig);
      setKnowledgeSummary(nextKnowledge);
      setAssetGraph(nextGraph);
      setRenewalCenter(nextRenewals);
      setAiConfigForm((current) => ({
        ...current,
        base_url: nextAiConfig.base_url,
        model: nextAiConfig.model || current.model,
        api_key: ""
      }));
      if (!options.quiet) {
        setNotice(copy[locale].connected);
      }
    } catch (error) {
      if (error instanceof ApiAuthError) {
        handleAuthFailure(error);
        if (options.throwOnError) {
          throw error;
        }
        return;
      }
      setNotice(presentNotice(error instanceof Error ? error.message : "无法连接本地 API", locale));
      if (options.throwOnError) {
        throw error;
      }
    }
  }

  useEffect(() => {
    void initializeSession();
  }, []);

  useEffect(() => {
    if (!authMe) {
      return;
    }
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && !busyAction) {
        void refreshAll({ quiet: true });
      }
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [authMe, busyAction]);

  async function initializeSession(): Promise<void> {
    if (!getAuthToken()) {
      setNotice("");
      setLoginNotice("");
      setAuthChecked(true);
      return;
    }
    try {
      const me = await apiGet<AuthMe>("/auth/me");
      setAuthMe(me);
      setAuthChecked(true);
      await refreshAll({ quiet: true, throwOnError: true });
    } catch (error) {
      if (error instanceof ApiAuthError) {
        handleAuthFailure(error);
      } else {
        clearAuthToken();
        setAuthMe(null);
        setNotice("");
        setLoginNotice("");
        setAuthChecked(true);
      }
    }
  }

  async function withBusy<T>(label: string, action: () => Promise<T>): Promise<T | undefined> {
    setBusyAction(label);
    setNotice(busyNotice(label, locale));
    try {
      const result = await action();
      await refreshAll({ quiet: true });
      return result;
    } catch (error) {
      if (error instanceof ApiAuthError) {
        handleAuthFailure(error);
        return undefined;
      }
      setNotice(presentNotice(error instanceof Error ? error.message : "操作失败", locale));
      return undefined;
    } finally {
      setBusyAction("");
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusyAction("login");
    setLoginNotice("");
    setNotice(locale === "zh" ? "正在登录..." : "Signing in...");
    try {
      const session = await apiPost<AuthSession>("/auth/login", {
        username: loginForm.username.trim(),
        password: loginForm.password
      });
      const accessToken = session.access_token?.trim();
      if (!accessToken) {
        throw new Error(locale === "zh" ? "登录接口未返回 token" : "Login response did not include a token");
      }
      setAuthToken(accessToken);
      setAuthMe({
        username: session.username,
        auth_enabled: true,
        default_password: session.default_password
      });
      setLoginForm((current) => ({ ...current, password: "" }));
      setLoginNotice("");
      setNotice(session.default_password && locale === "zh" ? "已登录。请尽快修改默认管理员密码。" : locale === "zh" ? "已登录。" : "Signed in.");
      await refreshAll({ quiet: true, throwOnError: true });
    } catch (error) {
      if (error instanceof ApiAuthError) {
        clearAuthToken();
        setAuthMe(null);
        setAuthChecked(true);
      }
      setNotice("");
      setLoginNotice(presentLoginNotice(error instanceof Error ? error.message : "Login failed", locale));
    } finally {
      setBusyAction("");
      setAuthChecked(true);
    }
  }

  async function handleKnowledgeQuery(questionOverride?: string): Promise<void> {
    const question = (questionOverride ?? knowledgeQuestion).trim();
    if (!question) {
      setNotice(locale === "zh" ? "请输入要查询的问题。" : "Enter a question first.");
      return;
    }
    setKnowledgeQuestion(question);
    await withBusy("knowledge-query", async () => {
      const answer = await apiPost<KnowledgeAnswer>("/knowledge/query", { question, locale });
      setKnowledgeAnswer(answer);
      setNotice(locale === "zh" ? "本地知识库已生成回答。" : "Local knowledge answer generated.");
    });
  }

  async function handleLogout(): Promise<void> {
    try {
      await apiPost<{ ok: boolean }>("/auth/logout");
    } catch {
      // Local logout is client-side; the API call is best-effort.
    }
    clearAuthToken();
    setAuthMe(null);
    setNotice("");
  }

  async function handleManualRefresh(): Promise<void> {
    setBusyAction("refresh");
    const zh = locale === "zh";
    try {
      setNotice(zh ? "正在刷新本地数据..." : "Refreshing local data...");
      await refreshAll({ quiet: true, throwOnError: true });
      setNotice(zh ? "本地数据已刷新。" : "Local data refreshed.");
    } catch (error) {
      if (error instanceof ApiAuthError) {
        handleAuthFailure(error);
        return;
      }
      setNotice(presentNotice(error instanceof Error ? error.message : "刷新失败", locale));
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const createdAccount = await withBusy("create-account", async () => {
      const account = await apiPost<CloudAccount>("/cloud-accounts", {
        name: accountForm.name.trim(),
        access_key_id: accountForm.access_key_id.trim(),
        access_key_secret: accountForm.access_key_secret.trim(),
        default_region: accountForm.default_region.trim() || "cn-hangzhou"
      });
      setAccountForm({
        name: "",
        access_key_id: "",
        access_key_secret: "",
        default_region: ""
      });
      setNotice(`已添加云账号：${account.name}`);
      return account;
    });
    if (createdAccount) {
      setAccountModalOpen(false);
    }
  }

  async function handleTestAccount(account: CloudAccount): Promise<void> {
    await withBusy(`test-${account.id}`, async () => {
      const result = await apiPost<{ status: string; message: string }>(`/cloud-accounts/${account.id}/test`);
      setNotice(presentNotice(result.message, locale));
      return result;
    });
  }

  async function handleSyncAssets(accountId?: number): Promise<void> {
    await withBusy("sync-assets", async () => {
      setNotice(locale === "zh" ? "正在同步云资产，会调用阿里云 OpenAPI..." : "Syncing cloud assets via Alibaba Cloud OpenAPI...");
      const result = await apiPost<{ synced: number; message: string }>("/assets/sync", { account_id: accountId ?? null });
      setNotice(`资产同步完成：${result.synced} 个资源`);
      return result;
    });
  }

  function requestConfirm(options: ConfirmDialogOptions): Promise<boolean> {
    if (confirmResolver.current) {
      confirmResolver.current(false);
    }
    setConfirmDialog(options);
    return new Promise((resolve) => {
      confirmResolver.current = resolve;
    });
  }

  function resolveConfirm(confirmed: boolean): void {
    confirmResolver.current?.(confirmed);
    confirmResolver.current = null;
    setConfirmDialog(null);
  }

  async function handleDeleteAccount(account: CloudAccount): Promise<void> {
    const confirmed = await requestConfirm({
      title: locale === "zh" ? "删除云账号" : "Delete cloud account",
      message: locale === "zh"
        ? `确定删除云账号「${account.name}」？已同步资产会保留，但会解除账号关联。`
        : `Delete cloud account "${account.name}"? Synced assets stay, but the account linkage is removed.`,
      confirmLabel: locale === "zh" ? "删除账号" : "Delete account",
      cancelLabel: locale === "zh" ? "取消" : "Cancel",
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }
    await withBusy(`delete-account-${account.id}`, async () => {
      const result = await apiDelete<{ deleted: boolean; detached_assets: number }>(`/cloud-accounts/${account.id}`);
      setNotice(
        locale === "zh"
          ? `云账号已删除，${result.detached_assets} 个资产已解除关联。`
          : `Cloud account deleted. ${result.detached_assets} assets detached.`
      );
      return result;
    });
  }

  async function handleDeleteFailedAccounts(): Promise<void> {
    const failedAccounts = accounts.filter((account) => account.status === "error");
    if (failedAccounts.length === 0) {
      setNotice(locale === "zh" ? "当前没有错误状态的云账号。" : "There are no cloud accounts in error state.");
      return;
    }
    const confirmed = await requestConfirm({
      title: locale === "zh" ? "删除错误账号" : "Delete failed accounts",
      message: locale === "zh"
        ? `确定删除 ${failedAccounts.length} 个错误状态云账号？已同步资产会保留，但会解除账号关联。`
        : `Delete ${failedAccounts.length} failed cloud accounts? Synced assets stay, but account links are removed.`,
      confirmLabel: locale === "zh" ? "删除错误账号" : "Delete failed accounts",
      cancelLabel: locale === "zh" ? "取消" : "Cancel",
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }
    await withBusy("delete-failed-accounts", async () => {
      const results = await Promise.all(
        failedAccounts.map((account) => apiDelete<{ deleted: boolean; detached_assets: number }>(`/cloud-accounts/${account.id}`))
      );
      const detachedAssets = results.reduce((sum, result) => sum + result.detached_assets, 0);
      setNotice(
        locale === "zh"
          ? `已删除 ${failedAccounts.length} 个错误账号，${detachedAssets} 个资产已解除关联。`
          : `Deleted ${failedAccounts.length} failed accounts. ${detachedAssets} assets detached.`
      );
      return results;
    });
  }

  function populateAssetDetailForms(asset: Asset, profile: ServerAccessProfile, panelProfile: BtPanelProfile): void {
    const ops = metadataSection(asset.metadata_json, "ops");
    setSelectedAsset(asset);
    setAccessProfile(profile);
    setBtPanelProfile(panelProfile);
    setOpsForm({
      renewal_expires_at: textValue(ops.renewal_expires_at),
      renewal_auto_renew: Boolean(ops.renewal_auto_renew),
      renewal_notes: textValue(ops.renewal_notes),
      service_url: textValue(ops.service_url),
      login_url: textValue(ops.login_url)
    });
    setAccessForm({
      method: profile.method || "cloud_assistant",
      host: profile.host || defaultAssetHost(asset),
      username: defaultAccessUsername(profile.method || "cloud_assistant", profile.username),
      port: String(profile.port || 22),
      secret: "",
      clear_secret: false,
      enabled: profile.enabled,
      notes: profile.notes || ""
    });
    setBtPanelForm({
      url: panelProfile.url || "",
      username: panelProfile.username || "",
      password: "",
      clear_password: false,
      enabled: panelProfile.enabled,
      notes: panelProfile.notes || ""
    });
  }

  function syncBtPanelProfileToAsset(profile: BtPanelProfile): void {
    const updateAsset = (asset: Asset): Asset => {
      if (asset.id !== profile.asset_id) {
        return asset;
      }
      const currentPanel = metadataSection(asset.metadata_json, "bt_panel");
      return {
        ...asset,
        metadata_json: {
          ...asset.metadata_json,
          bt_panel: {
            ...currentPanel,
            url: profile.url,
            username: profile.username,
            enabled: profile.enabled,
            notes: profile.notes
          }
        }
      };
    };

    setSelectedAsset((current) => (current?.id === profile.asset_id ? updateAsset(current) : current));
    setAssets((current) => current.map(updateAsset));
  }

  async function handleOpenAssetDetail(asset: Asset): Promise<void> {
    await withBusy(`asset-detail-${asset.id}`, async () => {
      const [freshAsset, profile, panelProfile] = await Promise.all([
        apiGet<Asset>(`/assets/${asset.id}`),
        apiGet<ServerAccessProfile>(`/assets/${asset.id}/access-profile`),
        apiGet<BtPanelProfile>(`/assets/${asset.id}/bt-panel`)
      ]);
      populateAssetDetailForms(freshAsset, profile, panelProfile);
      setActiveView("asset-detail");
      setNotice(locale === "zh" ? "资产详情已加载。" : "Asset details loaded.");
      return freshAsset;
    });
  }

  async function handleSaveAssetOps(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedAsset) {
      return;
    }
    const updatedAsset = await withBusy(`asset-ops-${selectedAsset.id}`, async () => {
      const updated = await apiPatch<Asset>(`/assets/${selectedAsset.id}/ops`, opsForm);
      setSelectedAsset(updated);
      setAssets((current) => current.map((asset) => (asset.id === updated.id ? updated : asset)));
      setNotice(locale === "zh" ? "资产续费与入口资料已保存。" : "Asset renewal and entrypoint profile saved.");
      return updated;
    });
    if (updatedAsset) {
      setOpsModalOpen(false);
    }
  }

  async function handleSaveAccessProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedAsset) {
      return;
    }
    const accessUsesSecret = accessForm.method !== "cloud_assistant";
    const accessUsername = defaultAccessUsername(accessForm.method, accessForm.username);
    const hasSavedSecret = accessProfile.secret_configured && !accessForm.clear_secret;
    const hasNewSecret = accessForm.secret.trim().length > 0;
    if (accessUsesSecret && !accessUsername) {
      setNotice(
        locale === "zh"
          ? "SSH 访问必须填写登录用户，常见为 root；输入框里的 root 只是占位提示，不会自动保存。"
          : "SSH access requires a login username, commonly root. The root placeholder is not saved automatically."
      );
      return;
    }
    if (accessUsesSecret && !hasSavedSecret && !hasNewSecret) {
      setNotice(
        locale === "zh"
          ? "首次配置 SSH 密码/私钥时必须填写服务器登录凭据。忘记密码请先到阿里云重置实例登录密码；如果已能进服务器终端，也可执行 passwd root 设置。"
          : "First SSH setup requires the server login password or private key. Reset it in Alibaba Cloud, or run passwd root if you already have a server shell."
      );
      return;
    }
    const savedProfile = await withBusy(`asset-access-${selectedAsset.id}`, async () => {
      const profile = await apiPut<ServerAccessProfile>(`/assets/${selectedAsset.id}/access-profile`, {
        method: accessForm.method,
        host: accessForm.host,
        username: accessUsername,
        port: Number(accessForm.port) || 22,
        secret: accessForm.secret.trim() ? accessForm.secret : undefined,
        clear_secret: accessForm.clear_secret,
        enabled: accessForm.enabled,
        notes: accessForm.notes
      });
      setAccessProfile(profile);
      setAccessForm((current) => ({ ...current, username: defaultAccessUsername(profile.method, profile.username), secret: "", clear_secret: false }));
      setNotice(locale === "zh" ? "服务器访问资料已加密保存。" : "Server access profile saved with encrypted secret storage.");
      return profile;
    });
    if (savedProfile) {
      setAccessModalOpen(false);
      if (selectedAsset && ["ssh_password", "ssh_key"].includes(savedProfile.method) && savedProfile.enabled && savedProfile.secret_configured) {
        await handleCollectRuntime(selectedAsset, true);
      }
    }
  }

  async function handleSaveBtPanelProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedAsset) {
      return;
    }
    const savedProfile = await withBusy(`asset-bt-panel-${selectedAsset.id}`, async () => {
      const profile = await apiPut<BtPanelProfile>(`/assets/${selectedAsset.id}/bt-panel`, {
        url: btPanelForm.url,
        username: btPanelForm.username,
        password: btPanelForm.password.trim() ? btPanelForm.password : undefined,
        clear_password: btPanelForm.clear_password,
        enabled: btPanelForm.enabled,
        notes: btPanelForm.notes
      });
      setBtPanelProfile(profile);
      syncBtPanelProfileToAsset(profile);
      setBtPanelForm((current) => ({ ...current, password: "", clear_password: false }));
      setNotice(locale === "zh" ? "宝塔面板资料已加密保存。" : "BT panel profile saved with encrypted password storage.");
      return profile;
    });
    if (savedProfile) {
      setBtPanelModalOpen(false);
    }
  }

  async function handleCopyBtUsername(): Promise<void> {
    if (!btPanelProfile.username) {
      return;
    }
    try {
      await copyToClipboard(btPanelProfile.username);
      setNotice(locale === "zh" ? "宝塔账号已复制。" : "BT panel username copied.");
    } catch {
      setNotice(locale === "zh" ? "复制失败，请手动复制账号。" : "Copy failed. Please copy the username manually.");
    }
  }

  async function handleCopyBtPassword(): Promise<void> {
    await copyBtPanelPassword(locale === "zh" ? "宝塔密码已复制。页面不会显示明文。" : "BT panel password copied. The page will not display it.");
  }

  function openBtPanelWindow(): boolean {
    const url = normalizeExternalUrl(btPanelProfile.url);
    if (!url || !btPanelProfile.enabled) {
      setNotice(locale === "zh" ? "先配置并启用宝塔面板地址。" : "Configure and enable the BT panel URL first.");
      return false;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  }

  function handleOpenBtPanel(): void {
    if (openBtPanelWindow()) {
      setNotice(locale === "zh" ? "已打开宝塔面板。需要登录时可复制账号或密码。" : "BT panel opened. Copy the username or password if login is required.");
    }
  }

  async function handleOpenBtPanelAndCopyPassword(): Promise<void> {
    if (!openBtPanelWindow()) {
      return;
    }
    if (!btPanelProfile.password_configured) {
      setNotice(locale === "zh" ? "已打开宝塔面板；当前未保存面板密码。" : "BT panel opened; no panel password is saved.");
      return;
    }
    await copyBtPanelPassword(locale === "zh" ? "已打开宝塔面板，并复制密码到剪贴板。" : "BT panel opened and password copied to clipboard.");
  }

  async function copyBtPanelPassword(successMessage: string): Promise<void> {
    if (!selectedAsset || !btPanelProfile.password_configured) {
      return;
    }
    await withBusy(`bt-panel-password-${selectedAsset.id}`, async () => {
      const result = await apiPost<{ password: string }>(`/assets/${selectedAsset.id}/bt-panel/password/reveal`);
      await copyToClipboard(result.password);
      setNotice(successMessage);
      return result;
    });
  }

  async function handleCopyAccessSecret(): Promise<void> {
    if (!selectedAsset || !accessProfile.secret_configured || accessForm.method === "cloud_assistant") {
      return;
    }
    await withBusy(`access-secret-${selectedAsset.id}`, async () => {
      const result = await apiPost<{ secret: string; method: string }>(`/assets/${selectedAsset.id}/access-profile/secret/reveal`);
      await copyToClipboard(result.secret);
      const isKey = result.method === "ssh_key";
      setNotice(
        locale === "zh"
          ? isKey
            ? "SSH 私钥已复制。页面不会显示明文。"
            : "SSH 密码已复制。页面不会显示明文。"
          : isKey
            ? "SSH private key copied. The page will not display it."
            : "SSH password copied. The page will not display it."
      );
      return result;
    });
  }

  async function handleCollectRuntime(asset: Asset, automatic = false): Promise<void> {
    const collected = await withBusy(`collect-runtime-${asset.id}`, async () => apiPost<RuntimeCollection>(`/assets/${asset.id}/runtime/collect`));
    if (collected) {
      setSelectedAsset((current) => (current?.id === collected.asset.id ? collected.asset : current));
      setAssets((current) => current.map((item) => (item.id === collected.asset.id ? collected.asset : item)));
      const measured = collected.results.filter((result) => typeof result.value === "number");
      const failed = collected.results.filter((result) => result.status !== "ok");
      if (measured.length > 0) {
        const thresholdHits = failed.filter((result) => typeof result.value === "number");
        if (thresholdHits.length > 0) {
          setNotice(
            locale === "zh"
              ? `使用率已采集，${thresholdHits.length} 项超过阈值。`
              : `Usage collected. ${thresholdHits.length} metric(s) exceeded the threshold.`
          );
        } else {
          setNotice(automatic ? (locale === "zh" ? "SSH 已保存，使用率已采集。" : "SSH saved and usage collected.") : (locale === "zh" ? "使用率已采集。" : "Usage collected."));
        }
      } else if (failed.length > 0) {
        setNotice(localizeGeneratedText(failed[0].message, locale));
      } else {
        setNotice(automatic ? (locale === "zh" ? "SSH 已保存，使用率已采集。" : "SSH saved and usage collected.") : (locale === "zh" ? "使用率已采集。" : "Usage collected."));
      }
    }
  }

  async function handleCreateDefaultChecks(asset: Asset): Promise<void> {
    const createdChecks = await withBusy(`default-checks-${asset.id}`, async () => {
      const items = await apiPost<Check[]>(`/assets/${asset.id}/checks/defaults`);
      setNotice(locale === "zh" ? `默认监控已就绪：${items.length} 项` : `${items.length} default checks are ready.`);
      return items;
    });
    if (createdChecks?.length) {
      setActiveView("checks");
    }
  }

  function monitorGroupIdForAsset(assetId: string): string {
    const numericAssetId = Number(assetId);
    if (!numericAssetId) {
      return "";
    }
    const group = monitorGroups.find((item) => item.asset_ids.includes(numericAssetId));
    return group ? String(group.id) : "";
  }

  function handleCreateCheckFromAsset(asset: Asset, type: string = "cloud_assistant"): void {
    setCheckForm({
      name: locale === "zh" ? `${asset.name} 监控` : `${asset.name} check`,
      type,
      target: defaultCheckTarget(asset, type, accessForm.host || accessProfile.host),
      asset_id: String(asset.id),
      group_id: monitorGroupIdForAsset(String(asset.id)),
      threshold: type === "cloud_assistant" || type === "ecs_metric" ? "85" : "",
      interval_seconds: "300",
      failure_threshold: "2"
    });
    setActiveView("checks");
    setCheckModalOpen(true);
  }

  function handleLinkedAssetChange(assetId: string): void {
    const asset = assets.find((item) => String(item.id) === assetId);
    setCheckForm((current) => ({
      ...current,
      asset_id: assetId,
      group_id: monitorGroupIdForAsset(assetId),
      target: asset ? defaultCheckTarget(asset, current.type) : current.target
    }));
  }

  function handleCheckTypeChange(type: string): void {
    const asset = assets.find((item) => String(item.id) === checkForm.asset_id);
    setCheckForm((current) => ({
      ...current,
      type,
      target: asset ? defaultCheckTarget(asset, type) : defaultCheckTarget(null, type)
    }));
  }

  async function handleCreateCheck(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const linkedAsset = assets.find((asset) => String(asset.id) === checkForm.asset_id);
    const payload = {
      name: checkForm.name.trim() || (locale === "zh" ? "未命名监控" : "Untitled check"),
      type: checkForm.type,
      target: checkForm.target.trim(),
      asset_id: checkForm.asset_id ? Number(checkForm.asset_id) : null,
      group_id: checkForm.group_id ? Number(checkForm.group_id) : null,
      threshold: checkForm.threshold ? Number(checkForm.threshold) : null,
      failure_threshold: Number(checkForm.failure_threshold),
      interval_seconds: Number(checkForm.interval_seconds),
      timeout_seconds: 5,
      config_json: {
        instance_id: linkedAsset?.external_id
      }
    };
    const createdCheck = await withBusy("create-check", async () => {
      const check = await apiPost<Check>("/checks", payload);
      setNotice(`已创建监控项：${check.name}`);
      return check;
    });
    if (createdCheck) {
      setCheckForm({
        name: "",
        type: "http",
        target: "",
        asset_id: "",
        group_id: "",
        interval_seconds: "300",
        threshold: "",
        failure_threshold: "2"
      });
      setCheckModalOpen(false);
    }
  }

  async function handleRunCheck(check: Check): Promise<void> {
    await withBusy(`run-${check.id}`, async () => {
      const result = await apiPost<CheckResult>(`/checks/${check.id}/run`);
      setResults((current) => [result, ...current.filter((item) => item.id !== result.id)].slice(0, 50));
      setChecks((current) => current.map((item) => {
        if (item.id !== check.id) {
          return item;
        }
        return {
          ...item,
          last_status: result.status,
          last_message: result.message,
          last_value: result.value,
          last_latency_ms: result.latency_ms,
          last_checked_at: result.checked_at,
          result_count: item.result_count + 1
        };
      }));
      setNotice(`检查完成：${result.status} / ${result.message}`);
      return result;
    });
  }

  async function handleToggleCheck(check: Check): Promise<void> {
    await withBusy(`toggle-check-${check.id}`, async () => {
      const updated = await apiPatch<Check>(`/checks/${check.id}`, { enabled: !check.enabled });
      setNotice(locale === "zh" ? `监控项已${updated.enabled ? "启用" : "停用"}：${updated.name}` : `Check ${updated.enabled ? "enabled" : "disabled"}: ${updated.name}`);
      return updated;
    });
  }

  async function handleDeleteCheck(check: Check): Promise<void> {
    const confirmed = await requestConfirm({
      title: locale === "zh" ? "删除监控项" : "Delete check",
      message: locale === "zh"
        ? `确定删除监控项「${check.name}」？执行结果会一并清理，已产生的告警会保留。`
        : `Delete check "${check.name}"? Results will be removed and existing alerts will be kept.`,
      confirmLabel: locale === "zh" ? "删除监控项" : "Delete check",
      cancelLabel: locale === "zh" ? "取消" : "Cancel",
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }
    const deleted = await withBusy(`delete-check-${check.id}`, async () => {
      const result = await apiDelete<{ deleted: boolean; id: number }>(`/checks/${check.id}`);
      setNotice(locale === "zh" ? `已删除监控项：${check.name}` : `Deleted check: ${check.name}`);
      return result;
    });
    if (deleted?.deleted) {
      setChecks((current) => current.filter((item) => item.id !== check.id));
      setResults((current) => current.filter((item) => item.check_id !== check.id));
      void refreshAll({ quiet: true });
    }
  }

  async function handleDeleteAllChecks(): Promise<void> {
    if (checks.length === 0) {
      return;
    }
    const confirmed = await requestConfirm({
      title: locale === "zh" ? "删除全部监控项" : "Delete all checks",
      message: locale === "zh"
        ? `确定删除全部 ${checks.length} 个监控项？执行结果会一并清理，已产生的告警会保留。`
        : `Delete all ${checks.length} checks? Results will be removed and existing alerts will be kept.`,
      confirmLabel: locale === "zh" ? "删除全部" : "Delete all",
      cancelLabel: locale === "zh" ? "取消" : "Cancel",
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }
    const deleted = await withBusy("delete-all-checks", async () => {
      const result = await apiDelete<{ deleted: number; results_deleted: number }>("/checks");
      setNotice(locale === "zh" ? `已删除 ${result.deleted} 个监控项` : `Deleted ${result.deleted} checks`);
      return result;
    });
    if (deleted?.deleted) {
      setChecks([]);
      setResults([]);
      void refreshAll({ quiet: true });
    }
  }

  async function handleUpdateAlert(alert: Alert, status: "acknowledged" | "closed"): Promise<void> {
    await withBusy(`alert-${alert.id}-${status}`, async () => {
      const updated = await apiPatch<Alert>(`/alerts/${alert.id}`, { status });
      setNotice(`告警已更新：${updated.status}`);
      return updated;
    });
  }

  async function handleDiagnoseAlert(alert: Alert): Promise<void> {
    await withBusy(`diagnose-${alert.id}`, async () => {
      const diagnosis = await apiPost<Diagnosis>("/diagnoses", { alert_id: alert.id, locale });
      setDiagnoses((current) => [{ ...diagnosis, locale }, ...current.filter((item) => !(item.alert_id === diagnosis.alert_id && item.locale === locale))]);
      setActiveView("diagnosis");
      setNotice("AI 诊断已生成，未执行任何修复命令。");
      return diagnosis;
    });
  }

  async function handleSaveAiConfig(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const savedConfig = await withBusy("save-ai-config", async () => {
      const payload = {
        base_url: aiConfigForm.base_url,
        model: aiConfigForm.model,
        api_key: aiConfigForm.api_key.trim() ? aiConfigForm.api_key : undefined
      };
      const config = await apiPut<AiConfig>("/settings/ai", payload);
      setAiConfig(config);
      setAiTestResult(null);
      setAiConfigForm((current) => ({ ...current, api_key: "" }));
      setNotice(locale === "zh" ? "AI 配置已保存，Key 已加密存储。" : "AI config saved. The key is encrypted at rest.");
      return config;
    });
    if (savedConfig) {
      setAiConfigModalOpen(false);
    }
  }

  async function handleClearAiKey(): Promise<void> {
    await withBusy("clear-ai-key", async () => {
      const config = await apiPut<AiConfig>("/settings/ai", {
        base_url: aiConfigForm.base_url,
        model: aiConfigForm.model,
        clear_api_key: true
      });
      setAiConfig(config);
      setAiTestResult(null);
      setAiConfigForm((current) => ({ ...current, api_key: "" }));
      setNotice(locale === "zh" ? "AI Key 已清除。" : "AI key cleared.");
      return config;
    });
  }

  async function handleTestAiConfig(): Promise<void> {
    const result = await withBusy("test-ai-config", async () => {
      const testResult = await apiPost<AiConfigTestResult>("/settings/ai/test");
      setAiTestResult(testResult);
      setNotice(localizeGeneratedText(testResult.message, locale));
      return testResult;
    });
    if (result) {
      setAiTestResult(result);
    }
  }

  function renderDetailRows(rows: DetailRow[], compact = false): JSX.Element {
    return (
      <dl className={compact ? "settings-list compact-list" : "settings-list detail-list"}>
        {rows.map((row) => (
          <div key={row.label}>
            <dt>
              <span>{row.label}</span>
              {row.source && <SourceTag source={row.source} locale={locale} />}
            </dt>
            <dd className={row.mono ? "mono" : undefined}>{row.value || "-"}</dd>
          </div>
        ))}
      </dl>
    );
  }

  function renderConsoleLink(asset: Asset): React.ReactNode {
    const url = assetConsoleUrl(asset);
    return url ? (
      <a className="text-link" href={url} target="_blank" rel="noreferrer">
        {assetConsoleLabel(asset, locale)}
        <ExternalLink aria-hidden="true" />
      </a>
    ) : (
      "-"
    );
  }

  function renderAssetProfilePanel(asset: Asset, rows: DetailRow[]): JSX.Element {
    const quality = assetQuality(asset);
    return (
      <section className="panel">
        <PanelHeader
          title={t.panels.assetProfile}
          action={
            <button type="button" className="secondary-button compact-button" onClick={() => setActiveView("assets")}>
              <ArrowLeft aria-hidden="true" />
              {t.actions.backToAssets}
            </button>
          }
        />
        <div className="asset-detail-title">
          {iconForAsset(asset.type)}
          <div>
            <h2>{asset.name}</h2>
            <span className="mono">{asset.external_id}</span>
          </div>
        </div>
        {renderDetailRows([
          { label: t.table.type, value: assetTypeLabel(asset.type, locale), source: fieldSource(quality, "identity") },
          { label: t.table.region, value: asset.region || "-", source: fieldSource(quality, "identity") },
          { label: t.table.status, value: <StatusPill status={asset.status} locale={locale} />, source: fieldSource(quality, "identity") },
          ...rows
        ])}
      </section>
    );
  }

  function renderOpsPanel(asset: Asset): JSX.Element {
    return (
      <section className="panel">
        <PanelHeader
          title={t.panels.opsProfile}
          action={
            <button type="button" className="secondary-button compact-button" onClick={() => setOpsModalOpen(true)}>
              <CalendarClock aria-hidden="true" />
              {locale === "zh" ? "编辑资料" : "Edit"}
            </button>
          }
        />
        {renderDetailRows([
          { label: t.form.renewalExpiresAt, value: assetExpiry(asset, locale) },
          { label: t.form.renewalAutoRenew, value: <RenewalPill asset={asset} locale={locale} /> },
          { label: t.form.loginUrl, value: renderConsoleLink(asset) },
          {
            label: t.form.serviceUrl,
            value: opsForm.service_url ? (
              <a className="text-link" href={opsForm.service_url} target="_blank" rel="noreferrer">
                {t.actions.openService}
                <ExternalLink aria-hidden="true" />
              </a>
            ) : (
              "-"
            )
          },
          { label: t.form.renewalNotes, value: opsForm.renewal_notes || "-" }
        ], true)}
      </section>
    );
  }

  async function handleCopyCommand(command: string): Promise<void> {
    try {
      await copyToClipboard(command);
      setNotice(locale === "zh" ? `命令已复制：${command}` : `Command copied: ${command}`);
    } catch {
      setNotice(locale === "zh" ? "复制失败，请手动复制命令。" : "Copy failed. Please copy the command manually.");
    }
  }

  function renderCopyCommand(command: string): JSX.Element {
    const label = locale === "zh" ? `复制命令：${command}` : `Copy command: ${command}`;
    return (
      <span className="copy-command">
        <code>{command}</code>
        <button
          type="button"
          className="copy-command-button"
          aria-label={label}
          title={label}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void handleCopyCommand(command);
          }}
        >
          <Copy aria-hidden="true" />
        </button>
      </span>
    );
  }

  function latestAccessValidation(asset: Asset): { status: string; message: string; checkedAt: string | null } {
    if (!accessProfile.enabled) {
      return {
        status: "pending",
        message: locale === "zh" ? "访问资料已停用。" : "Access profile is disabled.",
        checkedAt: null
      };
    }
    if (!accessProfile.secret_configured && accessProfile.method !== "cloud_assistant") {
      return {
        status: "pending",
        message: locale === "zh" ? "尚未保存 SSH 密码或私钥。" : "SSH password or private key is not saved yet.",
        checkedAt: null
      };
    }

    const accessCheckIds = new Set(
      checks
        .filter((check) => check.asset_id === asset.id && ["ssh", "cloud_assistant"].includes(check.type))
        .map((check) => check.id)
    );
    const candidates = results
      .filter((result) => result.asset_id === asset.id && (accessCheckIds.has(result.check_id) || isAccessValidationMessage(result.message)))
      .sort((left, right) => parseApiDateTime(right.checked_at).getTime() - parseApiDateTime(left.checked_at).getTime());
    const latest = candidates[0];
    if (!latest) {
      return {
        status: "untested",
        message: locale === "zh" ? "已保存配置，但还没有成功的 SSH/只读命令验证记录。" : "Config saved, but no SSH/read-only command validation has run yet.",
        checkedAt: null
      };
    }
    return {
      status: latest.status === "ok" ? "ok" : "failed",
      message: localizeGeneratedText(latest.message, locale),
      checkedAt: latest.checked_at
    };
  }

  function renderAccessValidation(asset: Asset): JSX.Element {
    const validation = latestAccessValidation(asset);
    return (
      <span className="access-validation">
        <StatusPill status={validation.status} locale={locale} />
        <span>{validation.message}</span>
        {validation.checkedAt && <time>{formatApiDateTime(validation.checkedAt, locale)}</time>}
      </span>
    );
  }

  function renderAccessPanel(asset: Asset): JSX.Element {
    const canCopyAccessSecret = accessProfile.secret_configured && accessForm.method !== "cloud_assistant";
    const accessSecretCopyLabel = accessForm.method === "ssh_key" ? t.actions.copySshKey : t.actions.copySshPassword;
    return (
      <section className="panel">
        <PanelHeader
          title={t.panels.accessProfile}
          action={
            <div className="panel-actions">
              {accessProfile.secret_configured ? <StatusPill status="configured" locale={locale} /> : <StatusPill status="pending" locale={locale} />}
              <HelpTooltip
                label={locale === "zh" ? "查看 SSH 密码配置说明" : "View SSH password setup help"}
                title={locale === "zh" ? "如何配置 SSH 密码" : "How to configure SSH access"}
              >
                {locale === "zh" ? (
                  <>
                    <span>控制台方式：在阿里云 ECS/轻量服务器详情里重置实例登录密码，按提示重启。</span>
                    <span>终端方式：如果已能进入服务器终端，执行 {renderCopyCommand("passwd root")}，连续输入两次新密码。</span>
                    <span>端口确认：执行 {renderCopyCommand("ss -lntp | grep ':22'")}，并确认安全组/防火墙放行 22。</span>
                    <span>回到这里点配置，选择 SSH 密码，填写公网 IP、22、登录用户（通常 root）和刚设置的系统密码。</span>
                    <span>这里不是宝塔面板密码；保存后只执行只读采集。</span>
                  </>
                ) : (
                  <>
                    <span>Console path: reset the instance login password in Alibaba Cloud ECS/SWAS, then reboot if required.</span>
                    <span>Terminal path: if you already have a server shell, run {renderCopyCommand("passwd root")} and enter the new password twice.</span>
                    <span>Port check: run {renderCopyCommand("ss -lntp | grep ':22'")} and allow port 22 in firewall/security group.</span>
                    <span>Back here, choose SSH password and fill public IP, 22, username, usually root, and that server password.</span>
                    <span>This is not the BT panel password; only read-only collection is executed.</span>
                  </>
                )}
              </HelpTooltip>
              <button type="button" className="secondary-button compact-button" onClick={() => setAccessModalOpen(true)}>
                <LockKeyhole aria-hidden="true" />
                {locale === "zh" ? "配置" : "Configure"}
              </button>
            </div>
          }
        />
        {renderDetailRows([
          { label: t.form.accessMethod, value: accessMethodLabel(accessForm.method, locale) },
          { label: t.form.accessHost, value: accessForm.host || defaultAssetHost(asset) || "-", mono: true },
          { label: t.form.accessPort, value: accessForm.port || "22" },
          { label: t.form.accessUsername, value: accessForm.username || "-" },
          { label: locale === "zh" ? "连接验证" : "Connection Test", value: renderAccessValidation(asset) },
          {
            label: t.form.accessSecret,
            value: (
              <span className="inline-secret-row">
                <span>{accessProfile.secret_configured ? t.settings.secretConfigured : "-"}</span>
                {canCopyAccessSecret && (
                  <button type="button" className="text-button" onClick={() => void handleCopyAccessSecret()} disabled={busyAction === `access-secret-${asset.id}`}>
                    <Copy aria-hidden="true" />
                    {accessSecretCopyLabel}
                  </button>
                )}
              </span>
            )
          },
          { label: t.form.accessEnabled, value: accessForm.enabled ? (locale === "zh" ? "启用" : "Enabled") : (locale === "zh" ? "停用" : "Disabled") },
          { label: t.form.accessNotes, value: accessForm.notes || "-" }
        ], true)}
      </section>
    );
  }

  function renderBtPanel(asset: Asset): JSX.Element {
    const canOpenPanel = Boolean(normalizeExternalUrl(btPanelProfile.url)) && btPanelProfile.enabled;
    const canCopyUsername = Boolean(btPanelProfile.username);
    const canCopyPassword = Boolean(btPanelProfile.password_configured);
    return (
      <section className="panel">
        <PanelHeader
          title={t.panels.btPanel}
          action={
            <div className="panel-actions">
              {btPanelProfile.password_configured ? <StatusPill status="configured" locale={locale} /> : <StatusPill status="pending" locale={locale} />}
              <button type="button" className="secondary-button compact-button" onClick={() => setBtPanelModalOpen(true)}>
                <KeyRound aria-hidden="true" />
                {locale === "zh" ? "配置" : "Configure"}
              </button>
            </div>
          }
        />
        <div className="bt-login-card">
          <div>
            <strong>{t.actions.btLoginHelper}</strong>
            <span>{t.settings.btLoginHint}</span>
          </div>
          <div className="bt-login-actions">
            <button type="button" className="secondary-button compact-button" onClick={handleOpenBtPanel} disabled={!canOpenPanel}>
              <ExternalLink aria-hidden="true" />
              {t.actions.openBtPanel}
            </button>
            <button type="button" className="secondary-button compact-button" onClick={() => void handleCopyBtUsername()} disabled={!canCopyUsername}>
              <Copy aria-hidden="true" />
              {t.actions.copyUsername}
            </button>
            <button type="button" className="secondary-button compact-button" onClick={() => void handleCopyBtPassword()} disabled={!canCopyPassword || busyAction === `bt-panel-password-${asset.id}`}>
              <Copy aria-hidden="true" />
              {t.actions.copyPassword}
            </button>
            <button type="button" className="primary-button compact-button" onClick={() => void handleOpenBtPanelAndCopyPassword()} disabled={!canOpenPanel || !canCopyPassword || busyAction === `bt-panel-password-${asset.id}`}>
              <KeyRound aria-hidden="true" />
              {t.actions.openAndCopyPassword}
            </button>
          </div>
        </div>
        {renderDetailRows([
          {
            label: t.form.btPanelUrl,
            value: btPanelProfile.url ? (
              <a className="text-link" href={btPanelProfile.url} target="_blank" rel="noreferrer">
                {btPanelProfile.url}
                <ExternalLink aria-hidden="true" />
              </a>
            ) : (
              "-"
            )
          },
          {
            label: t.form.btPanelUsername,
            value: (
              <span className="inline-secret-row">
                <span className="mono">{btPanelProfile.username || "-"}</span>
              </span>
            )
          },
          {
            label: t.form.btPanelPassword,
            value: (
              <span className="inline-secret-row">
                <span>{btPanelProfile.password_configured ? t.settings.passwordConfigured : "-"}</span>
              </span>
            )
          },
          { label: t.form.btPanelEnabled, value: btPanelProfile.enabled ? (locale === "zh" ? "启用" : "Enabled") : (locale === "zh" ? "停用" : "Disabled") },
          { label: t.form.btPanelNotes, value: btPanelProfile.notes || "-" }
        ], true)}
      </section>
    );
  }

  function renderActionPanel(title: string, actions: React.ReactNode): JSX.Element {
    return (
      <section className="panel">
        <PanelHeader title={title} />
        <div className="quick-action-list">{actions}</div>
      </section>
    );
  }

  function renderDataQualityPanel(asset: Asset): JSX.Element {
    const quality = assetQuality(asset);
    const collection = quality.collection;
    const sourceKeys = sourceKeysForAsset(asset);
    const actions = quality.recommended_actions.filter((action, index, list) => list.indexOf(action) === index);

    return (
      <section className="panel data-quality-panel">
        <PanelHeader title={locale === "zh" ? "数据状态" : "Data Status"} />
        <div className="quality-summary">
          <div>
            <span>{locale === "zh" ? "最近采集" : "Last Collection"}</span>
            <strong>{collectionStatusLabel(collection.status, locale)}</strong>
            <small>{collectionSummary(collection, locale)}</small>
          </div>
          <StatusPill status={collection.status === "ok" ? "ok" : collection.status === "failed" ? "failed" : "pending"} locale={locale} />
        </div>
        <div className="data-source-grid" aria-label={locale === "zh" ? "字段来源" : "Field sources"}>
          {sourceKeys.map((key) => (
            <span className="data-source-item" key={key}>
              <span>{sourceFieldLabel(key, locale)}</span>
              <SourceTag source={fieldSource(quality, key)} locale={locale} />
            </span>
          ))}
        </div>
        <div className="quality-gaps">
          <span>{locale === "zh" ? "缺口" : "Gaps"}</span>
          <div>
            {quality.gaps.length > 0 ? (
              quality.gaps.map((gap) => <span className="quality-gap" key={gap}>{gapLabel(gap, locale)}</span>)
            ) : (
              <span className="quality-gap is-good">{locale === "zh" ? "暂无缺口" : "No gaps"}</span>
            )}
          </div>
        </div>
        {actions.length > 0 && (
          <div className="quality-actions">
            {actions.map((action) => {
              if (action === "configure_ssh_access") {
                return (
                  <button type="button" className="secondary-button compact-button" key={action} onClick={() => setAccessModalOpen(true)}>
                    <LockKeyhole aria-hidden="true" />
                    {actionLabel(action, locale)}
                  </button>
                );
              }
              if (action === "collect_runtime") {
                return (
                  <button type="button" className="secondary-button compact-button" key={action} onClick={() => void handleCollectRuntime(asset)} disabled={busyAction === `collect-runtime-${asset.id}`}>
                    <TerminalSquare aria-hidden="true" />
                    {actionLabel(action, locale)}
                  </button>
                );
              }
              if (action === "create_default_checks") {
                return (
                  <button type="button" className="secondary-button compact-button" key={action} onClick={() => void handleCreateDefaultChecks(asset)} disabled={busyAction === `default-checks-${asset.id}`}>
                    <Activity aria-hidden="true" />
                    {actionLabel(action, locale)}
                  </button>
                );
              }
              return null;
            })}
          </div>
        )}
      </section>
    );
  }

  function renderServerDetail(asset: Asset): JSX.Element {
    const quality = assetQuality(asset);
    return (
      <section className="asset-detail-layout">
        <section className="detail-stack">
          {renderAssetProfilePanel(asset, [
            { label: locale === "zh" ? "公网 IP" : "Public IP", value: assetPublicIp(asset), mono: true, source: fieldSource(quality, "network") },
            { label: locale === "zh" ? "内网 IP" : "Private IP", value: assetPrivateIp(asset), mono: true, source: fieldSource(quality, "network") },
            { label: t.table.spec, value: assetSpec(asset, locale), source: fieldSource(quality, "spec") },
            { label: t.table.usage, value: <UsageMeters asset={asset} locale={locale} />, source: fieldSource(quality, "usage") },
            { label: locale === "zh" ? "系统/镜像" : "OS/Image", value: assetImage(asset), source: fieldSource(quality, "identity") }
          ])}
          {renderDataQualityPanel(asset)}
          {renderActionPanel(t.panels.quickActions, (
            <>
              <button type="button" className="primary-button" onClick={() => void handleCreateDefaultChecks(asset)} disabled={busyAction === `default-checks-${asset.id}`}>
                <Activity aria-hidden="true" />
                {locale === "zh" ? "生成默认监控" : "Create default checks"}
              </button>
              <button type="button" className="secondary-button" onClick={() => void handleCollectRuntime(asset)} disabled={busyAction === `collect-runtime-${asset.id}`}>
                <TerminalSquare aria-hidden="true" />
                {t.actions.collectRuntime}
              </button>
              {accessProfile.secret_configured && accessForm.method !== "cloud_assistant" && (
                <button type="button" className="secondary-button" onClick={() => handleCreateCheckFromAsset(asset, "ssh")}>
                  <LockKeyhole aria-hidden="true" />
                  {locale === "zh" ? "创建 SSH 检查" : "Create SSH check"}
                </button>
              )}
              <button type="button" className="secondary-button" onClick={() => handleCreateCheckFromAsset(asset, "tcp")}>
                <Activity aria-hidden="true" />
                {locale === "zh" ? "创建端口检查" : "Create TCP port check"}
              </button>
              <button type="button" className="secondary-button" onClick={() => handleCreateCheckFromAsset(asset, "http")}>
                <Globe2 aria-hidden="true" />
                {locale === "zh" ? "创建网站探活" : "Create HTTP probe"}
              </button>
            </>
          ))}
        </section>
        <section className="detail-stack">
          {renderOpsPanel(asset)}
          {renderAccessPanel(asset)}
          {renderBtPanel(asset)}
        </section>
      </section>
    );
  }

  function renderOssDetail(asset: Asset): JSX.Element {
    const quality = assetQuality(asset);
    const endpoint = metadataText(asset.metadata_json, ["extranet_endpoint", "intranet_endpoint"]);
    return (
      <section className="asset-detail-layout">
        <section className="detail-stack">
          {renderAssetProfilePanel(asset, [
            { label: locale === "zh" ? "Bucket" : "Bucket", value: asset.name, mono: true, source: fieldSource(quality, "identity") },
            { label: locale === "zh" ? "存储类型" : "Storage Class", value: metadataText(asset.metadata_json, ["storage_class"]) || "-", source: fieldSource(quality, "spec") },
            { label: locale === "zh" ? "创建时间" : "Created", value: metadataText(asset.metadata_json, ["creation_date"]) || "-", source: fieldSource(quality, "identity") },
            { label: locale === "zh" ? "公网 Endpoint" : "Public Endpoint", value: metadataText(asset.metadata_json, ["extranet_endpoint"]) || "-", mono: true, source: fieldSource(quality, "network") },
            { label: locale === "zh" ? "内网 Endpoint" : "Internal Endpoint", value: metadataText(asset.metadata_json, ["intranet_endpoint"]) || "-", mono: true, source: fieldSource(quality, "network") }
          ])}
          {renderDataQualityPanel(asset)}
        </section>
        <section className="detail-stack">
          <section className="panel">
            <PanelHeader title={locale === "zh" ? "Bucket 信息" : "Bucket Info"} />
            {renderDetailRows([
              { label: locale === "zh" ? "资源来源" : "Source", value: metadataText(asset.metadata_json, ["source"]) || "-" },
              { label: locale === "zh" ? "资源类型" : "Resource Type", value: metadataText(asset.metadata_json, ["resource_type"]) || "OSS Bucket" },
              { label: locale === "zh" ? "Endpoint" : "Endpoint", value: endpoint || "-", mono: true },
              { label: locale === "zh" ? "外部 ID" : "External ID", value: asset.external_id, mono: true }
            ], true)}
          </section>
          {renderActionPanel(locale === "zh" ? "OSS 操作" : "OSS Actions", (
            <>
              <button type="button" className="primary-button" onClick={() => void handleCreateDefaultChecks(asset)} disabled={busyAction === `default-checks-${asset.id}`}>
                <Activity aria-hidden="true" />
                {locale === "zh" ? "生成默认监控" : "Create default checks"}
              </button>
              {assetConsoleUrl(asset) && (
                <a className="secondary-button" href={assetConsoleUrl(asset)} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" />
                  {t.actions.openConsole}
                </a>
              )}
            </>
          ))}
        </section>
      </section>
    );
  }

  function renderDomainDetail(asset: Asset): JSX.Element {
    const quality = assetQuality(asset);
    return (
      <section className="asset-detail-layout">
        <section className="detail-stack">
          {renderAssetProfilePanel(asset, [
            { label: locale === "zh" ? "域名" : "Domain", value: asset.name, mono: true, source: fieldSource(quality, "identity") },
            { label: locale === "zh" ? "注册商" : "Registrar", value: metadataText(asset.metadata_json, ["registrar"]) || "-", source: fieldSource(quality, "identity") },
            { label: locale === "zh" ? "外部 ID" : "External ID", value: asset.external_id, mono: true, source: fieldSource(quality, "identity") }
          ])}
          {renderDataQualityPanel(asset)}
          {renderActionPanel(locale === "zh" ? "域名操作" : "Domain Actions", (
            <>
              <button type="button" className="primary-button" onClick={() => void handleCreateDefaultChecks(asset)} disabled={busyAction === `default-checks-${asset.id}`}>
                <Activity aria-hidden="true" />
                {locale === "zh" ? "生成默认监控" : "Create default checks"}
              </button>
              <button type="button" className="secondary-button" onClick={() => handleCreateCheckFromAsset(asset, "http")}>
                <Globe2 aria-hidden="true" />
                {locale === "zh" ? "创建 HTTPS 探活" : "Create HTTPS probe"}
              </button>
            </>
          ))}
        </section>
        <section className="detail-stack">
          {renderOpsPanel(asset)}
        </section>
      </section>
    );
  }

  function renderDnsDetail(asset: Asset): JSX.Element {
    const quality = assetQuality(asset);
    const isRecord = Boolean(metadataText(asset.metadata_json, ["record_type"]));
    return (
      <section className="asset-detail-layout">
        <section className="detail-stack">
          {renderAssetProfilePanel(asset, [
            { label: locale === "zh" ? "DNS 类型" : "DNS Kind", value: isRecord ? (locale === "zh" ? "解析记录" : "Record") : (locale === "zh" ? "解析域名" : "Zone"), source: fieldSource(quality, "identity") },
            { label: locale === "zh" ? "记录类型" : "Record Type", value: metadataText(asset.metadata_json, ["record_type"]) || "-", source: fieldSource(quality, "identity") },
            { label: locale === "zh" ? "记录值" : "Record Value", value: metadataText(asset.metadata_json, ["value"]) || "-", mono: true, source: fieldSource(quality, "identity") },
            { label: locale === "zh" ? "TTL" : "TTL", value: metadataText(asset.metadata_json, ["ttl"]) || "-", source: fieldSource(quality, "identity") },
            { label: locale === "zh" ? "记录数" : "Records", value: metadataText(asset.metadata_json, ["record_count"]) || "-", source: fieldSource(quality, "identity") },
            { label: locale === "zh" ? "版本" : "Version", value: metadataText(asset.metadata_json, ["version_name"]) || "-", source: fieldSource(quality, "identity") }
          ])}
          {renderDataQualityPanel(asset)}
        </section>
        <section className="detail-stack">
          <section className="panel">
            <PanelHeader title={isRecord ? (locale === "zh" ? "解析记录" : "DNS Record") : (locale === "zh" ? "解析域名" : "DNS Zone")} />
            {renderDetailRows([
              { label: locale === "zh" ? "主机记录" : "Host Record", value: asset.name, mono: true },
              { label: locale === "zh" ? "线路" : "Line", value: metadataText(asset.metadata_json, ["line"]) || "-" },
              { label: locale === "zh" ? "外部 ID" : "External ID", value: asset.external_id, mono: true },
              { label: locale === "zh" ? "来源" : "Source", value: metadataText(asset.metadata_json, ["source"]) || "-" }
            ], true)}
          </section>
          {renderActionPanel(locale === "zh" ? "DNS 操作" : "DNS Actions", (
            <>
              <button type="button" className="primary-button" onClick={() => void handleCreateDefaultChecks(asset)} disabled={busyAction === `default-checks-${asset.id}`}>
                <Activity aria-hidden="true" />
                {locale === "zh" ? "生成默认监控" : "Create default checks"}
              </button>
              <button type="button" className="secondary-button" onClick={() => handleCreateCheckFromAsset(asset, "http")}>
                <Globe2 aria-hidden="true" />
                {locale === "zh" ? "创建网站探活" : "Create HTTP probe"}
              </button>
              {assetConsoleUrl(asset) && (
                <a className="secondary-button" href={assetConsoleUrl(asset)} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" />
                  {t.actions.openConsole}
                </a>
              )}
            </>
          ))}
        </section>
      </section>
    );
  }

  function renderGenericAssetDetail(asset: Asset): JSX.Element {
    const quality = assetQuality(asset);
    return (
      <section className="asset-detail-layout">
        <section className="detail-stack">
          {renderAssetProfilePanel(asset, [
            { label: locale === "zh" ? "外部 ID" : "External ID", value: asset.external_id, mono: true, source: fieldSource(quality, "identity") },
            { label: locale === "zh" ? "来源" : "Source", value: metadataText(asset.metadata_json, ["source"]) || "-", source: fieldSource(quality, "identity") },
            { label: locale === "zh" ? "资源类型" : "Resource Type", value: metadataText(asset.metadata_json, ["resource_type"]) || "-", source: fieldSource(quality, "identity") }
          ])}
          {renderDataQualityPanel(asset)}
        </section>
        <section className="detail-stack">
          {renderOpsPanel(asset)}
        </section>
      </section>
    );
  }

  function renderAssetDetail(asset: Asset): JSX.Element {
    if (["ecs", "swas", "server"].includes(asset.type)) {
      return renderServerDetail(asset);
    }
    if (asset.type === "oss") {
      return renderOssDetail(asset);
    }
    if (asset.type === "domain") {
      return renderDomainDetail(asset);
    }
    if (asset.type === "dns") {
      return renderDnsDetail(asset);
    }
    return renderGenericAssetDetail(asset);
  }

  if (!authChecked) {
    return <StartupScreen locale={locale} />;
  }

  if (!authMe) {
    return (
      <LoginPage
        locale={locale}
        notice={loginNotice}
        busy={busyAction === "login"}
        form={loginForm}
        onFormChange={setLoginForm}
        onSubmit={handleLogin}
        onLocaleChange={setLocale}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand">
          <ShieldCheck aria-hidden="true" />
          <div>
            <strong>Local AI Ops</strong>
            <span>{t.brand}</span>
          </div>
        </div>
        <nav className="nav-list nav-list-main" aria-label={locale === "zh" ? "业务导航" : "Main navigation"}>
          {mainViews.map((view) => (
            <button
              type="button"
              className={isNavActive(view.id, activeView) ? "nav-item is-active" : "nav-item"}
              key={view.id}
              onClick={() => setActiveView(view.id)}
            >
              <view.icon aria-hidden="true" />
              <span>{navLabel(view.id, locale, t)}</span>
            </button>
          ))}
        </nav>
        <nav className="nav-list nav-list-utility" aria-label={locale === "zh" ? "接入与配置" : "Access and settings"}>
          {utilityViews.map((view) => (
            <button
              type="button"
              className={isNavActive(view.id, activeView) ? "nav-item is-active" : "nav-item"}
              key={view.id}
              onClick={() => setActiveView(view.id)}
            >
              <view.icon aria-hidden="true" />
              <span>{navLabel(view.id, locale, t)}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{pageTitle(activeView, locale, t)}</h1>
          </div>
          <div className="topbar-actions">
            {showNotice && (
              <div className="message-toast" role="status" aria-live="polite">
                <span>{notice}</span>
              </div>
            )}
            <div className="topbar-tools" aria-label={locale === "zh" ? "顶部工具" : "Top tools"}>
              {authMe.default_password && (
                <span
                  className="security-warning"
                  aria-label={locale === "zh" ? "正在使用默认管理员密码" : "Using default admin password"}
                  title={locale === "zh" ? "正在使用默认管理员密码。请在 .env 中修改 ADMIN_PASSWORD 后重启服务。" : "Using the default admin password. Change ADMIN_PASSWORD in .env and restart the service."}
                >
                  <ShieldCheck aria-hidden="true" />
                </span>
              )}
              <button type="button" className="secondary-button compact-button topbar-user" onClick={() => void handleLogout()} title={locale === "zh" ? "退出本地管理员登录" : "Sign out"}>
                <LogOut aria-hidden="true" />
                <span>{authMe.username}</span>
              </button>
              <div className="topbar-user-menu" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="topbar-user-trigger"
                  onClick={() => setUserMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={userMenuOpen}
                  title={locale === "zh" ? "管理员菜单" : "Admin menu"}
                >
                  <span className={authMe.default_password ? "user-avatar has-warning" : "user-avatar"}>
                    {authMe.username.slice(0, 1).toUpperCase()}
                  </span>
                  <span>{authMe.username}</span>
                </button>
                {userMenuOpen && (
                  <div className="topbar-menu" role="menu">
                    <div className="topbar-menu-header">
                      <strong>{authMe.username}</strong>
                      <span>{locale === "zh" ? "本地管理员" : "Local admin"}</span>
                    </div>
                    {authMe.default_password && (
                      <div className="topbar-menu-warning">
                        <ShieldCheck aria-hidden="true" />
                        <span>{locale === "zh" ? "当前仍使用默认密码，请在 .env 修改 ADMIN_PASSWORD。" : "Default password is still active. Change ADMIN_PASSWORD in .env."}</span>
                      </div>
                    )}
                    <button type="button" role="menuitem" onClick={() => void handleLogout()}>
                      <LogOut aria-hidden="true" />
                      {locale === "zh" ? "退出登录" : "Sign out"}
                    </button>
                  </div>
                )}
              </div>
              <div className="segmented locale-switch" role="group" aria-label="Language">
                <button type="button" className={locale === "zh" ? "is-selected" : ""} onClick={() => setLocale("zh")}>中文</button>
                <button type="button" className={locale === "en" ? "is-selected" : ""} onClick={() => setLocale("en")}>EN</button>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => void handleManualRefresh()}
                aria-label={refreshLabel}
                title={refreshLabel}
                disabled={busyAction === "refresh"}
              >
                <RefreshCcw aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        {activeView === "overview" && (
          <section className="view-grid">
            <div className="metrics-strip">
              <Metric label={t.metrics.assets} value={dashboard.assets_total} icon={Database} />
              <Metric label={t.metrics.alerts} value={dashboard.open_alerts} icon={AlertTriangle} tone={dashboard.open_alerts > 0 ? "bad" : "good"} />
              <Metric label={t.metrics.checks} value={dashboard.checks_total} icon={Activity} />
              <Metric label={t.metrics.uptime} value={uptimeMetricValue} icon={Globe2} tone={uptimeMetricTone} note={uptimeMetricNote} />
            </div>

            <ChartPanel
              title={t.panels.assetDistribution}
              option={assetDistributionOption}
              empty={assetDistributionRows.length === 0}
              emptyText={t.empty.noAssets}
              action={<button type="button" className="text-button" onClick={() => setActiveView("assets")}>{t.actions.viewAssets}</button>}
            />

            <ChartPanel
              title={t.panels.regionDistribution}
              option={regionDistributionOption}
              empty={regionDistributionRows.length === 0}
              emptyText={t.empty.noAssets}
              className="span-2"
            />

            <ChartPanel
              title={t.panels.uptimeChart}
              option={uptimeOption}
              caption={uptimeCaption}
            />

            <ChartPanel
              title={t.panels.renewalTimeline}
              option={expiryOption}
              empty={expiryRows.length === 0}
              emptyText={t.empty.noAssets}
              className="span-2 expiry-chart-panel"
            />

            <section className="panel">
              <PanelHeader title={t.panels.riskQueue} />
              <RiskOverview summary={dashboard.risk_summary ?? []} items={dashboard.risk_items ?? []} locale={locale} />
            </section>

            <section className="panel span-3">
              <PanelHeader title={t.panels.recentAlerts} action={<button type="button" className="text-button" onClick={() => setActiveView("alerts")}>{t.actions.openAlerts}</button>} />
              <AlertTable alerts={alerts.slice(0, 5)} onDiagnose={handleDiagnoseAlert} onUpdate={handleUpdateAlert} busyAction={busyAction} locale={locale} compact />
            </section>
          </section>
        )}

        {activeView === "accounts" && (
          <section className="admin-page">
            <section className="panel table-panel full-height account-list-panel">
              <PanelHeader
                title={t.panels.accounts}
                action={
                  <div className="panel-actions">
                    <button type="button" className="primary-button" onClick={() => setAccountModalOpen(true)}>
                      <KeyRound aria-hidden="true" />
                      {t.panels.addAccount}
                    </button>
                    <button
                      type="button"
                      className="secondary-button danger-outline-button"
                      onClick={() => void handleDeleteFailedAccounts()}
                      disabled={accounts.every((account) => account.status !== "error") || busyAction === "delete-failed-accounts"}
                    >
                      <XCircle aria-hidden="true" />
                      {locale === "zh" ? "删除错误账号" : "Delete Failed"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void handleSyncAssets()}
                      disabled={busyAction === "sync-assets"}
                      title={locale === "zh" ? "同步所有已接入账号下的云资产。" : "Sync cloud assets from all connected accounts."}
                    >
                      <RefreshCcw aria-hidden="true" />
                      {t.actions.syncAssets}
                    </button>
                  </div>
                }
              />
              <table className="account-table">
                <thead>
                  <tr>
                    <th>{t.table.name}</th>
                    <th>{t.table.key}</th>
                    <th>{t.form.defaultRegion}</th>
                    <th>{t.table.status}</th>
                    <th>{t.table.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.length === 0 && (
                    <tr>
                      <td colSpan={5}>
                        <div className="empty-state table-empty">
                          {locale === "zh" ? "暂无账号" : "No accounts"}
                        </div>
                      </td>
                    </tr>
                  )}
                  {accounts.map((account) => (
                    <tr key={account.id}>
                      <td>{account.name}</td>
                      <td className="mono">{account.access_key_id_masked}</td>
                      <td>{account.default_region}</td>
                      <td><StatusPill status={account.status} locale={locale} /></td>
                      <td className="row-actions">
                        <div className="account-action-group">
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => void handleTestAccount(account)}
                            disabled={busyAction === `test-${account.id}`}
                            title={locale === "zh" ? "校验 RAM AccessKey 是否可用，并检查资源、ECS、云监控、续费查询等只读权限。" : "Verify the RAM AccessKey and read-only permissions for resources, ECS, CloudMonitor, and renewal lookup."}
                          >
                            {locale === "zh" ? "测试凭据" : "Test"}
                          </button>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => void handleSyncAssets(account.id)}
                            disabled={busyAction === "sync-assets"}
                            title={locale === "zh" ? "调用阿里云 OpenAPI 拉取并更新该账号下的 ECS、轻量服务器、OSS、域名和 DNS 资产。" : "Call Alibaba Cloud OpenAPI to refresh ECS, SWAS, OSS, domain, and DNS assets for this account."}
                          >
                            {locale === "zh" ? "同步资产" : "Sync"}
                          </button>
                          <button
                            type="button"
                            className="text-button danger-text-button"
                            onClick={() => void handleDeleteAccount(account)}
                            disabled={busyAction === `delete-account-${account.id}`}
                          >
                            {locale === "zh" ? "删除" : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </section>
        )}

        {activeView === "assets" && (
          <section className="panel table-panel full-height asset-list-panel">
            <PanelHeader
              title={<AssetViewTitle activeView={activeView} locale={locale} title={t.panels.assets} onChange={setActiveView} />}
              action={
                <div className="panel-actions asset-toolbar">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void handleSyncAssets()}
                    disabled={busyAction === "sync-assets"}
                    title={locale === "zh" ? "调用阿里云 OpenAPI 重新拉取资产，耗时比本地刷新更长。" : "Call Alibaba Cloud OpenAPI to resync assets. This is slower than local refresh."}
                  >
                    <RefreshCcw aria-hidden="true" />
                    {locale === "zh" ? "同步阿里云" : "Sync Cloud"}
                  </button>
                  <div className="segmented" role="group" aria-label="资产类型筛选">
                    {assetFilters.map((type) => (
                      <button
                        type="button"
                        key={type}
                        className={selectedAssetType === type ? "is-selected" : ""}
                        onClick={() => setSelectedAssetType(type)}
                      >
                        <span>{type === "all" ? (locale === "zh" ? "全部" : "All") : assetTypeLabel(type, locale)}</span>
                        <span className="segmented-count">{assetFilterCounts[type]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              }
            />
            <FilterToolbar
              className="asset-filter-bar"
              ariaLabel={locale === "zh" ? "资产筛选" : "Asset filters"}
              searchLabel={locale === "zh" ? "搜索资产" : "Search assets"}
              clearSearchLabel={locale === "zh" ? "清空搜索" : "Clear search"}
              searchPlaceholder={locale === "zh" ? "搜索资产、IP、域名、Bucket" : "Search assets, IP, domain, bucket"}
              searchValue={assetSearch}
              onSearchChange={setAssetSearch}
              filters={assetFilterControls}
              resetLabel={locale === "zh" ? "重置" : "Reset"}
              resetDisabled={!hasActiveAssetFilters}
              onReset={() => {
                setAssetSearch("");
                setSelectedAssetType("all");
                setSelectedAssetRegion("all");
                setSelectedAssetStatus("all");
              }}
            />
            <div className="table-meta-row">
              <span>
                {locale === "zh"
                  ? `匹配 ${filteredAssets.length} 个，显示 ${assetRangeStart}-${assetRangeEnd}，总计 ${assets.length} 个`
                  : `${filteredAssets.length} matched, showing ${assetRangeStart}-${assetRangeEnd}, ${assets.length} total`}
              </span>
              <label className="page-size-control">
                <span>{locale === "zh" ? "每页" : "Rows"}</span>
                <select value={assetPageSize} onChange={(event) => setAssetPageSize(Number(event.target.value))}>
                  {assetPageSizeOptions.map((size) => (
                    <option value={size} key={size}>{size}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="asset-table-scroll">
              <table className="asset-table">
                <thead>
                  <tr>
                    <th>{t.table.asset}</th>
                    <th>{t.table.type}</th>
                    <th>{t.table.region}</th>
                    <th>{t.table.status}</th>
                    <th>{t.table.network}</th>
                    <th>{t.table.spec}</th>
                    <th>{t.table.usage}</th>
                    <th>{t.table.expires}</th>
                    <th>{t.table.renewal}</th>
                    <th>{t.table.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssets.length === 0 && (
                    <tr>
                      <td colSpan={10}>
                        <div className="empty-state table-empty">{t.empty.noAssets}</div>
                      </td>
                    </tr>
                  )}
                  {paginatedAssets.map((asset) => (
                    <tr key={asset.id}>
                      <td>
                        <div className="asset-name">
                          {iconForAsset(asset.type)}
                          <div>
                            <strong>{asset.name}</strong>
                            <span className="mono">{asset.external_id}</span>
                          </div>
                        </div>
                      </td>
                      <td>{assetTypeLabel(asset.type, locale)}</td>
                      <td>{asset.region}</td>
                      <td><StatusPill status={asset.status} locale={locale} /></td>
                      <td className="metadata">
                        <MetadataLine label={locale === "zh" ? "公网" : "Public"} value={assetPublicIp(asset)} />
                        <MetadataLine label={locale === "zh" ? "内网" : "Private"} value={assetPrivateIp(asset)} />
                      </td>
                      <td className="metadata">{assetSpec(asset, locale)}</td>
                      <td className="metadata runtime-cell"><UsageMeters asset={asset} locale={locale} compact /></td>
                      <td className="metadata">{assetExpiry(asset, locale)}</td>
                      <td className="metadata renewal-cell"><RenewalPill asset={asset} locale={locale} /></td>
                      <td className="row-actions">
                        <div className="asset-row-actions">
                          <button type="button" className="text-button" onClick={() => void handleOpenAssetDetail(asset)} disabled={busyAction === `asset-detail-${asset.id}`}>
                            {t.actions.details}
                          </button>
                          {assetConsoleUrl(asset) && (
                            <a className="text-link" href={assetConsoleUrl(asset)} target="_blank" rel="noreferrer">
                              {assetConsoleLabel(asset, locale)}
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination-bar">
              <span>{locale === "zh" ? `第 ${currentAssetPage} / ${assetPageTotal} 页` : `Page ${currentAssetPage} of ${assetPageTotal}`}</span>
              <div className="pagination-buttons">
                <button type="button" className="secondary-button compact-button" onClick={() => setAssetPage((page) => Math.max(1, page - 1))} disabled={currentAssetPage <= 1}>
                  <ArrowLeft aria-hidden="true" />
                  {locale === "zh" ? "上一页" : "Prev"}
                </button>
                <button type="button" className="secondary-button compact-button" onClick={() => setAssetPage((page) => Math.min(assetPageTotal, page + 1))} disabled={currentAssetPage >= assetPageTotal}>
                  {locale === "zh" ? "下一页" : "Next"}
                  <ArrowRight aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>
        )}

        {activeView === "asset-detail" && selectedAsset && renderAssetDetail(selectedAsset)}

        {activeView === "checks" && (
          <section className="monitoring-page">
            <section className="monitoring-summary-grid">
              <Metric label={locale === "zh" ? "监控总数" : "Total Checks"} value={checkSummary.total} icon={Activity} />
              <Metric label={locale === "zh" ? "异常" : "Failing"} value={checkSummary.failing} icon={AlertTriangle} tone={checkSummary.failing > 0 ? "bad" : "good"} />
              <Metric label={locale === "zh" ? "正常" : "Healthy"} value={checkSummary.ok} icon={CheckCircle2} tone="good" />
              <Metric label={locale === "zh" ? "未执行" : "Never Run"} value={checkSummary.never} icon={Gauge} tone={checkSummary.never > 0 ? "warn" : "neutral"} />
            </section>

            <section className="monitoring-workspace">
            <section className="panel monitor-group-panel">
              <PanelHeader title={locale === "zh" ? "监控组" : "Monitor Groups"} />
              <div className="monitor-group-list" role="list" aria-label={locale === "zh" ? "监控组列表" : "Monitor group list"}>
                {monitorGroupOptions.map((group) => (
                  <button
                    type="button"
                    key={group.id}
                    className={`monitor-group-item ${selectedMonitorGroup === group.id ? "is-active" : ""}`}
                    onClick={() => setSelectedMonitorGroup(group.id)}
                  >
                    <span className="monitor-group-title">{group.name}</span>
                    <span className="monitor-group-meta">
                      {monitorGroupTypeLabel(group.type, locale)} · {group.checkCount}
                    </span>
                    {group.failingCount > 0 && <span className="monitor-group-risk">{group.failingCount}</span>}
                  </button>
                ))}
              </div>
            </section>
            <section className="panel table-panel checks-panel">
              <PanelHeader
                title={locale === "zh" ? "监控中心" : "Monitoring Center"}
                action={
                  <div className="monitoring-header-actions">
                    <div className="segmented" role="group" aria-label={locale === "zh" ? "监控状态筛选" : "Check status filter"}>
                      {(["all", "failing", "ok", "never", "disabled"] as CheckFilter[]).map((filter) => (
                        <button
                          type="button"
                          key={filter}
                          className={selectedCheckFilter === filter ? "is-selected" : ""}
                          onClick={() => setSelectedCheckFilter(filter)}
                        >
                          {checkFilterLabel(filter, locale)}
                        </button>
                      ))}
                    </div>
                    <button type="button" className="secondary-button danger-outline-button" onClick={() => void handleDeleteAllChecks()} disabled={checks.length === 0 || busyAction === "delete-all-checks"}>
                      <Trash2 aria-hidden="true" />
                      {locale === "zh" ? "删除全部" : "Delete All"}
                    </button>
                    <button type="button" className="primary-button" onClick={() => setCheckModalOpen(true)}>
                      <Activity aria-hidden="true" />
                      {t.panels.createCheck}
                    </button>
                  </div>
                }
              />
              <div className="monitoring-table-shell">
              <table className="checks-table monitoring-table">
                <thead>
                  <tr>
                    <th>{locale === "zh" ? "检查项" : "Check"}</th>
                    <th>{t.table.type}</th>
                    <th>{t.table.asset}</th>
                    <th>{t.table.target}</th>
                    <th>{locale === "zh" ? "计划" : "Schedule"}</th>
                    <th>{t.table.status}</th>
                    <th>{locale === "zh" ? "最近结果" : "Latest Result"}</th>
                    <th>{t.table.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredChecks.length === 0 && (
                    <tr>
                      <td colSpan={8}>
                        <div className="empty-state table-empty">
                          {locale === "zh" ? "暂无匹配监控项" : "No matching checks"}
                        </div>
                      </td>
                    </tr>
                  )}
                  {paginatedChecks.map((check) => (
                    <tr key={check.id}>
                      <td>
                        <div className="check-name-cell">
                          <strong>{checkPurposeLabel(check, locale)}</strong>
                          <span>{check.name}</span>
                        </div>
                      </td>
                      <td>
                        <span className="check-type-badge">{checkTypeLabel(check.type, locale)}</span>
                      </td>
                      <td>
                        <div className="check-asset-cell">
                          <strong>{check.asset_name || "-"}</strong>
                          <span>{check.asset_type ? `${assetTypeLabel(check.asset_type, locale)} / ${check.asset_region || "-"}` : "-"}</span>
                          {check.group_name && <span>{locale === "zh" ? "组" : "Group"} / {check.group_name}</span>}
                        </div>
                      </td>
                      <td className="mono target-cell">{check.target}</td>
                      <td>{checkScheduleLabel(check, locale)}</td>
                      <td><StatusPill status={checkStatusForDisplay(check)} locale={locale} /></td>
                      <td>
                        <div className="latest-result-cell">
                          <strong>{checkLatestValue(check, locale)}</strong>
                          <span>{check.last_message ? localizeGeneratedText(check.last_message, locale) : "-"}</span>
                          {check.last_checked_at && <time>{formatApiDateTime(check.last_checked_at, locale)}</time>}
                        </div>
                      </td>
                      <td className="row-actions">
                        <div className="action-button-group">
                          <button type="button" className="secondary-button compact-button icon-action-button" onClick={() => void handleRunCheck(check)} disabled={busyAction === `run-${check.id}`} title={t.actions.run} aria-label={t.actions.run}>
                            <Play aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="secondary-button compact-button icon-action-button"
                            onClick={() => void handleToggleCheck(check)}
                            disabled={busyAction === `toggle-check-${check.id}`}
                            title={check.enabled ? (locale === "zh" ? "停用" : "Disable") : (locale === "zh" ? "启用" : "Enable")}
                            aria-label={check.enabled ? (locale === "zh" ? "停用" : "Disable") : (locale === "zh" ? "启用" : "Enable")}
                          >
                            {check.enabled ? <XCircle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
                          </button>
                          <button type="button" className="secondary-button compact-button icon-action-button danger-outline-button" onClick={() => void handleDeleteCheck(check)} disabled={busyAction === `delete-check-${check.id}`} title={t.actions.delete} aria-label={t.actions.delete}>
                            <Trash2 aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <div className="pagination-bar">
                <span>{locale === "zh" ? `第 ${currentCheckPage} / ${checkPageTotal} 页，共 ${filteredChecks.length} 项` : `Page ${currentCheckPage} of ${checkPageTotal}, ${filteredChecks.length} checks`}</span>
                <div className="pagination-buttons">
                  <button type="button" className="secondary-button compact-button" onClick={() => setCheckPage((page) => Math.max(1, page - 1))} disabled={currentCheckPage <= 1}>
                    <ArrowLeft aria-hidden="true" />
                    {locale === "zh" ? "上一页" : "Prev"}
                  </button>
                  <button type="button" className="secondary-button compact-button" onClick={() => setCheckPage((page) => Math.min(checkPageTotal, page + 1))} disabled={currentCheckPage >= checkPageTotal}>
                    {locale === "zh" ? "下一页" : "Next"}
                    <ArrowRight aria-hidden="true" />
                  </button>
                </div>
              </div>
            </section>

            <section className="monitoring-side-stack">
              <MonitoringFlowPanel
                failingChecks={failingChecks}
                alerts={alerts}
                onRunCheck={handleRunCheck}
                onOpenAlerts={() => setActiveView("alerts")}
                onOpenDiagnosis={() => setActiveView("diagnosis")}
                onDiagnoseAlert={handleDiagnoseAlert}
                busyAction={busyAction}
                locale={locale}
              />
              <section className="panel results-panel">
                <PanelHeader title={t.panels.results} />
                <div className="results-feed">
                  {results.slice(0, 8).map((result) => (
                    <div className="result-line" key={result.id}>
                      <StatusIcon status={result.status} />
                      <span>{localizeGeneratedText(result.message, locale)}</span>
                      <time>{formatApiDateTime(result.checked_at, locale)}</time>
                    </div>
                  ))}
                  {results.length === 0 && <EmptyState text={locale === "zh" ? "暂无执行结果" : "No check results"} />}
                </div>
              </section>
            </section>
            </section>
          </section>
        )}

        {activeView === "alerts" && (
          <section className="panel table-panel full-height alert-list-panel">
            <PanelHeader
              title={locale === "zh" ? "告警列表" : "Alert List"}
              action={
                <button type="button" className="secondary-button" onClick={() => setActiveView("diagnosis")}>
                  <Bot aria-hidden="true" />
                  {locale === "zh" ? "AI 诊断" : "AI Diagnosis"}
                </button>
              }
            />
            <AlertSummaryBar summary={alertSummary} locale={locale} />
            <div className="alert-table-scroll">
              <AlertTable alerts={paginatedAlerts} onDiagnose={handleDiagnoseAlert} onUpdate={handleUpdateAlert} busyAction={busyAction} locale={locale} />
            </div>
            <div className="pagination-bar">
              <span>{locale === "zh" ? `第 ${currentAlertPage} / ${alertPageTotal} 页，共 ${alerts.length} 条` : `Page ${currentAlertPage} of ${alertPageTotal}, ${alerts.length} alerts`}</span>
              <div className="pagination-buttons">
                <button type="button" className="secondary-button compact-button" onClick={() => setAlertPage((page) => Math.max(1, page - 1))} disabled={currentAlertPage <= 1}>
                  <ArrowLeft aria-hidden="true" />
                  {locale === "zh" ? "上一页" : "Prev"}
                </button>
                <button type="button" className="secondary-button compact-button" onClick={() => setAlertPage((page) => Math.min(alertPageTotal, page + 1))} disabled={currentAlertPage >= alertPageTotal}>
                  {locale === "zh" ? "下一页" : "Next"}
                  <ArrowRight aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>
        )}

        {activeView === "knowledge" && (
          <section className="intelligence-page knowledge-page">
            <section className="panel knowledge-workbench">
              <PanelHeader
                title={locale === "zh" ? "本地知识库" : "Local Knowledge Base"}
                action={<span className="source-badge">{locale === "zh" ? "仅本地数据" : "Local only"}</span>}
              />
              <div className="knowledge-workbench-grid">
                <div className="knowledge-query-column">
                  <div className="knowledge-query-heading">
                    <Bot aria-hidden="true" />
                    <div>
                      <h2>{locale === "zh" ? "问本地运维数据" : "Ask Local Ops Data"}</h2>
                      <p>{locale === "zh" ? "只读取本机数据库中的资产、告警、续费和采集结果。" : "Answers use only local assets, alerts, renewals, and check results."}</p>
                    </div>
                  </div>
                  <form
                    className="knowledge-query"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleKnowledgeQuery();
                    }}
                  >
                    <input
                      value={knowledgeQuestion}
                      onChange={(event) => setKnowledgeQuestion(event.target.value)}
                      placeholder={locale === "zh" ? "例如：哪些服务器缺少 SSH 凭据？" : "Example: which servers are missing SSH credentials?"}
                    />
                    <button type="submit" className="primary-button" disabled={busyAction === "knowledge-query"}>
                      <Bot aria-hidden="true" />
                      {locale === "zh" ? "查询" : "Ask"}
                    </button>
                  </form>
                  <div className="suggestion-row" aria-label={locale === "zh" ? "常用问题" : "Suggested questions"}>
                    {knowledgeSummary.suggested_questions.map((question) => (
                      <button type="button" key={question} onClick={() => void handleKnowledgeQuery(question)}>
                        {question}
                      </button>
                    ))}
                  </div>
                </div>
                <aside className="knowledge-snapshot" aria-label={locale === "zh" ? "知识库数据概览" : "Knowledge data snapshot"}>
                  <div className="knowledge-metrics">
                    <Metric label={locale === "zh" ? "资产" : "Assets"} value={knowledgeSummary.assets_total} icon={Database} />
                    <Metric label={locale === "zh" ? "服务器" : "Servers"} value={knowledgeSummary.server_total} icon={Server} />
                    <Metric label={locale === "zh" ? "30天内到期" : "Due <30d"} value={knowledgeSummary.expiring_soon} icon={CalendarClock} tone={knowledgeSummary.expiring_soon > 0 ? "warn" : "good"} />
                    <Metric label={locale === "zh" ? "已配凭据" : "Credentials"} value={knowledgeSummary.credential_configured} icon={KeyRound} />
                  </div>
                  <div className="knowledge-side-grid">
                    <div className="knowledge-side-card">
                      <h3>{locale === "zh" ? "地域覆盖" : "Region Coverage"}</h3>
                      <div className="knowledge-mini-list">
                        {knowledgeSummary.top_regions.slice(0, 4).map((region) => (
                          <div key={region.region}>
                            <span>{region.region}</span>
                            <strong>{region.count}</strong>
                          </div>
                        ))}
                        {knowledgeSummary.top_regions.length === 0 && <span className="muted-text">-</span>}
                      </div>
                    </div>
                    <div className="knowledge-side-card">
                      <h3>{locale === "zh" ? "风险线索" : "Risk Signals"}</h3>
                      <div className="knowledge-mini-list">
                        {knowledgeSummary.top_risks.slice(0, 4).map((risk) => (
                          <div key={`${risk.asset_id}-${risk.kind}`}>
                            <span>{risk.asset}</span>
                            <strong>{riskKindLabel(risk.kind, locale)}</strong>
                          </div>
                        ))}
                        {knowledgeSummary.top_risks.length === 0 && <span className="muted-text">{locale === "zh" ? "暂无风险" : "No risks"}</span>}
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </section>

            <section className="panel knowledge-answer-panel">
              <PanelHeader title={locale === "zh" ? "查询结果" : "Query Result"} />
              {knowledgeAnswer ? (
                <div className="knowledge-answer">
                  <div className="knowledge-answer-summary">
                    <BookOpen aria-hidden="true" />
                    <div>
                      <span>{knowledgeAnswer.intent}</span>
                      <strong>{knowledgeAnswer.answer}</strong>
                    </div>
                  </div>
                  {knowledgeAnswer.actions.length > 0 && (
                    <div className="knowledge-action-list">
                      {knowledgeAnswer.actions.map((action) => (
                        <span key={action}>{action}</span>
                      ))}
                    </div>
                  )}
                  <div className="knowledge-evidence-grid">
                    {knowledgeAnswer.evidence.slice(0, 12).map((item, index) => (
                      <div className="evidence-card" key={`${knowledgeAnswer.intent}-${index}`}>
                        {Object.entries(item).slice(0, 5).map(([key, value]) => (
                          <div key={key}>
                            <span>{knowledgeFieldLabel(key, locale)}</span>
                            <strong>{formatEvidenceValue(value, locale)}</strong>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="knowledge-empty">
                  <Bot aria-hidden="true" />
                  <strong>{locale === "zh" ? "选择一个问题，或直接输入查询" : "Choose a question or type your own"}</strong>
                  <span>{locale === "zh" ? "回答会显示结论、建议动作和可追溯的数据证据。" : "Results include an answer, suggested actions, and traceable evidence."}</span>
                </div>
              )}
            </section>
          </section>
        )}

        {activeView === "graph" && (
          <section className="graph-page">
            <section className="panel graph-overview-panel">
              <PanelHeader
                title={<AssetViewTitle activeView={activeView} locale={locale} title={t.panels.assets} onChange={setActiveView} />}
                action={<span className="source-badge">{assetGraph.nodes.length} nodes / {assetGraph.edges.length} edges</span>}
              />
              <div className="graph-layout">
                <div className="graph-canvas" aria-label={locale === "zh" ? "资产关系图画布" : "Asset graph canvas"}>
                  <Suspense fallback={<div className="chart-loading" />}>
                    <EChart option={assetGraphOption} />
                  </Suspense>
                </div>
                <div className="graph-side">
                  <div className="graph-side-header">
                    <h3>{locale === "zh" ? "关系来源" : "Sources"}</h3>
                    <span>{assetGraph.edges.length}</span>
                  </div>
                  <div className="relation-list">
                    {assetGraph.edges.map((edge, index) => {
                      const source = assetGraphNodeMap.get(edge.source);
                      const target = assetGraphNodeMap.get(edge.target);
                      return (
                        <div className="relation-item" key={`${edge.source}-${edge.target}-${index}`}>
                          <div className="relation-copy">
                            <strong>{relationLabel(edge.relation, locale)}</strong>
                            <span>{source?.label || edge.source}</span>
                            <span>{target?.label || edge.target}</span>
                          </div>
                          <span className="relation-source">{edge.confidence === "stored" ? (locale === "zh" ? "保存" : "Stored") : (locale === "zh" ? "推断" : "Inferred")}</span>
                        </div>
                      );
                    })}
                    {assetGraph.edges.length === 0 && <EmptyState text={locale === "zh" ? "暂无可推断关系。" : "No inferred relations yet."} />}
                  </div>
                </div>
              </div>
            </section>
          </section>
        )}

        {activeView === "renewals" && (
          <section className="panel table-panel full-height renewal-center-panel">
            <PanelHeader
              title={locale === "zh" ? "续费中心" : "Renewal Center"}
              action={
                <a className="secondary-button" href={ALIYUN_RENEWAL_URL} target="_blank" rel="noreferrer">
                  <CalendarClock aria-hidden="true" />
                  {locale === "zh" ? "打开阿里云续费" : "Open Alibaba Cloud"}
                </a>
              }
            />
            <div className="renewal-summary-strip">
              <Metric label={locale === "zh" ? "资产" : "Assets"} value={renewalCenter.total} icon={Database} />
              <Metric label={locale === "zh" ? "30天内" : "Due <30d"} value={renewalCenter.expiring_soon} icon={CalendarClock} tone={renewalCenter.expiring_soon > 0 ? "warn" : "good"} />
              <Metric label={locale === "zh" ? "已过期" : "Expired"} value={renewalCenter.expired} icon={AlertTriangle} tone={renewalCenter.expired > 0 ? "bad" : "good"} />
              <Metric label={locale === "zh" ? "自动续费" : "Auto renew"} value={renewalCenter.auto_renew_enabled} icon={CheckCircle2} tone="good" />
            </div>
            <div className="renewal-table-shell">
              <table className="renewal-table">
                <thead>
                  <tr>
                    <th>{t.table.asset}</th>
                    <th>{t.table.type}</th>
                    <th>{t.table.region}</th>
                    <th>{t.table.expires}</th>
                    <th>{t.table.renewal}</th>
                    <th>{locale === "zh" ? "来源" : "Source"}</th>
                    <th>{t.table.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {renewalCenter.items.length === 0 && (
                    <tr>
                      <td colSpan={7}><EmptyState text={locale === "zh" ? "暂无续费数据。" : "No renewal data."} /></td>
                    </tr>
                  )}
                  {renewalCenter.items.map((item) => (
                    <tr key={item.asset_id}>
                      <td>
                        <strong>{item.name}</strong>
                        <span className="mono">{item.asset_id}</span>
                      </td>
                      <td>{assetTypeLabel(item.type, locale)}</td>
                      <td>{item.region}</td>
                      <td>{renewalDueLabel(item, locale)}</td>
                      <td><span className={`renewal-status ${item.status}`}>{renewalCenterStatusLabel(item, locale)}</span></td>
                      <td>{renewalSourceLabel(item.source, locale)}</td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            const asset = assets.find((entry) => entry.id === item.asset_id);
                            if (asset) {
                              void handleOpenAssetDetail(asset);
                            }
                          }}
                        >
                          {t.actions.details}
                        </button>
                        {item.console_url && (
                          <a className="text-link" href={item.console_url} target="_blank" rel="noreferrer">
                            {t.actions.openConsole}
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeView === "ai-settings" && (
          <section className="admin-page ai-settings-page">
            <section className="panel ai-config-panel">
              <PanelHeader
                title={t.panels.aiSettings}
                action={
                  <div className="panel-actions">
                    <StatusPill status={aiConfig.configured ? "healthy" : "untested"} locale={locale} />
                    <button type="button" className="primary-button" onClick={() => setAiConfigModalOpen(true)}>
                      <Settings aria-hidden="true" />
                      {locale === "zh" ? "编辑 AI 配置" : "Edit AI Config"}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => void handleTestAiConfig()} disabled={busyAction === "test-ai-config" || !aiConfig.configured}>
                      <Play aria-hidden="true" />
                      {t.actions.testAiConfig}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => void handleClearAiKey()} disabled={!aiConfig.api_key_masked || busyAction === "clear-ai-key"}>
                      <XCircle aria-hidden="true" />
                      {t.actions.clearAiKey}
                    </button>
                  </div>
                }
              />
              <div className="ai-config-grid">
                <div className="config-field">
                  <span>{t.form.aiBaseUrl}</span>
                  <strong className="mono">{aiConfig.base_url || "-"}</strong>
                </div>
                <div className="config-field">
                  <span>{t.form.aiModel}</span>
                  <strong className="mono">{aiConfig.model || "-"}</strong>
                </div>
                <div className="config-field">
                  <span>{t.form.aiApiKey}</span>
                  <strong>{aiConfig.api_key_masked ? aiConfig.api_key_masked : t.settings.keyMissing}</strong>
                </div>
                <div className="config-field">
                  <span>{t.settings.source}</span>
                  <strong>{aiConfig.source === "database" ? t.settings.database : t.settings.environment}</strong>
                </div>
              </div>
              {aiTestResult && (
                <div className={`inline-result ${toneForStatus(aiTestResult.status)}`}>
                  <StatusIcon status={aiTestResult.status} />
                  <span>{localizeGeneratedText(aiTestResult.message, locale)}</span>
                  <code>{aiTestResult.latency_ms ? `${aiTestResult.latency_ms} ms` : aiTestResult.model}</code>
                </div>
              )}
            </section>
          </section>
        )}

        {activeView === "diagnosis" && (
          <section className="diagnosis-layout">
            <section className="panel diagnosis-source-panel">
              <PanelHeader
                title={t.panels.diagnosisSource}
                action={
                  <span className="diagnosis-count">
                    {alerts.length}
                    <span>{locale === "zh" ? "个告警" : " alerts"}</span>
                  </span>
                }
              />
              <div className="diagnosis-source">
                {alerts.slice(0, 8).map((alert) => (
                  <button
                    type="button"
                    key={alert.id}
                    className={`diagnosis-source-item ${activeDiagnosis?.alert_id === alert.id ? "is-active" : ""}`}
                    onClick={() => void handleDiagnoseAlert(alert)}
                    disabled={busyAction === `diagnose-${alert.id}`}
                  >
                    <span className="source-icon">
                      <AlertTriangle aria-hidden="true" />
                    </span>
                    <span className="source-copy">
                      <strong>{localizeGeneratedText(alert.title, locale)}</strong>
                      <span>{localizeGeneratedText(alert.message, locale)}</span>
                    </span>
                    <span className="source-meta">
                      <StatusPill status={alert.severity} locale={locale} />
                      <time>{formatApiDateTime(alert.updated_at, locale)}</time>
                    </span>
                  </button>
                ))}
                {alerts.length === 0 && <EmptyState text={t.empty.noAlerts} />}
              </div>
            </section>
            <section className="panel diagnosis-panel">
              <PanelHeader
                title={t.panels.diagnosis}
                action={
                  activeDiagnosis ? (
                    <div className="diagnosis-meta">
                      <span>{activeDiagnosis.model}</span>
                      <time>{formatApiDateTime(activeDiagnosis.created_at, locale)}</time>
                    </div>
                  ) : null
                }
              />
              {activeDiagnosis ? (
                <div className="diagnosis-body">
                  <section className="diagnosis-summary diagnosis-block">
                    <span className="diagnosis-block-icon">
                      <Bot aria-hidden="true" />
                    </span>
                    <div>
                      <span className="section-kicker">{locale === "zh" ? "故障摘要" : "Summary"}</span>
                      <p>{localizeGeneratedText(activeDiagnosis.summary, locale)}</p>
                    </div>
                  </section>

                  <div className="diagnosis-section-grid">
                    <section className="diagnosis-block">
                      <h3>{t.diagnosis.causes}</h3>
                      <ul className="diagnosis-list">
                        {activeDiagnosis.root_causes.map((cause) => (
                          <li key={cause}>
                            <span className="list-marker">!</span>
                            <span>{localizeGeneratedText(cause, locale)}</span>
                          </li>
                        ))}
                      </ul>
                    </section>

                    <section className="diagnosis-block">
                      <h3>{t.diagnosis.steps}</h3>
                      <ol className="diagnosis-list ordered">
                        {activeDiagnosis.steps.map((step, index) => (
                          <li key={step}>
                            <span className="list-marker">{index + 1}</span>
                            <span>{localizeGeneratedText(step, locale)}</span>
                          </li>
                        ))}
                      </ol>
                    </section>
                  </div>

                  <section className="diagnosis-block command-block">
                    <h3>{t.diagnosis.commands}</h3>
                    <div className="command-list diagnosis-command-list">
                      {activeDiagnosis.commands.map((command) => (
                        <div className="command-row diagnosis-command-row" key={command.command}>
                          <TerminalSquare aria-hidden="true" />
                          <span className="command-main">{renderCopyCommand(command.command)}</span>
                          <span>{localizeGeneratedText(command.reason, locale)}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              ) : (
                <EmptyState text={t.empty.noDiagnosis} />
              )}
            </section>
          </section>
        )}

        {confirmDialog && (
          <ConfirmDialog
            {...confirmDialog}
            onCancel={() => resolveConfirm(false)}
            onConfirm={() => resolveConfirm(true)}
          />
        )}

        {accountModalOpen && (
          <Modal title={t.panels.addAccount} closeLabel={locale === "zh" ? "关闭添加账号弹窗" : "Close add account dialog"} onClose={() => setAccountModalOpen(false)}>
            <form className="modal-form" onSubmit={(event) => void handleCreateAccount(event)} autoComplete="off">
              <label>
                <span>{t.form.accountName}</span>
                <input
                  value={accountForm.name}
                  onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })}
                  autoComplete="off"
                  placeholder={locale === "zh" ? "例如：aliyun-readonly" : "e.g. aliyun-readonly"}
                />
              </label>
              <label>
                <span>{t.form.accessKeyId}</span>
                <input
                  value={accountForm.access_key_id}
                  onChange={(event) => setAccountForm({ ...accountForm, access_key_id: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="LTAI..."
                />
              </label>
              <label>
                <span>{t.form.accessKeySecret}</span>
                <input
                  type="password"
                  value={accountForm.access_key_secret}
                  onChange={(event) => setAccountForm({ ...accountForm, access_key_secret: event.target.value })}
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder={locale === "zh" ? "仅粘贴同一次创建显示的 Secret" : "Paste the Secret from the same creation dialog"}
                />
              </label>
              <label>
                <span>{t.form.defaultRegion}</span>
                <input
                  value={accountForm.default_region}
                  onChange={(event) => setAccountForm({ ...accountForm, default_region: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="cn-hangzhou"
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setAccountModalOpen(false)}>
                  {locale === "zh" ? "取消" : "Cancel"}
                </button>
                <button type="submit" className="primary-button" disabled={busyAction === "create-account"}>
                  <KeyRound aria-hidden="true" />
                  {t.actions.saveEncrypted}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {checkModalOpen && (
          <Modal title={t.panels.createCheck} closeLabel={locale === "zh" ? "关闭创建监控弹窗" : "Close create check dialog"} onClose={() => setCheckModalOpen(false)}>
            <form className="modal-form" onSubmit={(event) => void handleCreateCheck(event)}>
              <label>
                <span>{t.form.checkName}</span>
                <input
                  value={checkForm.name}
                  onChange={(event) => setCheckForm({ ...checkForm, name: event.target.value })}
                  placeholder={locale === "zh" ? "例如：官网探活 / 磁盘检查" : "e.g. website probe / disk check"}
                  required
                />
              </label>
              <label>
                <span>{t.form.checkType}</span>
                <select value={checkForm.type} onChange={(event) => handleCheckTypeChange(event.target.value)}>
                  <option value="http">{locale === "zh" ? "HTTP 探活" : "HTTP probe"}</option>
                  <option value="tcp">{locale === "zh" ? "TCP 端口" : "TCP port"}</option>
                  <option value="ssh">{locale === "zh" ? "SSH 可连通" : "SSH reachability"}</option>
                  <option value="ecs_metric">{locale === "zh" ? "ECS 指标" : "ECS metric"}</option>
                  <option value="cloud_assistant">{locale === "zh" ? "云助手只读命令" : "Cloud Assistant command"}</option>
                </select>
              </label>
              <div className="check-type-help">
                <strong>{activeCheckTypeInfo.title}</strong>
                <span>{activeCheckTypeInfo.description}</span>
                <dl>
                  <div>
                    <dt>{locale === "zh" ? "目标" : "Target"}</dt>
                    <dd>{activeCheckTypeInfo.target}</dd>
                  </div>
                  <div>
                    <dt>{locale === "zh" ? "前提" : "Requires"}</dt>
                    <dd>{activeCheckTypeInfo.requirement}</dd>
                  </div>
                </dl>
              </div>
              <label>
                <span>{t.form.checkTarget}</span>
                <input
                  value={checkForm.target}
                  onChange={(event) => setCheckForm({ ...checkForm, target: event.target.value })}
                  placeholder={defaultCheckTarget(null, checkForm.type)}
                  required
                />
              </label>
              <label>
                <span>{t.form.linkedAsset}</span>
                <select value={checkForm.asset_id} onChange={(event) => handleLinkedAssetChange(event.target.value)}>
                  <option value="">{t.form.noAsset}</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{locale === "zh" ? "监控组" : "Monitor Group"}</span>
                <select value={checkForm.group_id} onChange={(event) => setCheckForm({ ...checkForm, group_id: event.target.value })}>
                  <option value="">{locale === "zh" ? "自动归组" : "Auto group"}</option>
                  {monitorGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-grid two-columns">
                <label>
                  <span>{locale === "zh" ? "执行间隔" : "Interval"}</span>
                  <select value={checkForm.interval_seconds} onChange={(event) => setCheckForm({ ...checkForm, interval_seconds: event.target.value })}>
                    <option value="60">{locale === "zh" ? "1 分钟" : "1 minute"}</option>
                    <option value="300">{locale === "zh" ? "5 分钟" : "5 minutes"}</option>
                    <option value="900">{locale === "zh" ? "15 分钟" : "15 minutes"}</option>
                    <option value="1800">{locale === "zh" ? "30 分钟" : "30 minutes"}</option>
                    <option value="3600">{locale === "zh" ? "1 小时" : "1 hour"}</option>
                  </select>
                </label>
                <label>
                  <span>{t.table.threshold}</span>
                  <input inputMode="decimal" value={checkForm.threshold} onChange={(event) => setCheckForm({ ...checkForm, threshold: event.target.value })} placeholder={t.form.optionalThreshold} />
                </label>
              </div>
              <div className="form-grid two-columns">
                <label>
                  <span>{t.form.failureThreshold}</span>
                  <input inputMode="numeric" value={checkForm.failure_threshold} onChange={(event) => setCheckForm({ ...checkForm, failure_threshold: event.target.value })} />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setCheckModalOpen(false)}>
                  {locale === "zh" ? "取消" : "Cancel"}
                </button>
                <button type="submit" className="primary-button" disabled={busyAction === "create-check"}>
                  <Activity aria-hidden="true" />
                  {t.actions.createCheck}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {opsModalOpen && selectedAsset && (
          <Modal title={t.panels.opsProfile} closeLabel={locale === "zh" ? "关闭续费资料弹窗" : "Close renewal dialog"} onClose={() => setOpsModalOpen(false)}>
            <form className="modal-form" onSubmit={(event) => void handleSaveAssetOps(event)}>
              <div className="form-grid two-columns">
                <label>
                  <span>{t.form.renewalExpiresAt}</span>
                  <input
                    type="date"
                    value={opsForm.renewal_expires_at}
                    onChange={(event) => setOpsForm({ ...opsForm, renewal_expires_at: event.target.value })}
                  />
                </label>
                <label>
                  <span>{t.form.renewalAutoRenew}</span>
                  <select
                    value={opsForm.renewal_auto_renew ? "enabled" : "disabled"}
                    onChange={(event) => setOpsForm({ ...opsForm, renewal_auto_renew: event.target.value === "enabled" })}
                  >
                    <option value="disabled">{t.form.renewalUnknown}</option>
                    <option value="enabled">{t.form.renewalEnabled}</option>
                  </select>
                </label>
              </div>
              <label>
                <span>{t.form.loginUrl}</span>
                <input
                  type="url"
                  value={opsForm.login_url}
                  onChange={(event) => setOpsForm({ ...opsForm, login_url: event.target.value })}
                  placeholder="https://console.aliyun.com"
                />
              </label>
              <label>
                <span>{t.form.serviceUrl}</span>
                <input
                  type="url"
                  value={opsForm.service_url}
                  onChange={(event) => setOpsForm({ ...opsForm, service_url: event.target.value })}
                  placeholder="https://example.com"
                />
              </label>
              <label>
                <span>{t.form.renewalNotes}</span>
                <textarea
                  value={opsForm.renewal_notes}
                  onChange={(event) => setOpsForm({ ...opsForm, renewal_notes: event.target.value })}
                  placeholder={locale === "zh" ? "负责人、续费周期、业务影响范围" : "Owner, renewal cycle, business impact"}
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setOpsModalOpen(false)}>
                  {locale === "zh" ? "取消" : "Cancel"}
                </button>
                <button type="submit" className="primary-button" disabled={busyAction === `asset-ops-${selectedAsset.id}`}>
                  <Save aria-hidden="true" />
                  {t.actions.saveOps}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {btPanelModalOpen && selectedAsset && (
          <Modal title={t.panels.btPanel} closeLabel={locale === "zh" ? "关闭宝塔面板弹窗" : "Close BT panel dialog"} onClose={() => setBtPanelModalOpen(false)}>
            <form className="modal-form" onSubmit={(event) => void handleSaveBtPanelProfile(event)}>
              <label>
                <span>{t.form.btPanelUrl}</span>
                <input
                  type="url"
                  value={btPanelForm.url}
                  onChange={(event) => setBtPanelForm({ ...btPanelForm, url: event.target.value })}
                  placeholder="http://203.0.113.10:8888/security-entry"
                />
              </label>
              <div className="form-grid two-columns">
                <label>
                  <span>{t.form.btPanelUsername}</span>
                  <input
                    value={btPanelForm.username}
                    onChange={(event) => setBtPanelForm({ ...btPanelForm, username: event.target.value })}
                    placeholder="bt-admin"
                    autoComplete="username"
                  />
                </label>
                <label>
                  <span>{t.form.btPanelPassword}</span>
                  <input
                    type="password"
                    value={btPanelForm.password}
                    onChange={(event) => setBtPanelForm({ ...btPanelForm, password: event.target.value, clear_password: false })}
                    placeholder={btPanelProfile.password_configured ? t.settings.secretPlaceholder : t.form.btPanelPassword}
                    autoComplete="new-password"
                  />
                </label>
              </div>
              {btPanelProfile.password_configured && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={btPanelForm.clear_password}
                    onChange={(event) => setBtPanelForm({ ...btPanelForm, clear_password: event.target.checked, password: "" })}
                  />
                  <span>{t.form.clearBtPanelPassword}</span>
                </label>
              )}
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={btPanelForm.enabled}
                  onChange={(event) => setBtPanelForm({ ...btPanelForm, enabled: event.target.checked })}
                />
                <span>{t.form.btPanelEnabled}</span>
              </label>
              <label>
                <span>{t.form.btPanelNotes}</span>
                <textarea
                  value={btPanelForm.notes}
                  onChange={(event) => setBtPanelForm({ ...btPanelForm, notes: event.target.value })}
                  placeholder={locale === "zh" ? "例如：宝塔安全入口、负责人、使用范围" : "Security entry, owner, usage scope"}
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setBtPanelModalOpen(false)}>
                  {locale === "zh" ? "取消" : "Cancel"}
                </button>
                <button type="submit" className="primary-button" disabled={busyAction === `asset-bt-panel-${selectedAsset.id}`}>
                  <KeyRound aria-hidden="true" />
                  {t.actions.saveBtPanel}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {accessModalOpen && selectedAsset && (
          <Modal title={t.panels.accessProfile} closeLabel={locale === "zh" ? "关闭 SSH 访问弹窗" : "Close SSH access dialog"} onClose={() => setAccessModalOpen(false)}>
            <form className="modal-form" onSubmit={(event) => void handleSaveAccessProfile(event)}>
              {!accessProfile.secret_configured && (
                <div className="form-callout setup-guide-callout">
                  <CircleHelp aria-hidden="true" />
                  <div>
                    <strong>{locale === "zh" ? "第一次配置 SSH 密码" : "First-time SSH password setup"}</strong>
                    {locale === "zh" ? (
                      <ol>
                        <li>没有密码：到阿里云 ECS/轻量服务器详情里重置实例登录密码，按提示重启。</li>
                        <li>已经能进终端：执行 {renderCopyCommand("passwd root")}，连续输入两次新密码。</li>
                        <li>确认 SSH 端口：执行 {renderCopyCommand("ss -lntp | grep ':22'")}，并放行安全组/防火墙 22 端口。</li>
                        <li>本弹窗选择 SSH 密码，填写公网 IP、端口 22、登录用户（通常 root）和刚设置的服务器系统密码。</li>
                      </ol>
                    ) : (
                      <ol>
                        <li>No password: reset the instance login password in Alibaba Cloud ECS/SWAS, then reboot if required.</li>
                        <li>Already have a shell: run {renderCopyCommand("passwd root")} and enter the new password twice.</li>
                        <li>Check SSH port: run {renderCopyCommand("ss -lntp | grep ':22'")} and allow port 22 in firewall/security group.</li>
                        <li>Select SSH password here, then fill public IP, port 22, username, usually root, and that server OS password.</li>
                      </ol>
                    )}
                    <span>{locale === "zh" ? "注意：这里填的是服务器系统登录密码，不是宝塔面板密码。" : "Note: enter the server OS login password, not the BT panel password."}</span>
                  </div>
                </div>
              )}
              <div className="form-grid two-columns">
                <label>
                  <span>{t.form.accessMethod}</span>
                  <select
                    value={accessForm.method}
                    onChange={(event) => {
                      const method = event.target.value;
                      setAccessForm({ ...accessForm, method, username: defaultAccessUsername(method, accessForm.username) });
                    }}
                  >
                    <option value="cloud_assistant">{locale === "zh" ? "云助手优先" : "Cloud Assistant first"}</option>
                    <option value="ssh_password">{locale === "zh" ? "SSH 密码" : "SSH password"}</option>
                    <option value="ssh_key">{locale === "zh" ? "SSH 私钥" : "SSH private key"}</option>
                  </select>
                </label>
                <label>
                  <span>{t.form.accessPort}</span>
                  <input
                    inputMode="numeric"
                    value={accessForm.port}
                    onChange={(event) => setAccessForm({ ...accessForm, port: event.target.value })}
                    placeholder="22"
                  />
                </label>
              </div>
              <div className="form-grid two-columns">
                <label>
                  <span>{t.form.accessHost}</span>
                  <input
                    value={accessForm.host}
                    onChange={(event) => setAccessForm({ ...accessForm, host: event.target.value })}
                    placeholder={defaultAssetHost(selectedAsset) || "203.0.113.10"}
                  />
                </label>
                <label>
                  <span>{t.form.accessUsername}</span>
                  <input
                    value={accessForm.username}
                    onChange={(event) => setAccessForm({ ...accessForm, username: event.target.value })}
                    placeholder={accessForm.method === "cloud_assistant" ? "-" : "root"}
                  />
                </label>
              </div>
              {accessForm.method !== "cloud_assistant" && (
                <>
                  <div className="form-callout">
                    <CircleHelp aria-hidden="true" />
                    <div>
                      <strong>{locale === "zh" ? "首次配置必须填写凭据" : "Credential required on first setup"}</strong>
                      <span>
                        {accessForm.method === "ssh_key"
                          ? locale === "zh"
                            ? "粘贴能登录该服务器的 SSH 私钥。保存后只加密存储，不在页面明文展示。"
                            : "Paste the private key that can log in to this server. It is encrypted after saving and not shown in plaintext."
                          : locale === "zh"
                            ? "这里必须同时填写登录用户和服务器系统登录密码，不是宝塔面板密码。忘记密码可到阿里云重置；已能进终端时可执行 passwd root 设置。"
                            : "Enter both the login username and server OS password, not the BT panel password. Reset it in Alibaba Cloud, or run passwd root from an existing shell."}
                      </span>
                    </div>
                  </div>
                  <label>
                    <span>{accessForm.method === "ssh_key" ? (locale === "zh" ? "SSH 私钥" : "SSH Private Key") : (locale === "zh" ? "服务器登录密码" : "Server Login Password")}</span>
                    {accessForm.method === "ssh_key" ? (
                      <textarea
                        className="secret-textarea"
                        value={accessForm.secret}
                        onChange={(event) => setAccessForm({ ...accessForm, secret: event.target.value, clear_secret: false })}
                        placeholder={accessProfile.secret_configured ? t.settings.secretPlaceholder : "-----BEGIN OPENSSH PRIVATE KEY-----"}
                        spellCheck={false}
                      />
                    ) : (
                      <input
                        type="password"
                        value={accessForm.secret}
                        onChange={(event) => setAccessForm({ ...accessForm, secret: event.target.value, clear_secret: false })}
                        placeholder={accessProfile.secret_configured ? t.settings.secretPlaceholder : (locale === "zh" ? "填写服务器 root/管理员登录密码" : "Enter server root/admin login password")}
                        autoComplete="new-password"
                      />
                    )}
                  </label>
                </>
              )}
              {accessProfile.secret_configured && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={accessForm.clear_secret}
                    onChange={(event) => setAccessForm({ ...accessForm, clear_secret: event.target.checked, secret: "" })}
                  />
                  <span>{locale === "zh" ? "清除已保存密钥/密码" : "Clear saved secret"}</span>
                </label>
              )}
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={accessForm.enabled}
                  onChange={(event) => setAccessForm({ ...accessForm, enabled: event.target.checked })}
                />
                <span>{t.form.accessEnabled}</span>
              </label>
              <label>
                <span>{t.form.accessNotes}</span>
                <textarea
                  value={accessForm.notes}
                  onChange={(event) => setAccessForm({ ...accessForm, notes: event.target.value })}
                  placeholder={locale === "zh" ? "例如：仅人工排障使用，不自动修复" : "For manual triage only; no automatic repair"}
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setAccessModalOpen(false)}>
                  {locale === "zh" ? "取消" : "Cancel"}
                </button>
                <button type="submit" className="primary-button" disabled={busyAction === `asset-access-${selectedAsset.id}`}>
                  <LockKeyhole aria-hidden="true" />
                  {t.actions.saveAccess}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {aiConfigModalOpen && (
          <Modal title={t.panels.aiSettings} closeLabel={locale === "zh" ? "关闭 AI 配置弹窗" : "Close AI config dialog"} onClose={() => setAiConfigModalOpen(false)}>
            <form className="modal-form" onSubmit={(event) => void handleSaveAiConfig(event)}>
              <label>
                <span>{t.form.aiBaseUrl}</span>
                <input
                  type="url"
                  value={aiConfigForm.base_url}
                  onChange={(event) => setAiConfigForm({ ...aiConfigForm, base_url: event.target.value })}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label>
                <span>{t.form.aiApiKey}</span>
                <input
                  type="password"
                  value={aiConfigForm.api_key}
                  onChange={(event) => setAiConfigForm({ ...aiConfigForm, api_key: event.target.value })}
                  placeholder={aiConfig.api_key_masked || t.settings.keepKeyHint}
                  autoComplete="new-password"
                />
              </label>
              <label>
                <span>{t.form.aiModel}</span>
                <input value={aiConfigForm.model} onChange={(event) => setAiConfigForm({ ...aiConfigForm, model: event.target.value })} />
              </label>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setAiConfigModalOpen(false)}>
                  {locale === "zh" ? "取消" : "Cancel"}
                </button>
                <button type="submit" className="primary-button" disabled={busyAction === "save-ai-config"}>
                  <Settings aria-hidden="true" />
                  {t.actions.saveAiConfig}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </main>
    </div>
  );
}

function presentLoginNotice(message: string, locale: Locale): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("load failed") ||
    normalized.includes("unable to connect")
  ) {
    return locale === "zh"
      ? "无法连接本地 API，请确认后端已启动后再登录。"
      : "Cannot connect to the local API. Start the backend and try again.";
  }
  if (normalized.includes("invalid") || normalized.includes("unauthorized")) {
    return locale === "zh" ? "用户名或密码不正确。" : "Invalid username or password.";
  }
  return presentNotice(message, locale);
}

function presentNotice(message: string, locale: Locale): string {
  if (locale === "zh" && message.includes("Alibaba Cloud signature verification failed")) {
    return "阿里云签名校验失败：AccessKey ID 和 AccessKey Secret 必须是同一次创建的一组密钥，且不能包含多余空格或换行。如果 Secret 没保存，请创建新的 RAM AccessKey，并删除错误账号后重新录入。";
  }
  if (locale === "zh" && message.includes("Alibaba Cloud permission denied")) {
    return "阿里云权限不足：请检查 RAM 用户是否具备只读资产、ECS、CloudMonitor、OSS、域名和 DNS 查询权限。";
  }
  if (locale === "zh" && message.includes("SSH username is required")) {
    return "SSH 登录用户不能为空。常见用户名是 root；占位提示不会自动保存，请在登录用户输入框中实际填写。";
  }
  return message;
}

function refreshActionLabel(view: View, locale: Locale): string {
  const zh = locale === "zh";
  if (view === "assets") {
    return zh ? "刷新本地资产表格，不同步阿里云" : "Refresh local asset table without cloud sync";
  }
  return zh ? "刷新本地页面数据" : "Refresh local page data";
}

function noticeDismissDelay(message: string): number {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("失败") ||
    normalized.includes("错误") ||
    normalized.includes("异常") ||
    normalized.includes("failed") ||
    normalized.includes("error") ||
    normalized.includes("denied")
  ) {
    return 5200;
  }
  return 2800;
}

function busyNotice(label: string, locale: Locale): string {
  const zh = locale === "zh";
  if (label === "refresh") {
    return zh ? "正在刷新数据..." : "Refreshing data...";
  }
  if (label.startsWith("test-")) {
    return zh
      ? "正在测试云账号凭据和权限..."
      : "Testing cloud account credentials and permissions...";
  }
  if (label === "sync-assets") {
    return zh
      ? "正在同步阿里云资产..."
      : "Syncing Alibaba Cloud assets...";
  }
  if (label === "create-account") {
    return zh ? "正在保存云账号..." : "Saving cloud account...";
  }
  if (label.startsWith("delete-account") || label === "delete-failed-accounts") {
    return zh ? "正在删除云账号..." : "Deleting cloud account...";
  }
  if (label.startsWith("asset-detail")) {
    return zh ? "正在加载资产详情..." : "Loading asset details...";
  }
  if (label.startsWith("asset-ops")) {
    return zh ? "正在保存续费与入口资料..." : "Saving renewal and entrypoint profile...";
  }
  if (label.startsWith("asset-access")) {
    return zh ? "正在保存服务器访问资料..." : "Saving server access profile...";
  }
  if (label.startsWith("access-secret-")) {
    return zh ? "正在复制 SSH 凭据..." : "Copying SSH credential...";
  }
  if (label.startsWith("asset-bt-panel")) {
    return zh ? "正在保存宝塔面板资料..." : "Saving BT panel profile...";
  }
  if (label.startsWith("collect-runtime")) {
    return zh ? "正在采集服务器使用率..." : "Collecting server usage...";
  }
  if (label === "create-check") {
    return zh ? "正在创建监控项..." : "Creating check...";
  }
  if (label.startsWith("run-")) {
    return zh ? "正在执行监控项..." : "Running check...";
  }
  if (label.startsWith("toggle-check")) {
    return zh ? "正在更新监控项状态..." : "Updating check status...";
  }
  if (label.startsWith("delete-check") || label === "delete-all-checks") {
    return zh ? "正在删除监控项..." : "Deleting checks...";
  }
  if (label.startsWith("alert-")) {
    return zh ? "正在更新告警..." : "Updating alert...";
  }
  if (label.startsWith("diagnose-")) {
    return zh ? "正在生成 AI 诊断..." : "Generating AI diagnosis...";
  }
  if (label === "save-ai-config") {
    return zh ? "正在保存 AI 配置..." : "Saving AI config...";
  }
  if (label === "clear-ai-key") {
    return zh ? "正在清除 AI Key..." : "Clearing AI key...";
  }
  if (label === "test-ai-config") {
    return zh ? "正在测试 AI 接口..." : "Testing AI endpoint...";
  }
  return zh ? "正在处理..." : "Working...";
}

function metadataSection(metadata: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = metadata[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the textarea fallback for HTTP LAN access.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.insetInlineStart = "-9999px";
  textarea.style.insetBlockStart = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    if (!document.execCommand("copy")) {
      throw new Error("copy failed");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function defaultAssetHost(asset: Asset | null): string {
  if (!asset) {
    return "";
  }
  const accessProfile = metadataSection(asset.metadata_json, "access_profile");
  const accessHost = textValue(accessProfile.host);
  if (accessHost) {
    return accessHost;
  }
  for (const key of ["public_ip", "public_ip_address", "ip_address", "internet_ip", "eip_address"]) {
    const value = asset.metadata_json[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
      return value[0].trim();
    }
  }
  return "";
}

function checkTypeDescription(type: string, locale: Locale): { title: string; description: string; target: string; requirement: string } {
  const zh: Record<string, { title: string; description: string; target: string; requirement: string }> = {
    http: {
      title: "HTTP 探活",
      description: "请求一个 URL，判断 200-399 状态码为正常，并记录响应时间。",
      target: "https://example.com 或 http://IP",
      requirement: "目标地址必须能从本机访问。"
    },
    tcp: {
      title: "TCP 端口",
      description: "尝试连接主机端口，用来判断 80、443、3306、8888 等端口是否开放。",
      target: "203.0.113.10:80",
      requirement: "本机网络能连到该 IP 和端口。"
    },
    ssh: {
      title: "SSH 可连通",
      description: "使用资产详情里保存的 SSH 用户、密码或私钥登录一次，验证服务器可登录。",
      target: "203.0.113.10:22",
      requirement: "先在资产详情配置 SSH 访问资料。"
    },
    ecs_metric: {
      title: "ECS 指标",
      description: "通过阿里云 CloudMonitor 查询 ECS 指标，例如 CPU 使用率。",
      target: "CPUUtilization",
      requirement: "关联 ECS 资产，并且 RAM 有 CloudMonitor 查询权限。"
    },
    cloud_assistant: {
      title: "云助手只读命令",
      description: "通过阿里云云助手执行白名单只读命令，采集磁盘、内存、端口等状态。",
      target: "df -h、free -m、ss -lntp",
      requirement: "ECS 需支持云助手；否则会尝试使用已配置的 SSH 访问资料。"
    }
  };
  const en: Record<string, { title: string; description: string; target: string; requirement: string }> = {
    http: {
      title: "HTTP probe",
      description: "Requests a URL, treats HTTP 200-399 as healthy, and records latency.",
      target: "https://example.com or http://IP",
      requirement: "The URL must be reachable from this machine."
    },
    tcp: {
      title: "TCP port",
      description: "Connects to a host and port to verify whether a service port is open.",
      target: "203.0.113.10:80",
      requirement: "This machine must be able to reach the IP and port."
    },
    ssh: {
      title: "SSH reachability",
      description: "Logs in with the SSH username and password/key saved on the asset.",
      target: "203.0.113.10:22",
      requirement: "Configure the asset SSH access profile first."
    },
    ecs_metric: {
      title: "ECS metric",
      description: "Queries Alibaba Cloud CloudMonitor metrics for ECS, such as CPU usage.",
      target: "CPUUtilization",
      requirement: "Link an ECS asset and grant RAM CloudMonitor read permission."
    },
    cloud_assistant: {
      title: "Cloud Assistant command",
      description: "Runs whitelisted read-only commands to collect disk, memory, and port state.",
      target: "df -h, free -m, ss -lntp",
      requirement: "ECS should support Cloud Assistant; otherwise configured SSH is used."
    }
  };
  return (locale === "zh" ? zh : en)[type] ?? (locale === "zh" ? zh.http : en.http);
}

function defaultCheckTarget(asset: Asset | null, type: string, preferredHost = ""): string {
  const host = preferredHost || defaultAssetHost(asset);
  const ops = asset ? metadataSection(asset.metadata_json, "ops") : {};
  if (type === "cloud_assistant") {
    return "df -h";
  }
  if (type === "ecs_metric") {
    return "CPUUtilization";
  }
  if (type === "ssh") {
    return host ? `${host}:22` : "";
  }
  if (type === "tcp") {
    return host ? `${host}:80` : "";
  }
  if (type === "http") {
    const serviceUrl = textValue(ops.service_url);
    if (serviceUrl) {
      return serviceUrl;
    }
    if (asset?.type === "domain" || asset?.type === "dns") {
      return `https://${asset.name}`;
    }
    return host ? `http://${host}` : "";
  }
  return "";
}

function PanelHeader({ title, action }: { title: React.ReactNode; action?: React.ReactNode }): JSX.Element {
  return (
    <div className="panel-header">
      <div className="panel-title">
        {typeof title === "string" ? <h2>{title}</h2> : title}
      </div>
      {action}
    </div>
  );
}

function AssetViewTitle({
  activeView,
  locale,
  title,
  onChange
}: {
  activeView: View;
  locale: Locale;
  title: string;
  onChange: (view: "assets" | "graph") => void;
}): JSX.Element {
  return (
    <div className="asset-view-title">
      <h2>{title}</h2>
      <div className="asset-view-tabs" role="tablist" aria-label={locale === "zh" ? "资产视图" : "Asset views"}>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "assets"}
          className={activeView === "assets" ? "is-selected" : ""}
          onClick={() => onChange("assets")}
        >
          {locale === "zh" ? "列表" : "List"}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "graph"}
          className={activeView === "graph" ? "is-selected" : ""}
          onClick={() => onChange("graph")}
        >
          {locale === "zh" ? "关系图" : "Graph"}
        </button>
      </div>
    </div>
  );
}

function HelpTooltip({ label, title, children }: { label: string; title: string; children: React.ReactNode }): JSX.Element {
  return (
    <span className="help-tooltip">
      <button type="button" className="help-tooltip-trigger" aria-label={label}>
        <CircleHelp aria-hidden="true" />
      </button>
      <span className="help-tooltip-card" role="tooltip">
        <strong>{title}</strong>
        <span>{children}</span>
      </span>
    </span>
  );
}

function Modal({
  title,
  closeLabel,
  onClose,
  children
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}): JSX.Element {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="modal-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button compact-icon-button" onClick={onClose} aria-label={closeLabel}>
            <XCircle aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = "default",
  onConfirm,
  onCancel
}: ConfirmDialogOptions & {
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onCancel();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section className={`modal-panel confirm-dialog is-${tone}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
        <div className="confirm-dialog-icon" aria-hidden="true">
          <AlertTriangle />
        </div>
        <div className="confirm-dialog-content">
          <h2 id="confirm-dialog-title">{title}</h2>
          <p id="confirm-dialog-message">{message}</p>
        </div>
        <div className="confirm-dialog-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={tone === "danger" ? "secondary-button danger-button" : "primary-button"} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  note
}: {
  label: string;
  value: string | number;
  icon: typeof Gauge;
  tone?: "neutral" | "good" | "warn" | "bad";
  note?: string;
}): JSX.Element {
  return (
    <div className={`metric is-${tone}`}>
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function RiskOverview({
  summary,
  items,
  locale
}: {
  summary: DashboardSummary["risk_summary"];
  items: DashboardSummary["risk_items"];
  locale: Locale;
}): JSX.Element {
  const summaryByKind = new Map(summary.map((item) => [item.kind, item]));
  const total = summary.reduce((sum, item) => sum + item.count, 0);
  return (
    <div className="risk-overview">
      <div className="risk-summary-grid" aria-label={locale === "zh" ? "风险分类" : "Risk categories"}>
        {riskOverviewKinds.map((kind) => {
          const item = summaryByKind.get(kind);
          const count = item?.count ?? 0;
          const severity = count > 0 ? item?.severity ?? "info" : "empty";
          return (
            <div className={`risk-summary-card is-${severity}`} key={kind}>
              <span>{riskKindLabel(kind, locale)}</span>
              <strong>{count}</strong>
            </div>
          );
        })}
      </div>
      <div className="risk-list">
        {items.slice(0, 5).map((risk) => (
          <div className={`risk-item is-${risk.severity ?? "info"}`} key={`${risk.asset_id}-${risk.kind}`}>
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>{risk.asset}</strong>
              <span>{riskDetailText(risk, locale)}</span>
            </div>
          </div>
        ))}
        {total === 0 && <EmptyState text={locale === "zh" ? "暂无风险或采集缺口" : "No risks or collection gaps"} />}
        {items.length > 5 && (
          <p className="risk-more">
            {locale === "zh" ? `还有 ${items.length - 5} 项未展示` : `${items.length - 5} more hidden`}
          </p>
        )}
      </div>
    </div>
  );
}

function riskKindLabel(kind: string, locale: Locale): string {
  const zh: Record<string, string> = {
    disk_high: "磁盘高",
    memory_high: "内存高",
    expiring: "即将到期",
    access_missing: "SSH 未配置",
    usage_missing: "未采集"
  };
  const en: Record<string, string> = {
    disk_high: "Disk High",
    memory_high: "Memory High",
    expiring: "Expiring",
    access_missing: "SSH Missing",
    usage_missing: "No Usage"
  };
  return (locale === "zh" ? zh : en)[kind] ?? kind;
}

function riskDetailText(risk: DashboardSummary["risk_items"][number], locale: Locale): string {
  const label = riskKindLabel(risk.kind, locale);
  if ((risk.kind === "disk_high" || risk.kind === "memory_high") && typeof risk.value === "number") {
    return `${label} ${Number(risk.value.toFixed(1))}%`;
  }
  if (risk.kind === "expiring" && typeof risk.value === "number") {
    return locale === "zh" ? `${label}：${Math.round(risk.value)} 天内` : `${label}: ${Math.round(risk.value)} days`;
  }
  if (risk.kind === "access_missing") {
    return locale === "zh" ? "缺少可用 SSH 用户名或密码/私钥" : "Missing usable SSH username or password/key";
  }
  if (risk.kind === "usage_missing") {
    return locale === "zh" ? "还没有内存/磁盘使用率采集结果" : "No memory/disk usage sample yet";
  }
  return label;
}

function summarizeChecks(checks: Check[]): { total: number; failing: number; ok: number; never: number; disabled: number } {
  return checks.reduce(
    (summary, check) => {
      summary.total += 1;
      if (!check.enabled) {
        summary.disabled += 1;
      } else if (check.open_alert_id || check.last_status === "failed") {
        summary.failing += 1;
      } else if (!check.last_status) {
        summary.never += 1;
      } else if (check.last_status === "ok") {
        summary.ok += 1;
      }
      return summary;
    },
    { total: 0, failing: 0, ok: 0, never: 0, disabled: 0 }
  );
}

function summarizeAlerts(alerts: Alert[]): { total: number; open: number; acknowledged: number; closed: number } {
  return alerts.reduce(
    (summary, alert) => {
      summary.total += 1;
      if (alert.status === "open") {
        summary.open += 1;
      } else if (alert.status === "acknowledged") {
        summary.acknowledged += 1;
      } else if (alert.status === "closed") {
        summary.closed += 1;
      }
      return summary;
    },
    { total: 0, open: 0, acknowledged: 0, closed: 0 }
  );
}

function checkMatchesFilter(check: Check, filter: CheckFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "disabled") {
    return !check.enabled;
  }
  if (filter === "never") {
    return check.enabled && !check.last_status;
  }
  if (filter === "failing") {
    return check.enabled && Boolean(check.open_alert_id || check.last_status === "failed");
  }
  return check.enabled && check.last_status === "ok" && !check.open_alert_id;
}

function checkMatchesGroup(check: Check, groupId: string): boolean {
  if (groupId === "all") {
    return true;
  }
  if (groupId === "ungrouped") {
    return !check.group_id;
  }
  return String(check.group_id) === groupId;
}

function monitorGroupTypeLabel(type: string, locale: Locale): string {
  const zh: Record<string, string> = {
    all: "全部",
    server: "服务器",
    domain: "域名",
    oss: "OSS",
    dns: "DNS",
    custom: "自定义"
  };
  const en: Record<string, string> = {
    all: "All",
    server: "Server",
    domain: "Domain",
    oss: "OSS",
    dns: "DNS",
    custom: "Custom"
  };
  return (locale === "zh" ? zh : en)[type] || type;
}

function checkFilterLabel(filter: CheckFilter, locale: Locale): string {
  const zh: Record<CheckFilter, string> = {
    all: "全部",
    failing: "异常",
    ok: "正常",
    never: "未执行",
    disabled: "已停用"
  };
  const en: Record<CheckFilter, string> = {
    all: "All",
    failing: "Failing",
    ok: "OK",
    never: "Never Run",
    disabled: "Disabled"
  };
  return (locale === "zh" ? zh : en)[filter];
}

function checkStatusForDisplay(check: Check): string {
  if (!check.enabled) {
    return "pending";
  }
  if (check.open_alert_id || check.last_status === "failed") {
    return "failed";
  }
  return check.last_status || "untested";
}

function checkPurposeLabel(check: Check, locale: Locale): string {
  const target = check.target.toLowerCase();
  if (check.type === "cloud_assistant" && target.startsWith("df")) {
    return locale === "zh" ? "磁盘使用率" : "Disk Usage";
  }
  if (check.type === "cloud_assistant" && target.startsWith("free")) {
    return locale === "zh" ? "内存使用率" : "Memory Usage";
  }
  if (check.type === "ecs_metric") {
    return locale === "zh" ? "云监控指标" : "Cloud Metric";
  }
  if (check.type === "http") {
    return locale === "zh" ? "网站探活" : "HTTP Probe";
  }
  if (check.type === "tcp") {
    return locale === "zh" ? "端口连通" : "TCP Probe";
  }
  if (check.type === "ssh") {
    return locale === "zh" ? "SSH 连通" : "SSH Login";
  }
  return check.name;
}

function checkScheduleLabel(check: Check, locale: Locale): string {
  const seconds = check.interval_seconds;
  const interval = seconds >= 3600
    ? `${Math.round(seconds / 3600)}h`
    : seconds >= 60
      ? `${Math.round(seconds / 60)}m`
      : `${seconds}s`;
  const failure = locale === "zh" ? `${check.failure_threshold} 次失败告警` : `${check.failure_threshold} failures`;
  return `${check.enabled ? interval : (locale === "zh" ? "停用" : "Disabled")} / ${failure}`;
}

function checkLatestValue(check: Check, locale: Locale): string {
  if (!check.last_status) {
    return locale === "zh" ? "未执行" : "Never run";
  }
  if (check.type === "http" && typeof check.last_value === "number") {
    return `HTTP ${Math.round(check.last_value)}`;
  }
  if ((check.type === "tcp" || check.type === "ssh") && typeof check.last_latency_ms === "number") {
    return `${Math.round(check.last_latency_ms)}ms`;
  }
  if (check.type === "tcp" || check.type === "ssh") {
    return statusLabel(check.last_status, locale);
  }
  if (typeof check.last_value === "number") {
    return `${Number(check.last_value.toFixed(2))}%`;
  }
  if (typeof check.last_latency_ms === "number") {
    return `${Math.round(check.last_latency_ms)}ms`;
  }
  return statusLabel(check.last_status, locale);
}

function ChartPanel({
  title,
  option,
  empty = false,
  emptyText = "",
  action,
  caption,
  className = ""
}: {
  title: string;
  option: EChartsOption;
  empty?: boolean;
  emptyText?: string;
  action?: React.ReactNode;
  caption?: string;
  className?: string;
}): JSX.Element {
  return (
    <section className={`panel chart-panel ${className}`.trim()}>
      <PanelHeader title={title} action={action} />
      {empty ? (
        <EmptyState text={emptyText} />
      ) : (
        <Suspense fallback={<div className="chart-frame chart-loading" />}>
          <EChart option={option} />
        </Suspense>
      )}
      {caption && <p className="chart-caption">{caption}</p>}
    </section>
  );
}

function MonitoringFlowPanel({
  failingChecks,
  alerts,
  onRunCheck,
  onOpenAlerts,
  onOpenDiagnosis,
  onDiagnoseAlert,
  busyAction,
  locale
}: {
  failingChecks: Check[];
  alerts: Alert[];
  onRunCheck: (check: Check) => Promise<void>;
  onOpenAlerts: () => void;
  onOpenDiagnosis: () => void;
  onDiagnoseAlert: (alert: Alert) => Promise<void>;
  busyAction: string;
  locale: Locale;
}): JSX.Element {
  const openAlerts = alerts.filter((alert) => alert.status === "open");
  const activeAlertForCheck = (check: Check) => {
    if (check.open_alert_id) {
      return alerts.find((alert) => alert.id === check.open_alert_id);
    }
    return alerts.find((alert) => alert.asset_id === check.asset_id && alert.status === "open");
  };

  return (
    <section className="panel monitoring-flow-panel">
      <PanelHeader
        title={locale === "zh" ? "异常链路" : "Incident Flow"}
        action={
          <button type="button" className="text-button" onClick={onOpenAlerts}>
            {locale === "zh" ? "告警列表" : "Alerts"}
          </button>
        }
      />
      <div className="flow-step-grid" aria-label={locale === "zh" ? "监控告警诊断链路" : "Monitoring alert diagnosis flow"}>
        <div className="flow-step">
          <Activity aria-hidden="true" />
          <span>{locale === "zh" ? "监控异常" : "Failing checks"}</span>
          <strong>{failingChecks.length}</strong>
        </div>
        <div className="flow-step">
          <AlertTriangle aria-hidden="true" />
          <span>{locale === "zh" ? "开放告警" : "Open alerts"}</span>
          <strong>{openAlerts.length}</strong>
        </div>
        <button type="button" className="flow-step is-action" onClick={onOpenDiagnosis}>
          <Bot aria-hidden="true" />
          <span>{locale === "zh" ? "AI 诊断" : "AI diagnosis"}</span>
          <strong>{locale === "zh" ? "进入" : "Open"}</strong>
        </button>
      </div>
      <div className="incident-list">
        {failingChecks.slice(0, 4).map((check) => {
          const alert = activeAlertForCheck(check);
          return (
            <div className="incident-item" key={check.id}>
              <div>
                <strong>{checkPurposeLabel(check, locale)}</strong>
                <span>{check.asset_name || check.name}</span>
                <small>{check.last_message ? localizeGeneratedText(check.last_message, locale) : check.target}</small>
              </div>
              <div className="incident-actions">
                <button type="button" className="text-button" onClick={() => void onRunCheck(check)} disabled={busyAction === `run-${check.id}`}>
                  {locale === "zh" ? "执行" : "Run"}
                </button>
                {alert ? (
                  <button type="button" className="text-button" onClick={() => void onDiagnoseAlert(alert)} disabled={busyAction === `diagnose-${alert.id}`}>
                    {locale === "zh" ? "诊断" : "Diagnose"}
                  </button>
                ) : (
                  <button type="button" className="text-button" onClick={onOpenAlerts}>
                    {locale === "zh" ? "告警" : "Alert"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {failingChecks.length === 0 && (
          <EmptyState text={locale === "zh" ? "当前没有异常监控项。" : "No failing checks right now."} />
        )}
      </div>
    </section>
  );
}

function AlertSummaryBar({ summary, locale }: { summary: { total: number; open: number; acknowledged: number; closed: number }; locale: Locale }): JSX.Element {
  return (
    <div className="alert-summary-bar">
      <Metric label={locale === "zh" ? "告警总数" : "Total"} value={summary.total} icon={AlertTriangle} />
      <Metric label={locale === "zh" ? "开放" : "Open"} value={summary.open} icon={Activity} tone={summary.open > 0 ? "bad" : "good"} />
      <Metric label={locale === "zh" ? "已确认" : "Acknowledged"} value={summary.acknowledged} icon={CheckCircle2} tone="warn" />
      <Metric label={locale === "zh" ? "已关闭" : "Closed"} value={summary.closed} icon={ShieldCheck} tone="good" />
    </div>
  );
}

function AlertTable({
  alerts,
  onDiagnose,
  onUpdate,
  busyAction,
  locale,
  compact = false
}: {
  alerts: Alert[];
  onDiagnose: (alert: Alert) => Promise<void>;
  onUpdate: (alert: Alert, status: "acknowledged" | "closed") => Promise<void>;
  busyAction: string;
  locale: Locale;
  compact?: boolean;
}): JSX.Element {
  const t = copy[locale];
  if (alerts.length === 0) {
    return <EmptyState text={t.empty.noAlerts} />;
  }
  return (
    <table className={compact ? "compact-table" : ""}>
      <thead>
        <tr>
          <th>{t.table.name}</th>
          <th>{t.table.severity}</th>
          <th>{t.table.status}</th>
          <th>{t.table.failures}</th>
          <th>{t.table.action}</th>
        </tr>
      </thead>
      <tbody>
        {alerts.map((alert) => (
          <tr key={alert.id}>
            <td>
              <strong>{localizeGeneratedText(alert.title, locale)}</strong>
              <span className="table-subtext">{localizeGeneratedText(alert.message, locale)}</span>
            </td>
            <td><StatusPill status={alert.severity} locale={locale} /></td>
            <td><StatusPill status={alert.status} locale={locale} /></td>
            <td>{alert.failure_count}</td>
            <td className="row-actions">
              <button type="button" className="text-button" onClick={() => void onDiagnose(alert)} disabled={busyAction === `diagnose-${alert.id}`}>
                {t.actions.diagnose}
              </button>
              <button type="button" className="text-button" onClick={() => void onUpdate(alert, "acknowledged")} disabled={alert.status !== "open"}>
                {t.actions.acknowledge}
              </button>
              <button type="button" className="text-button" onClick={() => void onUpdate(alert, "closed")} disabled={alert.status === "closed"}>
                {t.actions.close}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatusPill({ status, locale }: { status: string; locale: Locale }): JSX.Element {
  return <span className={`status-pill ${toneForStatus(status)}`}>{statusLabel(status, locale)}</span>;
}

function RenewalPill({ asset, locale }: { asset: Asset; locale: Locale }): JSX.Element {
  const status = assetRenewalStatus(asset);
  const label = renewalStatusLabel(status, locale);
  const tone = status === "enabled" ? "is-good" : status === "disabled" ? "is-warn" : "is-muted";
  return <span className={`status-pill ${tone}`}>{label}</span>;
}

function StatusIcon({ status }: { status: string }): JSX.Element {
  if (status === "ok" || status === "healthy") {
    return <CheckCircle2 className="status-icon good" aria-hidden="true" />;
  }
  if (status === "degraded" || status === "warning") {
    return <AlertTriangle className="status-icon warn" aria-hidden="true" />;
  }
  return <XCircle className="status-icon bad" aria-hidden="true" />;
}

function EmptyState({ text }: { text: string }): JSX.Element {
  return <div className="empty-state">{text}</div>;
}

function MetadataLine({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <span className="metadata-line">
      <strong>{label}</strong>
      <code>{value || "-"}</code>
    </span>
  );
}

function SourceTag({ source, locale }: { source: string; locale: Locale }): JSX.Element | null {
  if (!source) {
    return null;
  }
  return (
    <span className={`source-tag is-${source.replace(/_/g, "-")}`} title={sourceDescription(source, locale)}>
      {sourceLabel(source, locale)}
    </span>
  );
}

function assetQuality(asset: Asset): NonNullable<Asset["data_quality"]> {
  return {
    field_sources: asset.data_quality?.field_sources ?? {},
    collection: asset.data_quality?.collection ?? { status: "never", message: "", checked_at: null, check_type: "", target: "" },
    gaps: asset.data_quality?.gaps ?? [],
    recommended_actions: asset.data_quality?.recommended_actions ?? []
  };
}

function fieldSource(quality: NonNullable<Asset["data_quality"]>, key: string): string {
  return quality.field_sources?.[key] || "missing";
}

function sourceKeysForAsset(asset: Asset): string[] {
  if (["ecs", "swas", "server"].includes(asset.type)) {
    return ["identity", "network", "spec", "usage", "renewal", "ssh", "bt_panel"];
  }
  if (asset.type === "oss") {
    return ["identity", "network", "spec", "renewal"];
  }
  if (asset.type === "domain" || asset.type === "dns") {
    return ["identity", "renewal", "entrypoint"];
  }
  return ["identity", "network", "spec", "renewal"];
}

function sourceFieldLabel(key: string, locale: Locale): string {
  const zh: Record<string, string> = {
    identity: "基础资料",
    network: "网络",
    spec: "规格",
    usage: "使用率",
    renewal: "续费",
    entrypoint: "入口",
    ssh: "SSH",
    bt_panel: "宝塔"
  };
  const en: Record<string, string> = {
    identity: "Profile",
    network: "Network",
    spec: "Spec",
    usage: "Usage",
    renewal: "Renewal",
    entrypoint: "Entrypoint",
    ssh: "SSH",
    bt_panel: "BT Panel"
  };
  return (locale === "zh" ? zh : en)[key] || key;
}

function sourceLabel(source: string, locale: Locale): string {
  const zh: Record<string, string> = {
    aliyun_api: "阿里云",
    runtime_check: "运行采集",
    local_profile: "本地资料",
    encrypted_local_secret: "本地加密",
    local_database: "本地库",
    derived: "推导",
    missing: "缺失"
  };
  const en: Record<string, string> = {
    aliyun_api: "Aliyun",
    runtime_check: "Runtime",
    local_profile: "Local",
    encrypted_local_secret: "Encrypted",
    local_database: "Local DB",
    derived: "Derived",
    missing: "Missing"
  };
  return (locale === "zh" ? zh : en)[source] || source;
}

function sourceDescription(source: string, locale: Locale): string {
  const zh: Record<string, string> = {
    aliyun_api: "来自阿里云只读 API 同步。",
    runtime_check: "来自 SSH 或云助手只读命令采集。",
    local_profile: "来自你在本地工具里维护的资料。",
    encrypted_local_secret: "敏感信息已在本地加密保存。",
    local_database: "来自本地数据库记录。",
    derived: "由已知资源信息自动推导。",
    missing: "当前没有可用数据。"
  };
  const en: Record<string, string> = {
    aliyun_api: "Synced from Alibaba Cloud read-only APIs.",
    runtime_check: "Collected by SSH or Cloud Assistant read-only checks.",
    local_profile: "Maintained locally in this tool.",
    encrypted_local_secret: "Stored locally as encrypted secret.",
    local_database: "Stored in the local database.",
    derived: "Derived from known resource metadata.",
    missing: "No data is available yet."
  };
  return (locale === "zh" ? zh : en)[source] || source;
}

function collectionStatusLabel(status: string, locale: Locale): string {
  const labels = locale === "zh"
    ? { ok: "成功", failed: "失败", never: "未执行", pending: "待采集" }
    : { ok: "OK", failed: "Failed", never: "Never Run", pending: "Pending" };
  return labels[status as keyof typeof labels] || statusLabel(status, locale);
}

function collectionSummary(collection: Asset["data_quality"]["collection"], locale: Locale): string {
  if (!collection.checked_at) {
    return locale === "zh" ? "还没有运行过采集或检查。" : "No collection or check has run yet.";
  }
  const time = formatApiDateTime(collection.checked_at, locale);
  const target = collection.target ? ` · ${collection.target}` : "";
  const message = collection.message ? ` · ${localizeGeneratedText(collection.message, locale)}` : "";
  return `${time}${target}${message}`;
}

function gapLabel(gap: string, locale: Locale): string {
  const zh: Record<string, string> = {
    ssh_access_missing: "SSH 未配置",
    runtime_usage_missing: "使用率未采集",
    checks_missing: "未建监控",
    last_collection_failed: "最近采集失败"
  };
  const en: Record<string, string> = {
    ssh_access_missing: "SSH missing",
    runtime_usage_missing: "Usage missing",
    checks_missing: "Checks missing",
    last_collection_failed: "Collection failed"
  };
  return (locale === "zh" ? zh : en)[gap] || gap;
}

function actionLabel(action: string, locale: Locale): string {
  const zh: Record<string, string> = {
    configure_ssh_access: "配置 SSH",
    collect_runtime: "采集使用率",
    create_default_checks: "生成默认监控"
  };
  const en: Record<string, string> = {
    configure_ssh_access: "Configure SSH",
    collect_runtime: "Collect Usage",
    create_default_checks: "Create Checks"
  };
  return (locale === "zh" ? zh : en)[action] || action;
}

function UsageMeters({ asset, locale, compact = false }: { asset: Asset; locale: Locale; compact?: boolean }): JSX.Element {
  const disk = runtimeMetricValue(asset, "disk_used_percent");
  const memory = runtimeMetricValue(asset, "memory_used_percent");
  const items = [
    { key: "memory_used_percent", label: locale === "zh" ? "内存" : "Mem", value: memory },
    { key: "disk_used_percent", label: locale === "zh" ? "磁盘" : "Disk", value: disk }
  ].filter((item) => item.value !== null);

  if (items.length === 0) {
    return (
      <span className="usage-empty" title={usageEmptyTitle(asset, locale)}>
        {locale === "zh" ? "未采集" : "Not collected"}
      </span>
    );
  }

  if (!compact) {
    return (
      <div className="usage-summary">
        {items.map((item) => (
          <div className="usage-summary-item" key={item.key} title={runtimeMetricTitle(asset, item.key, locale)}>
            <div className="usage-summary-head">
              <span>{item.label}</span>
              <strong>{item.value}%</strong>
            </div>
            <span className="usage-track">
              <span className={`usage-fill ${usageTone(item.value ?? 0)}`} style={{ inlineSize: `${Math.min(100, Math.max(0, item.value ?? 0))}%` }} />
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={compact ? "usage-meters is-compact" : "usage-meters"}>
      {items.map((item) => (
        <div className="usage-meter" key={item.key} title={runtimeMetricTitle(asset, item.key, locale)}>
          <span className="usage-label">{item.label}</span>
          <span className="usage-track">
            <span className={`usage-fill ${usageTone(item.value ?? 0)}`} style={{ inlineSize: `${Math.min(100, Math.max(0, item.value ?? 0))}%` }} />
          </span>
          <strong>{item.value}%</strong>
        </div>
      ))}
    </div>
  );
}

function runtimeMetricValue(asset: Asset, key: string): number | null {
  const value = (asset.runtime_metrics || {})[key] ?? asset.metadata_json[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number(value.toFixed(1));
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(Number(value).toFixed(1));
  }
  return null;
}

function runtimeMetricTitle(asset: Asset, key: string, locale: Locale): string {
  const metrics = asset.runtime_metrics || {};
  const checkedAt = metrics[`${key}_checked_at`];
  const source = typeof metrics[`${key}_source`] === "string" ? String(metrics[`${key}_source`]) : fieldSource(assetQuality(asset), "usage");
  if (typeof checkedAt !== "string" || !checkedAt) {
    return locale === "zh" ? `来源：${sourceLabel(source, locale)}；暂无采集时间` : `Source: ${sourceLabel(source, locale)}; no collection time`;
  }
  return `${locale === "zh" ? "来源" : "Source"}: ${sourceLabel(source, locale)} · ${locale === "zh" ? "最近采集" : "Last collected"}: ${formatApiDateTime(checkedAt, locale)}`;
}

function usageEmptyTitle(asset: Asset, locale: Locale): string {
  const quality = assetQuality(asset);
  if (quality.collection.status === "failed" && quality.collection.message) {
    return localizeGeneratedText(quality.collection.message, locale);
  }
  if (quality.gaps.includes("ssh_access_missing")) {
    return locale === "zh" ? "需要先在资产详情中配置 SSH 密码或密钥。" : "Configure SSH password or key in asset details first.";
  }
  if (asset.type === "swas") {
    return locale === "zh"
      ? "轻量服务器当前需要配置 SSH 访问资料后执行 df/free 只读检查。"
      : "Simple Application Server usage needs SSH access, then df/free read-only checks.";
  }
  if (asset.type === "ecs") {
    return locale === "zh"
      ? "ECS 需要执行云助手/云监控检查后显示。"
      : "ECS usage appears after Cloud Assistant or CloudMonitor checks run.";
  }
  return locale === "zh" ? "该资产类型没有运行时使用率。" : "This asset type has no runtime usage metric.";
}

function usageTone(value: number): string {
  if (value >= 90) {
    return "is-bad";
  }
  if (value >= 75) {
    return "is-warn";
  }
  return "is-good";
}

const chartPalette = ["#006f5f", "#3f7d96", "#d59a25", "#2f8f67", "#7267a8", "#b75a55", "#5f7e8a"];
const chartInk = "#061923";
const chartMuted = "#48616a";
const chartSubtle = "#72878f";
const chartSurface = "#f8fbfb";
const chartTrack = "#e4eef0";
const chartTooltipStyle = {
  backgroundColor: "rgba(248, 251, 251, 0.96)",
  borderColor: "#a8c3ca",
  borderWidth: 1,
  borderRadius: 8,
  padding: [10, 12],
  textStyle: { color: chartInk, fontSize: 12 },
  extraCssText: "box-shadow: 0 12px 32px rgba(7, 28, 38, 0.12); border-radius: 6px;"
};
const chartAxisLabel = { color: chartMuted, fontSize: 11 };
const chartSplitLine = { lineStyle: { color: "#d9e6e9", type: "dashed" as const } };

function summarizeRegions(assets: Asset[]): ChartDatum[] {
  const counts = assets.reduce<Record<string, number>>((acc, asset) => {
    const region = asset.region || "global";
    acc[region] = (acc[region] ?? 0) + 1;
    return acc;
  }, {});
  const rows = Object.entries(counts)
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value);
  const visible = rows.slice(0, 10);
  const rest = rows.slice(10).reduce((sum, row) => sum + row.value, 0);
  return rest > 0 ? [...visible, { name: "other", value: rest }] : visible;
}

function upcomingServerExpiries(assets: Asset[]): ExpiryDatum[] {
  return assets
    .filter((asset) => ["ecs", "swas"].includes(asset.type))
    .map((asset) => {
      const date = assetExpiryDate(asset);
      return date ? { name: asset.name, date, days: daysUntil(date), region: asset.region } : null;
    })
    .filter((row): row is ExpiryDatum => Boolean(row))
    .sort((left, right) => left.days - right.days)
    .slice(0, 8);
}

function buildAssetDistributionOption(rows: ChartDatum[], locale: Locale): EChartsOption {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return {
    color: chartPalette,
    tooltip: {
      ...chartTooltipStyle,
      trigger: "item",
      formatter: "{b}<br/><strong>{c}</strong> ({d}%)"
    },
    title: {
      text: String(total),
      subtext: locale === "zh" ? "资源" : "Assets",
      left: "32%",
      top: "40%",
      textAlign: "center",
      textStyle: { color: chartInk, fontSize: 28, fontWeight: 800, fontFamily: "Aptos Display, Segoe UI, sans-serif" },
      subtextStyle: { color: chartMuted, fontSize: 12 }
    },
    legend: {
      right: 8,
      top: "middle",
      orient: "vertical",
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 12,
      textStyle: { color: chartMuted, fontSize: 12 }
    },
    series: [
      {
        name: locale === "zh" ? "资产" : "Assets",
        type: "pie",
        radius: ["55%", "76%"],
        center: ["32%", "50%"],
        avoidLabelOverlap: true,
        padAngle: 2,
        itemStyle: {
          borderRadius: 8,
          borderColor: chartSurface,
          borderWidth: 3
        },
        label: { show: false },
        labelLine: { show: false },
        emphasis: {
          scale: true,
          scaleSize: 6,
          itemStyle: {
            shadowBlur: 18,
            shadowColor: "rgba(7, 28, 38, 0.14)"
          }
        },
        data: rows
      }
    ]
  };
}

function buildRegionDistributionOption(rows: ChartDatum[], locale: Locale): EChartsOption {
  const labels = rows.map((row) => row.name === "other" ? (locale === "zh" ? "其他" : "Other") : row.name);
  return {
    color: [chartPalette[0]],
    grid: { left: 104, right: 42, top: 14, bottom: 16, containLabel: false },
    tooltip: {
      ...chartTooltipStyle,
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: "rgba(0, 111, 95, 0.32)", width: 1, type: "dashed" } },
      formatter: (params: unknown) => {
        const item = Array.isArray(params) ? params[0] as { name: string; value: number } : null;
        return item ? `${item.name}<br/><strong>${item.value}</strong> ${locale === "zh" ? "个资源" : "assets"}` : "";
      }
    },
    xAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: chartSplitLine
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: labels,
      axisLabel: { ...chartAxisLabel, color: chartInk, width: 92, overflow: "truncate", margin: 12 },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [
      {
        name: locale === "zh" ? "资源数" : "Assets",
        type: "bar",
        barWidth: 13,
        showBackground: true,
        backgroundStyle: { color: chartTrack, borderRadius: 10 },
        itemStyle: {
          borderRadius: 10,
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 1,
            y2: 0,
            colorStops: [
              { offset: 0, color: "#006f5f" },
              { offset: 1, color: "#31a083" }
            ]
          }
        },
        label: {
          show: true,
          position: "right",
          color: chartMuted,
          fontSize: 12,
          formatter: "{c}"
        },
        data: rows.map((row) => row.value)
      }
    ]
  };
}

function buildAssetGraphOption(graph: AssetGraph, locale: Locale): EChartsOption {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const involvedNodeIds = new Set<string>();
  graph.edges.forEach((edge) => {
    involvedNodeIds.add(edge.source);
    involvedNodeIds.add(edge.target);
  });
  const visibleNodes = graph.nodes.filter((node) => involvedNodeIds.has(node.id));
  const nodeTypeColor = (type: string): string => {
    if (type === "dns") return "#006f5f";
    if (type === "domain") return "#3f86a0";
    if (type === "oss") return "#d99d22";
    return "#2f936f";
  };
  const sankeyNodes = visibleNodes.map((node) => ({
    name: node.id,
    assetLabel: node.label,
    type: node.type,
    region: node.region,
    itemStyle: { color: nodeTypeColor(node.type) },
    label: {
      formatter: node.label.length > 16 ? `${node.label.slice(0, 16)}...` : node.label
    }
  }));
  const sankeyLinks = graph.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    value: 1,
    relation: edge.relation,
    confidence: edge.confidence
  }));
  return {
    tooltip: {
      ...chartTooltipStyle,
      formatter: (params: unknown) => {
        const item = params as {
          dataType?: string;
          data?: { source?: string; target?: string; assetLabel?: string; relation?: string; region?: string; type?: string; confidence?: string };
        };
        if (item.dataType === "edge" || (item.data?.source && item.data?.target)) {
          const source = item.data?.source ? nodeById.get(item.data.source) : null;
          const target = item.data?.target ? nodeById.get(item.data.target) : null;
          return [
            `<strong>${relationLabel(item.data?.relation || "", locale)}</strong>`,
            `${source?.label || item.data?.source || "-"} → ${target?.label || item.data?.target || "-"}`,
            item.data?.confidence === "stored" ? (locale === "zh" ? "来源：保存关系" : "Source: stored") : (locale === "zh" ? "来源：自动推断" : "Source: inferred")
          ].join("<br/>");
        }
        return `${item.data?.assetLabel || ""}<br/>${assetTypeLabel(item.data?.type || "", locale)} / ${item.data?.region || "-"}`;
      }
    },
    legend: {
      right: 18,
      top: 14,
      textStyle: { color: chartMuted, fontSize: 12 },
      data: ["DNS", locale === "zh" ? "域名" : "Domain", "OSS", locale === "zh" ? "轻量服务器" : "Server"]
    },
    series: [
      {
        type: "sankey",
        left: 28,
        right: 132,
        top: 60,
        bottom: 28,
        nodeWidth: 14,
        nodeGap: 9,
        nodeAlign: "justify",
        draggable: false,
        layoutIterations: 0,
        emphasis: {
          focus: "adjacency"
        },
        label: {
          show: true,
          color: chartInk,
          fontSize: 10,
          overflow: "truncate",
          width: 96
        },
        lineStyle: {
          color: "gradient",
          opacity: 0.26,
          curveness: 0.52
        },
        data: sankeyNodes,
        links: sankeyLinks
      }
    ]
  };
}

function formatUptimeCaption(summary: DashboardSummary, locale: Locale): string {
  if (summary.website_uptime_total === 0 || summary.website_uptime === null) {
    return locale === "zh"
      ? "暂无 HTTP 探活样本。创建并执行网站探活后再计算成功率。"
      : "No HTTP probe samples yet. Create and run HTTP checks before calculating success rate.";
  }
  const sampleText = locale === "zh"
    ? `最近 ${summary.website_uptime_total} 次 HTTP 探活，成功 ${summary.website_uptime_ok} 次。`
    : `Latest ${summary.website_uptime_total} HTTP probes, ${summary.website_uptime_ok} succeeded.`;
  const timeText = summary.website_uptime_checked_at
    ? `${locale === "zh" ? "最近采集" : "Last sample"} ${formatApiDateTime(summary.website_uptime_checked_at, locale)}`
    : "";
  return timeText ? `${sampleText} ${timeText}` : sampleText;
}

function buildUptimeOption(value: number | null, locale: Locale, okCount: number, totalCount: number): EChartsOption {
  const hasData = typeof value === "number" && Number.isFinite(value) && totalCount > 0;
  const normalized = hasData ? Math.max(0, Math.min(100, Number(value.toFixed(2)))) : 0;
  const toneColor = !hasData ? chartSubtle : normalized >= 99 ? chartPalette[0] : normalized >= 95 ? "#d59a25" : "#b75a55";
  const title = locale === "zh" ? "网站探活成功率" : "HTTP probe success";
  const emptyText = locale === "zh" ? "未采集" : "No data";
  return {
    tooltip: {
      ...chartTooltipStyle,
      formatter: hasData
        ? `${title}<br/><strong>${normalized}%</strong><br/>${locale === "zh" ? "成功" : "Succeeded"}: ${okCount}/${totalCount}`
        : `${title}<br/><strong>${emptyText}</strong>`
    },
    series: [
      {
        type: "gauge",
        min: 0,
        max: 100,
        startAngle: 210,
        endAngle: -30,
        radius: "92%",
        center: ["50%", "57%"],
        progress: {
          show: true,
          width: 14,
          roundCap: true,
          itemStyle: { color: toneColor }
        },
        pointer: { show: false },
        axisLine: {
          lineStyle: {
            width: 14,
            color: hasData
              ? [
                  [0.95, "#f0cbc7"],
                  [0.99, "#f2d696"],
                  [1, "#c6ead8"]
                ]
              : [[1, chartTrack]]
          }
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { distance: 18, color: chartSubtle, fontSize: 10 },
        detail: {
          valueAnimation: true,
          formatter: hasData ? "{value}%" : emptyText,
          color: chartInk,
          fontSize: hasData ? 32 : 24,
          fontWeight: 800,
          fontFamily: "Aptos Display, Segoe UI, sans-serif",
          offsetCenter: [0, "0%"]
        },
        title: {
          offsetCenter: [0, "35%"],
          color: chartMuted,
          fontSize: 12
        },
        data: [{ value: normalized, name: locale === "zh" ? "成功率" : "Success" }]
      }
    ]
  };
}

function buildExpiryOption(rows: ExpiryDatum[], locale: Locale): EChartsOption {
  const maxDays = rows.reduce((max, row) => Math.max(max, row.days), 0);
  const axisMax = Math.max(30, Math.ceil((maxDays + 6) / 5) * 5);
  return {
    color: [chartPalette[0]],
    grid: { left: 132, right: 70, top: 8, bottom: 14, containLabel: false },
    tooltip: {
      ...chartTooltipStyle,
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: "rgba(0, 111, 95, 0.32)", width: 1, type: "dashed" } },
      formatter: (params: unknown) => {
        const item = Array.isArray(params) ? params[0] as { name: string; data: ExpiryDatum & { value: number } } : null;
        if (!item) {
          return "";
        }
        return `${item.data.name}<br/>${locale === "zh" ? "地域" : "Region"}: ${item.data.region}<br/>${locale === "zh" ? "到期" : "Expires"}: ${item.data.date}<br/>${locale === "zh" ? "剩余" : "Days left"}: <strong>${item.data.days}</strong>`;
      }
    },
    xAxis: {
      type: "value",
      max: axisMax,
      minInterval: 1,
      axisLabel: { ...chartAxisLabel, formatter: (value: number) => `${value}d` },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: chartSplitLine
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map((row) => shortenAssetName(row.name)),
      axisLabel: {
        color: chartInk,
        overflow: "truncate",
        width: 112,
        fontSize: 12,
        margin: 12
      },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [
      {
        name: locale === "zh" ? "剩余天数" : "Days left",
        type: "bar",
        barWidth: 12,
        barCategoryGap: "42%",
        showBackground: true,
        backgroundStyle: {
          color: chartTrack,
          borderRadius: 8
        },
        itemStyle: {
          borderRadius: 8
        },
        label: {
          show: true,
          position: "right",
          distance: 8,
          color: chartMuted,
          fontSize: 12,
          formatter: (params: unknown) => {
            const item = (params as { data?: ExpiryDatum & { value: number } }).data;
            if (!item) {
              return "";
            }
            return locale === "zh" ? `${item.days}天` : `${item.days}d`;
          }
        },
        data: rows.map((row) => ({
          ...row,
          value: Math.max(row.days, 0),
          itemStyle: { color: expiryColor(row.days) }
        }))
      }
    ]
  };
}

function shortenAssetName(name: string): string {
  const normalized = name.trim();
  if (normalized.length <= 13) {
    return normalized;
  }
  return `${normalized.slice(0, 12)}…`;
}

function expiryColor(days: number): string {
  if (days <= 14) {
    return "#b85f5c";
  }
  if (days <= 30) {
    return "#c9902a";
  }
  return chartPalette[0];
}

function assetExpiryDate(asset: Asset): string {
  const ops = metadataSection(asset.metadata_json, "ops");
  const date = textValue(ops.renewal_expires_at) || metadataText(asset.metadata_json, ["expired_time", "expiration_date"]);
  if (!date) {
    return "";
  }
  return date.includes("T") ? date.slice(0, 10) : date.slice(0, 10);
}

function parseApiDateTime(value: string): Date {
  const trimmed = value.trim();
  const hasExplicitTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = trimmed.includes("T") && !hasExplicitTimezone ? `${trimmed}Z` : trimmed;
  return new Date(normalized);
}

function formatApiDateTime(value: string, locale: Locale): string {
  const date = parseApiDateTime(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function daysUntil(date: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) {
    return 0;
  }
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

function assetTypeLabel(type: string, locale: Locale): string {
  const zh: Record<string, string> = {
    server: "服务器",
    ecs: "ECS",
    swas: "轻量服务器",
    oss: "OSS",
    domain: "域名",
    dns: "DNS",
    integration: "集成"
  };
  const en: Record<string, string> = {
    server: "Servers",
    ecs: "ECS",
    swas: "Simple App Server",
    oss: "OSS",
    domain: "Domain",
    dns: "DNS",
    integration: "Integration"
  };
  return (locale === "zh" ? zh : en)[type] ?? type;
}

function isNavActive(navView: NavView, activeView: View): boolean {
  if (navView === "assets") {
    return activeView === "assets" || activeView === "asset-detail" || activeView === "graph";
  }
  return navView === activeView;
}

function navLabel(view: NavView, locale: Locale, t: typeof copy.zh | typeof copy.en): string {
  const labels: Record<string, { zh: string; en: string }> = {
    knowledge: { zh: "知识库", en: "Knowledge" },
    graph: { zh: "关系图", en: "Graph" },
    renewals: { zh: "续费", en: "Renewals" }
  };
  if (labels[view]) {
    return labels[view][locale];
  }
  return t.nav[view as keyof typeof t.nav];
}

function pageTitle(view: View, locale: Locale, t: typeof copy.zh | typeof copy.en): string {
  const labels: Record<string, { zh: string; en: string }> = {
    knowledge: { zh: "本地知识库", en: "Local Knowledge" },
    graph: { zh: "资源资产", en: "Assets" },
    renewals: { zh: "续费中心", en: "Renewal Center" }
  };
  if (labels[view]) {
    return labels[view][locale];
  }
  return t.titles[view as keyof typeof t.titles];
}

function knowledgeFieldLabel(field: string, locale: Locale): string {
  const labels: Record<string, { zh: string; en: string }> = {
    asset_id: { zh: "资产 ID", en: "Asset ID" },
    alert_id: { zh: "告警 ID", en: "Alert ID" },
    name: { zh: "名称", en: "Name" },
    title: { zh: "标题", en: "Title" },
    region: { zh: "地域", en: "Region" },
    type: { zh: "类型", en: "Type" },
    status: { zh: "状态", en: "Status" },
    severity: { zh: "级别", en: "Severity" },
    days_left: { zh: "剩余天数", en: "Days left" },
    expires_at: { zh: "到期", en: "Expires" },
    auto_renew: { zh: "自动续费", en: "Auto renew" },
    disk_used_percent: { zh: "磁盘", en: "Disk" },
    memory_used_percent: { zh: "内存", en: "Memory" },
    ssh: { zh: "SSH", en: "SSH" },
    bt_panel: { zh: "宝塔", en: "BT Panel" },
    failure_count: { zh: "失败次数", en: "Failures" }
  };
  return labels[field]?.[locale] ?? field;
}

function formatEvidenceValue(value: unknown, locale: Locale): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? (locale === "zh" ? "是" : "Yes") : (locale === "zh" ? "否" : "No");
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function relationLabel(relation: string, locale: Locale): string {
  const labels: Record<string, { zh: string; en: string }> = {
    resolves_to: { zh: "解析到服务器", en: "Resolves to" },
    has_dns_record: { zh: "包含 DNS 记录", en: "Has DNS record" },
    depends_on: { zh: "依赖", en: "Depends on" },
    contains: { zh: "包含", en: "Contains" }
  };
  return labels[relation]?.[locale] ?? relation;
}

function renewalDueLabel(item: RenewalItem, locale: Locale): string {
  if (!item.expires_at) {
    return locale === "zh" ? "未获取" : "Unknown";
  }
  if (item.days_left === null) {
    return item.expires_at;
  }
  return locale === "zh" ? `${item.expires_at}（${item.days_left} 天）` : `${item.expires_at} (${item.days_left}d)`;
}

function renewalCenterStatusLabel(item: RenewalItem, locale: Locale): string {
  if (item.status === "expired") {
    return locale === "zh" ? "已过期" : "Expired";
  }
  if (item.status === "urgent") {
    return locale === "zh" ? "紧急" : "Urgent";
  }
  if (item.status === "soon") {
    return locale === "zh" ? "临近" : "Soon";
  }
  if (item.auto_renew === true) {
    return locale === "zh" ? "自动续费" : "Auto";
  }
  if (item.status === "unknown") {
    return locale === "zh" ? "未获取" : "Unknown";
  }
  return locale === "zh" ? "正常" : "OK";
}

function renewalSourceLabel(source: string, locale: Locale): string {
  if (source === "aliyun_api") {
    return locale === "zh" ? "阿里云" : "Alibaba Cloud";
  }
  if (source === "local_profile") {
    return locale === "zh" ? "本地资料" : "Local profile";
  }
  return locale === "zh" ? "缺失" : "Missing";
}

function assetMatchesType(asset: Asset, filter: AssetFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "server") {
    return ["ecs", "swas"].includes(asset.type);
  }
  return asset.type === filter;
}

function assetSearchText(asset: Asset, locale: Locale): string {
  return [
    asset.name,
    asset.external_id,
    asset.region,
    asset.status,
    statusLabel(asset.status, locale),
    asset.type,
    assetTypeLabel(asset.type, locale),
    assetPublicIp(asset),
    assetPrivateIp(asset),
    assetSpec(asset, locale),
    assetExpiry(asset, locale),
    ...flattenSearchValues(asset.metadata_json)
  ].filter(Boolean).join(" ").toLowerCase();
}

function flattenSearchValues(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenSearchValues(item));
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [key, ...flattenSearchValues(item)]);
  }
  return [];
}

function assetPublicIp(asset: Asset): string {
  return metadataText(asset.metadata_json, ["public_ip_address", "public_ip", "public_ips", "internet_ip", "eip_address", "extranet_endpoint"]);
}

function assetPrivateIp(asset: Asset): string {
  return metadataText(asset.metadata_json, ["inner_ip_address", "private_ip", "private_ips", "intranet_endpoint"]);
}

function assetSpec(asset: Asset, locale: Locale): string {
  const metadata = asset.metadata_json;
  if (asset.type === "swas") {
    const parts = [
      metadataText(metadata, ["cpu"]) ? `${metadataText(metadata, ["cpu"])}C` : "",
      metadataText(metadata, ["memory_gb"]) ? `${metadataText(metadata, ["memory_gb"])}GB` : "",
      metadataText(metadata, ["disk_size_gb"]) ? `${metadataText(metadata, ["disk_size_gb"])}GB ${locale === "zh" ? "盘" : "disk"}` : "",
      metadataText(metadata, ["bandwidth_mbps"]) ? `${metadataText(metadata, ["bandwidth_mbps"])}Mbps` : "",
    ].filter(Boolean);
    return parts.join(" / ") || "-";
  }
  if (asset.type === "ecs") {
    const instanceType = metadataText(metadata, ["instance_type"]);
    const cpu = metadataText(metadata, ["cpu"]);
    const memoryMb = metadataText(metadata, ["memory_mb"]);
    const memory = memoryMb ? `${Math.round(Number(memoryMb) / 1024)}GB` : "";
    return [instanceType, cpu ? `${cpu}C` : "", memory].filter(Boolean).join(" / ") || "-";
  }
  if (asset.type === "oss") {
    return metadataText(metadata, ["storage_class"]) || "-";
  }
  if (asset.type === "domain") {
    return metadataText(metadata, ["registrar"]) || "-";
  }
  if (asset.type === "dns") {
    const recordType = metadataText(metadata, ["record_type"]);
    const value = metadataText(metadata, ["value"]);
    const count = metadataText(metadata, ["record_count"]);
    return recordType && value ? `${recordType} / ${value}` : count ? `${count} ${locale === "zh" ? "条记录" : "records"}` : "-";
  }
  return "-";
}

function assetImage(asset: Asset): string {
  return metadataText(asset.metadata_json, ["image_name", "image_version", "os", "os_type"]) || "-";
}

function assetExpiry(asset: Asset, locale: Locale): string {
  const date = assetExpiryDate(asset);
  if (!date) {
    return "-";
  }
  return date;
}

type RenewalStatus = "enabled" | "disabled" | "unknown";

function assetRenewalStatus(asset: Asset): RenewalStatus {
  const ops = metadataSection(asset.metadata_json, "ops");
  const renewStatus = textValue(asset.metadata_json.renew_status);
  if (renewStatus === "AutoRenewal") {
    return "enabled";
  }
  if (renewStatus === "ManualRenewal" || renewStatus === "NotRenewal") {
    return "disabled";
  }
  const synced = renewalFlag(asset.metadata_json.auto_renew_enabled);
  if (synced !== null) {
    return synced ? "enabled" : "disabled";
  }
  const manual = renewalFlag(ops.renewal_auto_renew);
  if (manual !== null) {
    return manual ? "enabled" : "disabled";
  }
  return "unknown";
}

function renewalFlag(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "enabled", "enable", "on", "yes", "1"].includes(normalized)) {
      return true;
    }
    if (["false", "disabled", "disable", "off", "no", "0"].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function renewalStatusLabel(status: RenewalStatus, locale: Locale): string {
  if (status === "enabled") {
    return locale === "zh" ? "已开启" : "On";
  }
  if (status === "disabled") {
    return locale === "zh" ? "未开启" : "Off";
  }
  return locale === "zh" ? "未返回" : "Unknown";
}

function assetConsoleLabel(asset: Asset, locale: Locale): string {
  if (assetBtPanelUrl(asset)) {
    return locale === "zh" ? "打开面板" : "Open Panel";
  }
  return locale === "zh" ? "控制台" : "Console";
}

function assetBtPanelUrl(asset: Asset): string {
  if (!["ecs", "swas"].includes(asset.type)) {
    return "";
  }
  const btPanel = metadataSection(asset.metadata_json, "bt_panel");
  if (btPanel.enabled === false) {
    return "";
  }
  return normalizeExternalUrl(textValue(btPanel.url));
}

function normalizeExternalUrl(value: string): string {
  const url = value.trim();
  if (!url) {
    return "";
  }
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return `http://${url}`;
}

function assetConsoleUrl(asset: Asset): string {
  const btPanelUrl = assetBtPanelUrl(asset);
  if (btPanelUrl) {
    return btPanelUrl;
  }
  const ops = metadataSection(asset.metadata_json, "ops");
  const configured = normalizeExternalUrl(textValue(ops.login_url));
  if (configured) {
    return configured;
  }
  const detailUrl = assetCloudDetailUrl(asset);
  if (detailUrl) {
    return detailUrl;
  }
  if (asset.type === "swas") {
    return "https://swas.console.aliyun.com/";
  }
  if (asset.type === "ecs") {
    return "https://ecs.console.aliyun.com/";
  }
  if (asset.type === "oss") {
    return "https://oss.console.aliyun.com/";
  }
  if (asset.type === "domain") {
    return "https://dc.console.aliyun.com/";
  }
  if (asset.type === "dns") {
    return "https://dns.console.aliyun.com/";
  }
  return "";
}

function assetCloudDetailUrl(asset: Asset): string {
  const id = encodeURIComponent(asset.external_id || "");
  const region = encodeURIComponent(asset.region || "");
  if (!id || !region || region === "global") {
    return "";
  }
  if (asset.type === "ecs") {
    return `https://ecs.console.aliyun.com/server/${id}/detail?regionId=${region}`;
  }
  if (asset.type === "swas") {
    return `https://swas.console.aliyun.com/#/servers/${region}/${id}/dashboard`;
  }
  return "";
}

function metadataText(metadata: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === "string" && item.trim());
      if (typeof first === "string") {
        return first.trim();
      }
    }
  }
  return "";
}

function checkTypeLabel(type: string, locale: Locale): string {
  const zh: Record<string, string> = {
    http: "HTTP",
    tcp: "TCP",
    ssh: "SSH",
    ecs_metric: "ECS 指标",
    cloud_assistant: "云助手"
  };
  const en: Record<string, string> = {
    http: "HTTP",
    tcp: "TCP",
    ssh: "SSH",
    ecs_metric: "ECS Metric",
    cloud_assistant: "Cloud Assistant"
  };
  return (locale === "zh" ? zh : en)[type] ?? type;
}

function accessMethodLabel(method: string, locale: Locale): string {
  const zh: Record<string, string> = {
    cloud_assistant: "云助手优先",
    ssh_password: "SSH 密码",
    ssh_key: "SSH 私钥"
  };
  const en: Record<string, string> = {
    cloud_assistant: "Cloud Assistant first",
    ssh_password: "SSH password",
    ssh_key: "SSH private key"
  };
  return (locale === "zh" ? zh : en)[method] ?? method;
}

function defaultAccessUsername(method: string, username: string | null | undefined): string {
  const normalized = (username || "").trim();
  if (normalized) {
    return normalized;
  }
  return method === "ssh_password" || method === "ssh_key" ? "root" : "";
}

function statusLabel(status: string, locale: Locale): string {
  const zh: Record<string, string> = {
    configured: "已配置",
    healthy: "健康",
    degraded: "降级",
    error: "错误",
    untested: "未测试",
    running: "运行中",
    warning: "风险",
    active: "活跃",
    pending: "待配置",
    ok: "正常",
    failed: "失败",
    open: "打开",
    acknowledged: "已确认",
    closed: "已关闭",
    critical: "严重",
    urgent_renewal: "急需续费",
    urgent_redemption: "急需赎回",
    "1": "急需续费",
    "2": "急需赎回",
    "3": "正常"
  };
  const en: Record<string, string> = {
    configured: "Configured",
    healthy: "Healthy",
    degraded: "Degraded",
    error: "Error",
    untested: "Untested",
    running: "Running",
    warning: "Warning",
    active: "Active",
    pending: "Pending",
    ok: "OK",
    failed: "Failed",
    open: "Open",
    acknowledged: "Acknowledged",
    closed: "Closed",
    critical: "Critical",
    urgent_renewal: "Renew Soon",
    urgent_redemption: "Redeem Soon",
    "1": "Renew Soon",
    "2": "Redeem Soon",
    "3": "Normal"
  };
  return (locale === "zh" ? zh : en)[status] ?? status;
}

function toneForStatus(status: string): string {
  if (["healthy", "running", "active", "ok", "closed", "3"].includes(status)) {
    return "is-good";
  }
  if (["configured"].includes(status)) {
    return "is-muted";
  }
  if (["warning", "degraded", "acknowledged", "pending", "untested", "urgent_renewal", "1"].includes(status)) {
    return "is-warn";
  }
  return "is-bad";
}

function isAccessValidationMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("ssh login") ||
    normalized.includes("ssh credential") ||
    normalized.includes("cloud assistant read-only command") ||
    normalized.includes("read-only command completed")
  );
}

function iconForAsset(type: string): JSX.Element {
  if (type === "ecs" || type === "swas") {
    return <Server aria-hidden="true" />;
  }
  if (type === "domain" || type === "dns") {
    return <Globe2 aria-hidden="true" />;
  }
  if (type === "oss") {
    return <Cloud aria-hidden="true" />;
  }
  return <Database aria-hidden="true" />;
}

function formatMetadata(metadata: Record<string, unknown>): string {
  const entries = Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return entries.length > 0 ? entries.join(" / ") : "-";
}

function localizeGeneratedText(text: string, locale: Locale): string {
  if (locale === "en") {
    return text;
  }
  const replacements: Array<[RegExp, string]> = [
    [/^AI config is incomplete\.$/, "AI 配置不完整。"],
    [/^AI endpoint test passed\.$/, "AI 连接测试通过。"],
    [/^Endpoint responded, but the completion reply was unexpected\.$/, "接口已响应，但模型回复不符合预期。"],
    [/^AI endpoint returned HTTP (\d+): /, "AI 接口返回 HTTP $1："],
    [/^AI endpoint test failed: /, "AI 连接测试失败："],
    [/^SSH credentials are not configured for this check\.$/, "SSH 密码或私钥未配置。先到资产详情的 SSH 访问里保存凭据。"],
    [/^ECS instance_id is required for Cloud Assistant checks\.$/, "云助手检查仅支持 ECS 实例；轻量服务器请用 HTTP/TCP/SSH 检查。"],
    [/^ECS instance_id is required for CloudMonitor checks\.$/, "云监控指标仅支持 ECS 实例；轻量服务器请用 HTTP/TCP/SSH 检查。"],
    [/^Disk usage is above 90%, which can cause deploys, logs, and databases to fail\.$/, "磁盘使用率超过 90%，可能导致部署、日志写入或数据库写入失败。"],
    [/^Confirm whether the alert is still active from the latest check result\.$/, "先确认最新检查结果中告警是否仍然存在。"],
    [/^Inspect disk, memory, and listening ports using read-only commands\.$/, "使用只读命令检查磁盘、内存和监听端口。"],
    [/^Check recent deployment or configuration changes before restarting services\.$/, "在重启服务前检查最近的部署、配置或证书变更。"],
    [/^Escalate to manual repair only after confirming the service and failure mode\.$/, "确认具体服务和故障模式后，再进入人工修复流程。"],
    [/^Check disk pressure on Linux servers\.$/, "检查 Linux 服务器磁盘使用率。"],
    [/^Check memory pressure on Linux servers\.$/, "检查 Linux 服务器内存压力。"],
    [/^Confirm listening ports\.$/, "确认服务监听端口。"],
    [/^Check service runtime status after identifying the service name\.$/, "确认具体服务的运行状态。"]
  ];
  return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
}
