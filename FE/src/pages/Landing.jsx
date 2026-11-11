import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../components/ui/Icon";
import { useTheme } from "../hooks/useTheme";
import { useAuth } from "../auth/useAuth";
import BrandMark from "../components/ui/BrandMark";
import "./landing.css";

// Landing — public page (route "/"). V6: the page shows the product instead of describing it.
// The hero is one answered question with the passage it cites; the sections below follow the
// real learning sequence (upload, ask, map, test). Copy uses the names the app itself uses and
// makes no claim the app does not back (no user counts, no testimonials).
// Its own scroll container because the app sets `body { overflow: hidden }`.

// A real sequence: each step needs the one before it, so it is drawn as a route with stops
// (the brand mark's path), not as decorative numbering.
const ROUTE = [
  { title: "Tải tài liệu lên", desc: "PDF, Word, PowerPoint, ảnh chụp bài giảng và nhiều định dạng khác." },
  { title: "Hỏi, và đọc cả nguồn", desc: "Mỗi câu trả lời đánh số trích dẫn. Bấm vào số để xem đúng đoạn trong tài liệu." },
  { title: "Nhìn toàn cảnh bằng sơ đồ", desc: "Sơ đồ tư duy và bản đồ kiến thức cho thấy các ý nối với nhau thế nào." },
  { title: "Tự kiểm tra bằng quiz", desc: "Làm bài, xem lại câu chưa đúng và ôn đúng phần còn yếu." },
];

const ALSO = [
  { title: "Tóm tắt theo cấu trúc tài liệu", desc: "Bản tóm tắt đi theo các mục của tài liệu gốc và giữ trích dẫn." },
  { title: "Thư viện học tập", desc: "Xếp tài liệu vào bộ sưu tập, ghim, lưu trữ và xem tiến độ từng tài liệu." },
  { title: "Gia sư AI", desc: "Hỏi và luyện tập theo từng tài liệu khi bạn cần được giảng lại." },
  { title: "Xuất sơ đồ", desc: "Lưu sơ đồ tư duy thành PDF hoặc ảnh để in và ôn ngoài màn hình." },
];

const MAP_BRANCHES = [
  { label: "Quy luật cầu", sub: "Giá tăng, lượng cầu giảm", color: "var(--accent)" },
  { label: "Quy luật cung", sub: "Giá tăng, lượng cung tăng", color: "var(--forest)" },
  { label: "Cân bằng thị trường", sub: "Giá và lượng cân bằng", color: "var(--bronze)" },
  { label: "Độ co giãn", sub: "Mức phản ứng với giá", color: "var(--seal)" },
];

// Illustration: one answer and the passage it cites. Static sample content, labelled as such.
function AnswerSpecimen() {
  return (
    <figure className="lp-specimen" data-landing-specimen>
      <div className="lp-sheet">
        <div className="lp-doc">
          <Icon name="FileText" size={15} />
          <span><strong>Kinh tế vi mô</strong>, chương 2</span>
        </div>
        <p className="lp-ask">Vì sao giá tăng thì lượng cầu giảm?</p>
        <p className="lp-answer">
          Khi giá một hàng hoá tăng và các yếu tố khác không đổi, người mua chuyển sang hàng thay thế
          và mua được ít hơn với cùng thu nhập, nên lượng cầu giảm.<span className="cite-chip">1</span>
        </p>
      </div>
      <div className="lp-slip">
        <div className="lp-slip__head"><span className="cite-chip">1</span> Trang 31, mục 2.1</div>
        <p className="lp-slip__text">
          “…<mark>khi giá của một hàng hoá tăng, lượng cầu về hàng hoá đó giảm</mark>, với điều kiện
          các yếu tố khác không đổi.”
        </p>
      </div>
      <figcaption className="lp-note mt-3">Ví dụ minh hoạ. Câu trả lời thật lấy từ tài liệu bạn tải lên.</figcaption>
    </figure>
  );
}

function ChatBubble({ role, children }) {
  if (role === "user") {
    return (
      <div className="self-end max-w-[78%] px-3.5 py-2 text-body rounded-[10px] rounded-br-[3px] border"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}>
        {children}
      </div>
    );
  }
  return (
    <div className="self-start max-w-[86%] font-display text-body-lg text-text-primary">{children}</div>
  );
}

