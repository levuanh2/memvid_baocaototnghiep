import { Link } from "react-router-dom";
import { Icon } from "../components/ui/Icon";
import BrandMark from "../components/ui/BrandMark";
import "./auth.css";

// V9.3 P2b (docs/StudyMap-V9.3/04 "Auth"): an ink intro beside a light form; stacked on
// phones with the intro cut to brand + claim so the form stays near the top. Presentation
// only: Login/Register keep the real auth calls, provider choice and redirect rules.
export default function AuthFrame({ title, lede, children, footer }) {
  return (
    <div className="auth-page h-screen overflow-y-auto">
      <div className="auth-grid">
        <aside className="auth-intro lp-ink">
          <Link to="/" className="auth-brand" aria-label="StudyMap — trang giới thiệu">
            <BrandMark size={30} />
            <span className="font-display font-semibold text-title tracking-tight">Study<span className="text-seal">Map</span></span>
          </Link>
          <p className="auth-claim"><span>Đọc có nguồn.</span> <span>Hiểu đến gốc.</span></p>
          <ul className="auth-points">
            <li><Icon name="Quote" size={16} aria-hidden="true" />Hỏi về tài liệu của bạn; khi tìm được đoạn liên quan, câu trả lời kèm trích dẫn.</li>
            <li><Icon name="Network" size={16} aria-hidden="true" />Sơ đồ tư duy và tóm tắt đi theo cấu trúc tài liệu.</li>
            <li><Icon name="Target" size={16} aria-hidden="true" />Quiz chỉ ra câu chưa đúng và phần cần ôn.</li>
          </ul>
          <Link to="/" className="auth-back"><Icon name="ArrowLeft" size={14} /> Về trang giới thiệu</Link>
        </aside>
        <main className="auth-form">
          <div className="auth-card">
            <h1 className="auth-title">{title}</h1>
            <p className="auth-lede">{lede}</p>
            {children}
            {footer}
          </div>
        </main>
      </div>
    </div>
  );
}

/** The one error line of a form: announced, and referenced by every field it concerns. */
export function AuthError({ error }) {
  if (!error) return null;
  return (
    <p id="auth-error" role="alert" className="auth-error">
      <Icon name="AlertCircle" size={15} aria-hidden="true" /> {error}
    </p>
  );
}
