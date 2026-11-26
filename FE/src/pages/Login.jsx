import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../components/ui/Icon";
import AuthFrame, { AuthError } from "./AuthFrame";
import Spinner from "../components/ui/Spinner";
import { kiemTra, PROVIDER_MAC_DINH, thongBaoSauDangXuat } from "../auth/loginForm";
import { safeNext } from "../auth/authRedirect";
import { useAuth } from "../auth/useAuth";
import { takeNotesLostNotice } from "../utils/notesPreview";

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  // Thông báo tra từ BẢNG TRẮNG theo mã — không lấy câu chữ từ URL.
  const thongBao = thongBaoSauDangXuat(params.get("tb"));
  // V9.3 P5b: a session that ended with an unsavable browser-notes draft says so once.
  const [ghiChuMat] = useState(() => takeNotesLostNotice());
  const { user, loading, login, error, setError } = useAuth();
  const [provider, setProvider] = useState(PROVIDER_MAC_DINH);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const laNks = provider === "nks";

  // Already signed in → skip the form.
  if (!loading && user) return <Navigate to={next} replace />;

  const doiProvider = (p) => {
    if (p === provider) return;
    setProvider(p);
    // Xoá lỗi của provider trước, nhưng GIỮ giá trị đã gõ ở mỗi ô: đổi qua đổi lại
    // mà mất chữ vừa nhập là cách nhanh nhất làm người ta gõ lại sai.
    setError("");
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    const loi = kiemTra(provider, { dinhDanh: laNks ? username : email, password });
    if (loi) return setError(loi);
    setSubmitting(true);
    try {
      await login(laNks ? username.trim() : email, password, laNks ? "nks" : undefined);
      navigate(next, { replace: true });
    } catch {
      // error is surfaced via context.error
    } finally {
      setSubmitting(false);
    }
  };

  // One error line for the form: every field points at it while it is shown.
  const invalid = error ? { "aria-invalid": "true", "aria-describedby": "auth-error" } : {};
  const nextQuery = params.get("next") ? `?next=${encodeURIComponent(params.get("next"))}` : "";

  return (
    <AuthFrame
      title="Đăng nhập"
      lede="Tiếp tục làm việc với tài liệu của bạn."
      footer={(
        <p className="auth-switch">
          Chưa có tài khoản? <Link to={`/register${nextQuery}`}>Tạo tài khoản</Link>
        </p>
      )}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {/* Chọn nguồn tài khoản. Mặc định là tài khoản StudyMap — người dùng cũ
            mở trang này thấy đúng thứ họ vẫn thấy. "Tài khoản" nói một lần ở nhãn nhóm
            để mỗi lựa chọn giữ một dòng ở mọi bề rộng (V9.3 P1a). */}
        <div className="auth-field">
          <span id="login-provider-label" className="auth-label">Đăng nhập bằng tài khoản</span>
          <div className="flex gap-1.5" role="radiogroup" aria-labelledby="login-provider-label">
            {[["local", "StudyMap"], ["nks", "NKS"]].map(([gt, nhan]) => (
              <button key={gt} type="button" role="radio" aria-checked={provider === gt}
                onClick={() => doiProvider(gt)}
                className={`pill-tab flex-1 justify-center min-h-[44px] whitespace-nowrap ${provider === gt ? "pill-tab-active" : ""}`}>
                {nhan}
              </button>
            ))}
          </div>
        </div>

        {laNks ? (
          <label className="auth-field">
            <span className="auth-label">Tên đăng nhập NKS</span>
            <input type="text" autoComplete="username" value={username} {...invalid}
              onChange={(e) => setUsername(e.target.value)}
              className="input-surface" />
          </label>
        ) : (
          <label className="auth-field">
            <span className="auth-label">Email</span>
            <input type="email" autoComplete="email" value={email} {...invalid}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ban@vidu.com" className="input-surface" />
          </label>
        )}
        <label className="auth-field">
          <span className="auth-label">Mật khẩu</span>
          <input type="password" autoComplete="current-password" value={password} {...invalid}
            onChange={(e) => setPassword(e.target.value)}
            className="input-surface" />
        </label>

        {ghiChuMat && (
          <p role="alert" className="auth-status">
            <Icon name="Info" size={15} aria-hidden="true" /> Phiên trước kết thúc khi một bản nháp ghi chú chưa lưu được vào trình duyệt này, nên bản nháp đó đã mất.
          </p>
        )}
        {thongBao && !error && (
          <p role="status" className="auth-status">
            <Icon name="BadgeCheck" size={15} aria-hidden="true" /> {thongBao}
          </p>
        )}
        <AuthError error={error} />

        <button type="submit" disabled={submitting}
          className="btn-seal auth-submit inline-flex items-center justify-center gap-2 disabled:opacity-60">
          {submitting ? <><Spinner size={14} /> Đang đăng nhập…</> : "Đăng nhập"}
        </button>
      </form>
    </AuthFrame>
  );
}