export default function Landing() {
  const { isDark, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const onLogout = async () => { await logout(); navigate("/"); };

  return (
    <div className="h-screen overflow-y-auto" style={{ background: "var(--bg-base)" }}>

      {/* ── NAV ── */}
      <header className="sticky top-0 z-20 border-b border-border transition-theme"
        style={{ background: "color-mix(in srgb, var(--bg-sidebar) 92%, transparent)", backdropFilter: "blur(8px)" }}>
        <nav className="lp-wrap h-[60px] flex items-center gap-4" aria-label="Điều hướng trang">
          <div className="flex items-center gap-2.5 select-none">
            {/* V5-A: the StudyMap mark replaces the retired "M" seal (same mark as MainLayout.jsx and the favicon). */}
            <BrandMark size={30} />
            <span className="font-display font-semibold text-title tracking-tight text-text-primary">Study<span className="text-seal">Map</span></span>
          </div>
          <div className="flex-1" />
          <button onClick={() => scrollTo("quytrinh")} className="hidden md:inline text-body text-text-secondary hover:text-accent transition-theme">Cách hoạt động</button>
          <button onClick={() => scrollTo("tinhnang")} className="hidden md:inline text-body text-text-secondary hover:text-accent transition-theme">Công cụ</button>
          <button onClick={() => scrollTo("demo")} className="hidden md:inline text-body text-text-secondary hover:text-accent transition-theme">Ví dụ</button>
          <button onClick={toggleTheme} className="icon-btn w-8 h-8" aria-label="Đổi giao diện sáng/tối" title="Sáng/tối">
            <Icon name={isDark ? "Sun" : "Moon"} size={15} />
          </button>
          {user ? (
            <>
              <button onClick={onLogout} className="btn-secondary !py-1.5 !text-small hidden sm:inline-flex">Đăng xuất</button>
              <Link to="/app" className="btn-seal !py-1.5 !text-small">Vào workspace</Link>
            </>
          ) : (
            <>
              <Link to="/login" className="btn-secondary !py-1.5 !text-small hidden sm:inline-flex">Đăng nhập</Link>
              <Link to="/register" className="btn-seal !py-1.5 !text-small">Bắt đầu</Link>
            </>
          )}
        </nav>
      </header>

      <main>
      {/* ── HERO ── */}
      <section className="lp-wrap lp-hero">
        <div className="animate-fadeUp">
          <h1 className="lp-h1">Học từ chính tài liệu của bạn, và luôn biết câu trả lời đến từ đâu.</h1>
          <p className="lp-lede mt-6">
            Tải bài giảng, giáo trình hay đề cương lên. StudyMap trả lời kèm trích dẫn, vẽ sơ đồ tư duy
            và tạo quiz để bạn tự kiểm tra.
          </p>
          <div className="flex flex-wrap gap-3 mt-8">
            {user ? (
              <Link to="/app" className="btn-seal inline-flex items-center gap-2">Vào workspace</Link>
            ) : (
              <Link to="/register" className="btn-seal inline-flex items-center gap-2">Bắt đầu miễn phí</Link>
            )}
            <button onClick={() => scrollTo("quytrinh")} className="btn-secondary">Xem cách hoạt động</button>
          </div>
        </div>
        <AnswerSpecimen />
      </section>

      {/* ── ROUTE ── */}
      <section id="quytrinh" className="lp-band">
        <div className="lp-wrap py-14 sm:py-20">
          <h2 className="lp-h2 mb-10 sm:mb-12">Từ một tệp tài liệu đến lúc bạn nhớ bài</h2>
          <ol className="lp-route">
            {ROUTE.map((r) => (
              <li key={r.title}>
                <h3>{r.title}</h3>
                <p>{r.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── TOOLS ── */}
      <section id="tinhnang" className="lp-wrap pt-14 sm:pt-20">
        <h2 className="lp-h2">Mỗi công cụ trả lời một câu hỏi lúc học</h2>

        <div className="lp-row">
          <div>
            <h3>Chương này gồm những gì?</h3>
            <p>
              Sơ đồ tư duy dựng từ nội dung tài liệu. Mở, thu gọn từng nhánh, và từ mỗi nhánh quay
              lại đúng đoạn nguồn của nó.
            </p>
          </div>
          <div className="lp-panel" aria-hidden="true">
            <div className="lp-map">
              <div className="lp-map__root">Cung và cầu</div>
              <div className="lp-map__stem" />
              <ul>
                {MAP_BRANCHES.map((b) => (
                  <li key={b.label} style={{ "--branch": b.color }}>
                    <span>{b.label}</span>
                    <small>{b.sub}</small>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="lp-row lp-row--flip">
          <div>
            <h3>Mình đã hiểu thật chưa?</h3>
            <p>
              Quiz tạo từ tài liệu của bạn. Chấm xong, StudyMap chỉ ra câu chưa đúng và dẫn lại phần
              cần ôn, để bạn không phải đọc lại từ đầu.
            </p>
          </div>
          <div className="lp-panel" aria-hidden="true">
            <p className="lp-quiz__q">Giá cà phê tăng, các yếu tố khác không đổi. Điều gì xảy ra?</p>
            <div className="lp-quiz__opt"><span className="lp-quiz__dot" />Đường cầu dịch sang phải</div>
            <div className="lp-quiz__opt lp-quiz__opt--right">
              <span className="lp-quiz__dot"><Icon name="Check" size={11} strokeWidth={3} /></span>
              Lượng cầu giảm, trượt dọc theo đường cầu
            </div>
            <div className="lp-quiz__opt"><span className="lp-quiz__dot" />Lượng cung giảm</div>
            <p className="lp-quiz__why">Đúng. Giá thay đổi làm lượng cầu di chuyển trên đường cầu, không làm đường cầu dịch chuyển.</p>
          </div>
        </div>
      </section>

      {/* ── ALSO ── */}
      <section className="lp-wrap pb-14 sm:pb-20">
        <h2 className="lp-h2 mb-6" style={{ fontSize: "1.375rem" }}>Cũng có trong StudyMap</h2>
        <dl className="lp-also">
          {ALSO.map((a) => (
            <div key={a.title}>
              <dt>{a.title}</dt>
              <dd>{a.desc}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── FOLLOW-UP CONVERSATION (static sample) ── */}
      <section id="demo" className="lp-band">
        <div className="lp-wrap py-14 sm:py-20 grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
          <div>
            <h2 className="lp-h2 mb-4">Hỏi tiếp như đang nói chuyện</h2>
            <p className="lp-lede">
              Câu sau không cần nhắc lại tên tài liệu hay khái niệm. StudyMap hiểu “nó” là gì nhờ
              mạch trò chuyện trước đó.
            </p>
            <ul className="lp-facts">
              <li><Icon name="Check" size={15} strokeWidth={2.5} />Câu trả lời chỉ dựa trên những tài liệu bạn đang chọn.</li>
              <li><Icon name="Check" size={15} strokeWidth={2.5} />Xoá ngữ cảnh bất cứ lúc nào để bắt đầu chủ đề mới.</li>
              <li><Icon name="Check" size={15} strokeWidth={2.5} />Tóm tắt và sơ đồ được tạo ở nền, bạn vẫn hỏi tiếp được.</li>
            </ul>
          </div>
          <div className="lp-panel lp-talk">
            <ChatBubble role="user">quy luật cầu là gì?</ChatBubble>
            <ChatBubble role="ai">
              Quy luật cầu nói rằng lượng cầu về một hàng hoá <strong>giảm khi giá của nó tăng</strong>, nếu các yếu tố khác không đổi.<span className="cite-chip">1</span>
            </ChatBubble>
            <ChatBubble role="user">nó có ngoại lệ không?</ChatBubble>
            <ChatBubble role="ai">
              Có. Tài liệu nêu hàng hoá Giffen là trường hợp <strong>giá tăng mà lượng cầu vẫn tăng</strong>.<span className="cite-chip">2</span>
            </ChatBubble>
            <p className="lp-note">Ví dụ minh hoạ.</p>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section>
        <div className="lp-wrap py-16 sm:py-24">
          <h2 className="lp-h2 mb-6" style={{ maxWidth: "22ch" }}>Bắt đầu bằng tài liệu bạn đang học tuần này.</h2>
          <div className="flex flex-wrap gap-3">
            {user ? (
              <Link to="/app" className="btn-seal inline-flex items-center gap-2">Vào workspace</Link>
            ) : (
              <>
                <Link to="/register" className="btn-seal inline-flex items-center gap-2">Bắt đầu miễn phí</Link>
                <Link to="/login" className="btn-secondary">Đăng nhập</Link>
              </>
            )}
          </div>
        </div>
      </section>
      </main>

      {/* ── FOOTER ── */}
      <footer className="border-t border-border" style={{ background: "var(--bg-sidebar)" }}>
        <div className="lp-wrap py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="font-display font-semibold text-body-lg text-text-primary">Study<span className="text-seal">Map</span></div>
          <div className="text-small text-text-muted">Đọc, hỏi và ôn tập từ tài liệu của bạn.</div>
        </div>
      </footer>
    </div>
  );
}
