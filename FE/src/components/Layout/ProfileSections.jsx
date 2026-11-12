import { useState } from "react";
import { Icon } from "../ui/Icon";
import Spinner from "../ui/Spinner";
import ChangePasswordDialog from "./ChangePasswordDialog";
import { useTheme } from "../../hooks/useTheme";
import { formatTokens, usageByActivity, useAiUsage } from "../../hooks/useAiUsage";

/**
 * V6 — the rest of the account page, under the personal details: what the account has used
 * this month, how the app looks, and sign-in security.
 *
 * Laid out as one record sheet: the section name sits in a left column from `md` up (stacked
 * below it), with a rule between sections. Nothing here is new data: usage is the same
 * `/usage/me` the header chip reads, the theme is the same `memvid-theme` setting, and
 * password change / sign-out are the same actions the account menu offers.
 */
export default function ProfileSections({ laNks, email, onLogout }) {
  return (
    <div className="profile-sections">
      <UsageSection />
      <AppearanceSection />
      <SecuritySection laNks={laNks} email={email} onLogout={onLogout} />
    </div>
  );
}

function Section({ id, title, children }) {
  return (
    <section aria-labelledby={id} className="profile-section">
      <h2 id={id} className="profile-section__title">{title}</h2>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function UsageSection() {
  const { usage, loading, error, load } = useAiUsage();

  let body;
  if (loading && !usage) {
    body = <p className="flex items-center gap-2 text-small text-text-muted"><Spinner size={13} /> Đang tải mức sử dụng…</p>;
  } else if (error && !usage) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-small text-text-secondary">Chưa tải được mức sử dụng.</p>
        <button type="button" onClick={load} className="pill-action"><Icon name="RotateCcw" size={13} /> Tải lại</button>
      </div>
    );
  } else if (!usage) {
    // The server answered without a limit: there is nothing true to draw.
    body = <p className="text-small text-text-muted">Tài khoản này chưa có thông tin mức sử dụng.</p>;
  } else {
    const het = usage.remaining <= 0;
    const sapHet = usage.percentage >= 80 && !het;
    const mau = het ? "var(--err)" : sapHet ? "var(--warn)" : "var(--accent)";
    const theoViec = usageByActivity(usage.breakdown);
    const lonNhat = theoViec.length ? theoViec[0][1] : 0;
    return (
      <Section id="profile-usage" title="Mức sử dụng AI">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-body text-text-primary">
            <span className="font-display text-h3 font-semibold" style={{ color: mau }}>{Math.round(usage.percentage)}%</span>
            {" "}hạn mức tháng này
          </p>
          <p className="text-small text-text-muted">Gói {usage.plan}</p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "var(--bg-elevated)" }}
             role="progressbar" aria-label="Mức sử dụng AI tháng này"
             aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(usage.percentage))}>
          <div className="h-full" style={{ width: `${Math.min(100, usage.percentage)}%`, background: mau }} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-3">
          <div><dt className="text-caption text-text-muted">Đã dùng</dt><dd className="text-small text-text-primary">{formatTokens(usage.used)} token</dd></div>
          <div><dt className="text-caption text-text-muted">Còn lại</dt><dd className="text-small" style={{ color: het ? "var(--err)" : "var(--text-primary)" }}>{formatTokens(usage.remaining)} token</dd></div>
          <div><dt className="text-caption text-text-muted">Đặt lại</dt><dd className="text-small text-text-primary">{new Date(usage.reset_at).toLocaleDateString("vi-VN")}</dd></div>
        </dl>
        {het && <p className="mt-3 text-small" style={{ color: "var(--err)" }}>Đã hết hạn mức tháng này. Các việc dùng AI sẽ chạy lại sau ngày đặt lại.</p>}
        {theoViec.length > 0 && (
          <div className="mt-5">
            <h3 className="text-small font-medium text-text-secondary">Dùng vào việc gì</h3>
            <ul className="mt-2 space-y-2">
              {theoViec.map(([nhan, tong]) => (
                <li key={nhan} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                  <span className="text-small text-text-primary truncate">{nhan}</span>
                  <span className="text-small text-text-muted tabular-nums">{formatTokens(tong)}</span>
                  <span aria-hidden className="col-span-2 h-1 rounded-full" style={{ background: "var(--bg-elevated)" }}>
                    <span className="block h-full rounded-full" style={{ width: `${lonNhat ? Math.max(2, (tong / lonNhat) * 100) : 0}%`, background: "var(--slate)" }} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>
    );
  }
  return <Section id="profile-usage" title="Mức sử dụng AI">{body}</Section>;
}

function AppearanceSection() {
  const { isDark, setLight, setDark } = useTheme();
  const nut = "profile-theme-option";
  return (
    <Section id="profile-appearance" title="Giao diện">
      {/* A settings page shows the state, so this is a two-option choice (the header button is
          the quick switch). Same `memvid-theme` setting either way. */}
      <div role="radiogroup" aria-label="Nền" className="inline-flex rounded-[8px] border p-1 gap-1" style={{ borderColor: "var(--border-color)" }}>
        <button type="button" role="radio" aria-checked={!isDark} onClick={setLight} className={nut} data-active={!isDark ? "true" : undefined}>
          <Icon name="Sun" size={14} /> Nền sáng
        </button>
        <button type="button" role="radio" aria-checked={isDark} onClick={setDark} className={nut} data-active={isDark ? "true" : undefined}>
          <Icon name="Moon" size={14} /> Nền tối
        </button>
      </div>
      <p className="mt-2 text-caption text-text-muted">Lựa chọn được nhớ trên trình duyệt này.</p>
    </Section>
  );
}

function SecuritySection({ laNks, email, onLogout }) {
  const [moDoiMatKhau, setMoDoiMatKhau] = useState(false);
  return (
    <Section id="profile-security" title="Đăng nhập và bảo mật">
      <div className="flex flex-wrap gap-2">
        {/* Only NKS accounts have an NKS password to change; for a local account the action
            does not exist, exactly as in the account menu. */}
        {laNks && (
          <button type="button" className="pill-action" onClick={() => setMoDoiMatKhau(true)}>
            <Icon name="KeyRound" size={14} /> Đổi mật khẩu
          </button>
        )}
        <button type="button" className="pill-action" onClick={() => onLogout?.()}>
          <Icon name="LogOut" size={14} /> Đăng xuất
        </button>
      </div>
      {laNks && (
        <p className="mt-2 text-caption text-text-muted">Đổi mật khẩu xong, StudyMap đăng xuất mọi thiết bị và mời bạn đăng nhập lại.</p>
      )}
      {laNks && (
        <ChangePasswordDialog
          open={moDoiMatKhau}
          email={email}
          onClose={() => setMoDoiMatKhau(false)}
          onDoiXong={() => { setMoDoiMatKhau(false); onLogout?.({ lyDo: "doi-mat-khau" }); }}
        />
      )}
    </Section>
  );
}
