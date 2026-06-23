import { KeyRound, ShieldCheck } from "lucide-react";
import type { Dispatch, FormEvent, SetStateAction } from "react";

type Locale = "zh" | "en";
type LoginForm = { username: string; password: string };

export function StartupScreen({ locale }: { locale: Locale }): JSX.Element {
  return (
    <div className="login-shell">
      <section className="login-panel startup-panel">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>Local AI Ops</strong>
          <span>{locale === "zh" ? "正在检查本地登录状态..." : "Checking local session..."}</span>
        </div>
      </section>
    </div>
  );
}

export function LoginPage({
  locale,
  notice,
  busy,
  form,
  onFormChange,
  onSubmit,
  onLocaleChange
}: {
  locale: Locale;
  notice: string;
  busy: boolean;
  form: LoginForm;
  onFormChange: Dispatch<SetStateAction<LoginForm>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onLocaleChange: (locale: Locale) => void;
}): JSX.Element {
  return (
    <div className="login-shell">
      <section className="login-panel">
        <div className="login-panel-header">
          <div className="brand compact-brand">
            <ShieldCheck aria-hidden="true" />
            <div>
              <strong>Local AI Ops</strong>
              <span>{locale === "zh" ? "局域网本地运维" : "LAN operations console"}</span>
            </div>
          </div>
          <div className="segmented locale-switch" role="group" aria-label="Language">
            <button type="button" className={locale === "zh" ? "is-selected" : ""} onClick={() => onLocaleChange("zh")}>中文</button>
            <button type="button" className={locale === "en" ? "is-selected" : ""} onClick={() => onLocaleChange("en")}>EN</button>
          </div>
        </div>
        <form className="login-form" onSubmit={onSubmit}>
          <div>
            <h1>{locale === "zh" ? "管理员登录" : "Admin Sign In"}</h1>
            <p>{locale === "zh" ? "用于保护局域网内的云账号、SSH、宝塔和 AI 配置资料。" : "Protects cloud account, SSH, BT panel, and AI settings on your LAN."}</p>
          </div>
          <label>
            <span>{locale === "zh" ? "用户名" : "Username"}</span>
            <input
              value={form.username}
              onChange={(event) => onFormChange((current) => ({ ...current, username: event.target.value }))}
              autoComplete="username"
              required
            />
          </label>
          <label>
            <span>{locale === "zh" ? "密码" : "Password"}</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => onFormChange((current) => ({ ...current, password: event.target.value }))}
              autoComplete="current-password"
              required
            />
          </label>
          {notice && <div className="login-notice">{notice}</div>}
          <button type="submit" className="primary-button" disabled={busy}>
            <KeyRound aria-hidden="true" />
            {busy ? (locale === "zh" ? "登录中..." : "Signing in...") : (locale === "zh" ? "登录" : "Sign in")}
          </button>
          <div className="login-footnote">
            {locale === "zh" ? "默认账号来自 .env：ADMIN_USERNAME / ADMIN_PASSWORD。首次启动请修改默认密码。" : "Credentials come from .env: ADMIN_USERNAME / ADMIN_PASSWORD. Change the default password after first start."}
          </div>
        </form>
      </section>
    </div>
  );
}
