import { useState } from "react";
import { Icon } from "../ui/Icon";
import Spinner from "../ui/Spinner";
import ChangePasswordDialog from "./ChangePasswordDialog";
import { formatTokens, usageByActivity, useAiUsage } from "../../hooks/useAiUsage";

/**
 * V6 — the rest of the account page, under the personal details: what the account has used
 * this month and, for NKS accounts, the password.
 *
 * Laid out as one record sheet: the section name sits in a left column from `md` up (stacked
 * below it), with a rule between sections. Usage is the same `/usage/me` the header chip
 * reads, shown here in full (by activity).
 *
 * Deliberately NOT here: a theme control (owner decision: one theme control, in the header
 * and the phone menu) and sign-out (the account menu, visible at every width, has it).
 */
export default function ProfileSections({ laNks, email, onLogout }) {
  return (
    <div className="profile-sections">
      <UsageSection />
      {/* Only NKS accounts have an NKS password; for a local account the section does not exist. */}
      {laNks && <SecuritySection email={email} onLogout={onLogout} />}
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
    body = <p role="status" className="flex items-center gap-2 text-small text-text-muted"><Spinner size={13} /> Đang tải mức sử dụng…</p>;
  } else if (error && !usage) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-small text-text-secondary">Chưa tải được mức sử dụng.</p>
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
          <p role="status" className="text-body text-text-primary">
            <span className="font-display text-h3 font-semibold text-text-primary">{Math.round(usage.percentage)}%</span>
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
          <div><dt className="text-caption text-text-muted">Còn lại</dt><dd className="text-small text-text-primary">{formatTokens(usage.remaining)} token</dd></div>
          <div><dt className="text-caption text-text-muted">Đặt lại</dt><dd className="text-small text-text-primary">{new Date(usage.reset_at).toLocaleDateString("vi-VN")}</dd></div>
        </dl>
        {het && (
          <p className="mt-3 flex items-start gap-2 text-small text-text-primary">
            <Icon name="TriangleAlert" size={15} className="mt-0.5 shrink-0" style={{ color: "var(--err)" }} />
            Đã hết hạn mức tháng này. Các việc dùng AI sẽ chạy lại sau ngày đặt lại.
          </p>
        )}
        {sapHet && (
          <p className="mt-3 flex items-start gap-2 text-small text-text-primary">
            <Icon name="TriangleAlert" size={15} className="mt-0.5 shrink-0" style={{ color: "var(--warn)" }} />
            Sắp hết hạn mức tháng này.
          </p>
        )}
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

function SecuritySection({ email, onLogout }) {
  const [moDoiMatKhau, setMoDoiMatKhau] = useState(false);
  return (
    <Section id="profile-security" title="Mật khẩu">
      <button type="button" className="pill-action" onClick={() => setMoDoiMatKhau(true)}>
        <Icon name="KeyRound" size={14} /> Đổi mật khẩu
      </button>
      <p className="mt-2 text-caption text-text-muted">Đổi mật khẩu xong, StudyMap đăng xuất mọi thiết bị và mời bạn đăng nhập lại.</p>
      <ChangePasswordDialog
        open={moDoiMatKhau}
        email={email}
        onClose={() => setMoDoiMatKhau(false)}
        onDoiXong={() => { setMoDoiMatKhau(false); onLogout?.({ lyDo: "doi-mat-khau" }); }}
      />
    </Section>
  );
}
