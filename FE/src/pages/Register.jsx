import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import AuthFrame, { AuthError } from "./AuthFrame";
import Spinner from "../components/ui/Spinner";
import { isValidEmail, isValidPassword, passwordsMatch } from "../auth/validate";
import { safeNext } from "../auth/authRedirect";
import { useAuth } from "../auth/useAuth";

export default function Register() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const { user, loading, register, error, setError } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to={next} replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!isValidEmail(email)) return setError("Email chưa hợp lệ.");
    if (!isValidPassword(password)) return setError("Mật khẩu cần ít nhất 8 ký tự.");
    if (!passwordsMatch(password, confirm)) return setError("Mật khẩu nhập lại không khớp.");
    setSubmitting(true);
    try {
      await register({ email, password, display_name: displayName });
      navigate(next, { replace: true });
    } catch {
      // error surfaced via context.error (e.g. email_exists)
    } finally {
      setSubmitting(false);
    }
  };

  const err = error ? "auth-error" : null;
  const invalid = err ? { "aria-invalid": "true" } : {};
  const describe = (...ids) => [...ids, err].filter(Boolean).join(" ") || undefined;
  const nextQuery = params.get("next") ? `?next=${encodeURIComponent(params.get("next"))}` : "";

  return (
    <AuthFrame
      title="Tạo tài khoản"
      lede="Tạo tài khoản StudyMap bằng email để bắt đầu học với tài liệu của bạn."
      footer={(
        <p className="auth-switch">
          Đã có tài khoản? <Link to={`/login${nextQuery}`}>Đăng nhập</Link>
        </p>
      )}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <label className="auth-field">
          <span className="auth-label">Tên hiển thị <small>(tùy chọn)</small></span>
          <input type="text" autoComplete="name" value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="input-surface" />
        </label>
        <label className="auth-field">
          <span className="auth-label">Email</span>
          <input type="email" autoComplete="email" value={email} {...invalid} aria-describedby={describe()}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ban@vidu.com" className="input-surface" />
        </label>
        {/* The helper sits outside the label, so the field's name stays "Mật khẩu". */}
        <div className="auth-field">
          <label htmlFor="reg-password" className="auth-label">Mật khẩu</label>
          <input id="reg-password" type="password" autoComplete="new-password" value={password} {...invalid}
            aria-describedby={describe("reg-pw-help")}
            onChange={(e) => setPassword(e.target.value)}
            className="input-surface" />
          <span id="reg-pw-help" className="auth-help">Ít nhất 8 ký tự.</span>
        </div>
        <label className="auth-field">
          <span className="auth-label">Nhập lại mật khẩu</span>
          <input type="password" autoComplete="new-password" value={confirm} {...invalid} aria-describedby={describe()}
            onChange={(e) => setConfirm(e.target.value)}
            className="input-surface" />
        </label>

        <AuthError error={error} />

        <button type="submit" disabled={submitting}
          className="btn-seal auth-submit inline-flex items-center justify-center gap-2 disabled:opacity-60">
          {submitting ? <><Spinner size={14} /> Đang tạo…</> : "Tạo tài khoản"}
        </button>
      </form>
    </AuthFrame>
  );
}
