import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../components/ui/Icon";
import Spinner from "../components/ui/Spinner";
import { kiemTra, PROVIDER_MAC_DINH, thongBaoSauDangXuat } from "../auth/loginForm";
import { safeNext } from "../auth/authRedirect";
import { useAuth } from "../auth/useAuth";

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  // Thông báo tra từ BẢNG TRẮNG theo mã — không lấy câu chữ từ URL.
  const thongBao = thongBaoSauDangXuat(params.get("tb"));
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

  return (
    <div className="h-screen overflow-y-auto flex items-center justify-center px-5 py-10" style={{ background: "var(--bg-base)" }}>
      <div className="w-full max-w-[400px]">
        <Link to="/" className="inline-flex items-center gap-1.5 text-small text-text-muted hover:text-brand mb-6 transition-theme">
          <Icon name="ArrowLeft" size={14} /> Về trang chủ
        </Link>

        <div className="surface-card !p-7">
          <div className="mb-6">
            <div className="font-mono text-metadata uppercase text-text-muted mb-2">Phòng đọc</div>
            <h1 className="font-display text-h2 font-semibold text-text-primary">Đăng nhập</h1>
            <p className="text-body text-text-secondary mt-1">Tiếp tục làm việc với tài liệu của bạn.</p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
            {/* Chọn nguồn tài khoản. Mặc định là tài khoản StudyMap — người dùng cũ
                mở trang này thấy đúng thứ họ vẫn thấy. */}
            <div className="flex gap-1.5" role="radiogroup" aria-label="Nguồn tài khoản">
              {[["local", "Tài khoản StudyMap"], ["nks", "Tài khoản NKS"]].map(([gt, nhan]) => (
                <button key={gt} type="button" role="radio" aria-checked={provider === gt}
                  onClick={() => doiProvider(gt)}
                  className={`pill-tab flex-1 justify-center !py-1.5 ${provider === gt ? "pill-tab-active" : ""}`}>
                  {nhan}
                </button>
              ))}
            </div>

            {laNks ? (
              <label className="flex flex-col gap-1.5">
                <span className="text-small font-medium text-text-secondary">Tên đăng nhập NKS</span>
                <input type="text" autoComplete="username" value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="tên đăng nhập" className="input-surface text-body" />
              </label>
            ) : (
              <label className="flex flex-col gap-1.5">
                <span className="text-small font-medium text-text-secondary">Email</span>
                <input type="email" autoComplete="email" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ban@vidu.com" className="input-surface text-body" />
              </label>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-small font-medium text-text-secondary">Mật khẩu</span>
              <input type="password" autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" className="input-surface text-body" />
            </label>

            {thongBao && !error && (
              <p role="status" className="flex items-center gap-1.5 text-small mb-3"
                style={{ color: "var(--ok)" }}>
                <Icon name="BadgeCheck" size={13} /> {thongBao}
              </p>
            )}
            {error && (
              <div className="text-small flex items-center gap-1.5" style={{ color: "var(--err)" }}>
                <Icon name="AlertCircle" size={13} /> {error}
              </div>
            )}

            <button type="submit" disabled={submitting}
              className="btn-seal w-full mt-1 inline-flex items-center justify-center gap-2 disabled:opacity-60">
              {submitting ? <><Spinner size={14} /> Đang đăng nhập…</> : "Đăng nhập"}
            </button>
          </form>

          <p className="text-small text-text-secondary text-center mt-5">
            Chưa có tài khoản?{" "}
            <Link to={`/register${params.get("next") ? `?next=${encodeURIComponent(params.get("next"))}` : ""}`}
              className="text-brand font-medium hover:underline">Tạo tài khoản</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
