import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../components/ui/Icon";
import { useTheme } from "../hooks/useTheme";
import { useAuth } from "../auth/useAuth";
import BrandMark from "../components/ui/BrandMark";
import "./landing.css";

// Landing — public page (route "/"). V9.3 (docs/StudyMap-V9.3/04): a dark-ink hero in both
// themes (`.lp-ink` scopes the dark token set), then the order the spec asks for: what the
// tool does, what it looks like, why an answer can be checked, where to start.
// Kept from V6: the page shows the product instead of describing it (answer + cited passage
// specimen, route drawn as the brand mark's path), copy uses the app's own names, and it
// makes no claim the app does not back: no user counts, ratings or results, and no notes
// feature (the app has none yet, owner decision D3).
// Its own scroll container because the app sets `body { overflow: hidden }`.

// A real sequence: each step needs the one before it, so it is drawn as a route with stops.
const ROUTE = [
  { title: "Tải tài liệu lên", desc: "PDF, Word, PowerPoint (.pptx), ảnh chụp bài giảng và nhiều định dạng khác." },
  { title: "Hỏi và đối chiếu nguồn", desc: "Câu trả lời đánh số trích dẫn. Bấm vào số để đọc đúng đoạn trong tài liệu." },
  { title: "Xem sơ đồ", desc: "Sơ đồ tư duy và bản đồ kiến thức cho thấy các ý nối với nhau thế nào." },
  { title: "Luyện tập", desc: "Làm quiz, xem lại câu chưa đúng và luyện thêm đúng phần còn yếu." },
];

const ALSO = [
  { title: "Thư viện học tập", desc: "Xếp tài liệu vào bộ sưu tập, ghim, lưu trữ và xem tiến độ từng tài liệu." },
  { title: "Kế hoạch ôn tập", desc: "Sau mỗi bài quiz, các câu chưa đúng được gom thành phần cần ôn và bài luyện thêm." },
  { title: "Gia sư AI", desc: "Hỏi và luyện tập theo từng tài liệu khi bạn cần được giảng lại." },
  { title: "Xuất sơ đồ", desc: "Lưu sơ đồ tư duy thành PDF hoặc ảnh để in và ôn ngoài màn hình." },
];

const MAP_BRANCHES = [
  { label: "Quy luật cầu", sub: "Giá tăng, lượng cầu giảm", color: "var(--accent)" },
  { label: "Quy luật cung", sub: "Giá tăng, lượng cung tăng", color: "var(--bronze)" },
  { label: "Cân bằng thị trường", sub: "Giá và lượng cân bằng", color: "var(--slate)" },
  { label: "Độ co giãn", sub: "Mức phản ứng với giá", color: "var(--text-secondary)" },
];

// Each answer is what the app does today; none promises more than the product enforces.
const FAQ = [
  { q: "StudyMap đọc được những loại tài liệu nào?",
    a: "PDF, Word, PowerPoint (.pptx), ảnh chụp bài giảng và nhiều định dạng khác. Tài liệu cần được xử lý xong trước khi bạn hỏi, tóm tắt hay tạo quiz." },
  { q: "Câu trả lời lấy thông tin từ đâu?",
    a: "Từ những đoạn liên quan trong các tài liệu bạn chọn làm nguồn. Khi tìm được đoạn liên quan, câu trả lời đánh số trích dẫn; bấm vào số để đọc đoạn đó và tự đối chiếu." },
  { q: "Có hỏi trên nhiều tài liệu cùng lúc được không?",
    a: "Được. Chọn nhiều tài liệu làm nguồn trong không gian học. Phần dẫn chứng ghi rõ mỗi đoạn đến từ tài liệu nào." },
  { q: "Làm sao biết mình cần ôn phần nào?",
    a: "Sau khi làm quiz, trang kết quả chỉ ra câu chưa đúng và phần cần ôn. Bạn có thể tạo bài luyện thêm từ đó và xem lại các bài đã làm ở trang Tiến độ." },
  { q: "Tôi đăng nhập bằng tài khoản NKS được không?",
    a: "Được. Ở trang đăng nhập, chọn NKS và dùng tên đăng nhập NKS của bạn. Bạn cũng có thể tạo tài khoản StudyMap bằng email." },
];

const SAMPLE = "Ví dụ minh họa";

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
      <figcaption className="lp-note mt-3">{SAMPLE}. Câu trả lời thật lấy từ tài liệu bạn tải lên.</figcaption>
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
  // Section links are real anchors (`href="#id"`); this only adds the scroll inside the page's own
  // scroll container, without animation for people who asked for reduced motion.
  const scrollTo = (id, event) => {
    event?.preventDefault();
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };
  const onLogout = async () => { await logout(); navigate("/"); };
  const start = user
    ? { to: "/app", label: "Vào không gian học" }
    : { to: "/register", label: "Bắt đầu học" };

  return (
    <div className="h-screen overflow-y-auto" style={{ background: "var(--bg-base)" }}>

      {/* ── NAV (ink in both themes, like the hero it sits on) ── */}
      <header className="lp-ink lp-header sticky top-0 z-20 border-b border-border">
        <nav className="lp-wrap lp-nav h-[60px] flex items-center gap-3 sm:gap-4" aria-label="Điều hướng trang">
          <Link to="/" className="lp-brand flex items-center gap-2.5 select-none" aria-label="StudyMap — trang giới thiệu">
            <BrandMark size={30} />
            <span className="lp-wordmark font-display font-semibold text-title tracking-tight text-text-primary">Study<span className="text-seal">Map</span></span>
          </Link>
          <div className="flex-1" />
          <a href="#quytrinh" onClick={(e) => scrollTo("quytrinh", e)} className="lp-navlink hidden md:inline">Cách học</a>
          <a href="#tinhnang" onClick={(e) => scrollTo("tinhnang", e)} className="lp-navlink hidden md:inline">Công cụ</a>
          <a href="#hoidap" onClick={(e) => scrollTo("hoidap", e)} className="lp-navlink hidden md:inline">Hỏi đáp</a>
          <button onClick={toggleTheme} className="icon-btn w-11 h-11" aria-label="Đổi giao diện sáng/tối" title="Sáng/tối">
            <Icon name={isDark ? "Sun" : "Moon"} size={15} />
          </button>
          {user ? (
            <>
              <button onClick={onLogout} className="btn-secondary !py-1.5 !text-small hidden sm:inline-flex">Đăng xuất</button>
              <Link to="/app" className="btn-seal !py-1.5 !text-small">Vào không gian học</Link>
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
      <section className="lp-ink lp-hero">
        <div className="lp-wrap lp-hero__grid">
          <div>
            <h1 className="lp-h1">Đọc có nguồn. Hiểu đến gốc.</h1>
            <p className="lp-lede mt-6">
              Tải bài giảng, giáo trình hay đề cương lên rồi hỏi về chính tài liệu đó. Câu trả lời
              đánh số trích dẫn, bấm vào là thấy đúng đoạn nguồn để tự đối chiếu.
            </p>
            <div className="flex flex-wrap gap-3 mt-8">
              <Link to={start.to} className="btn-seal lp-cta inline-flex items-center gap-2">{start.label}</Link>
              <a href="#quytrinh" onClick={(e) => scrollTo("quytrinh", e)} className="btn-secondary">Xem cách học</a>
            </div>
          </div>
          <AnswerSpecimen />
        </div>
      </section>

      {/* ── ROUTE: what the tool does, in the order you use it ── */}
      <section id="quytrinh" className="lp-band">
        <div className="lp-wrap py-14 sm:py-20">
          <h2 className="lp-h2 mb-10 sm:mb-12">Từ một tệp tài liệu đến lúc bạn tự kiểm tra được</h2>
          <ol className="lp-route">
            {ROUTE.map((r) => (
              <li key={r.title}>
                <h3>{r.title}</h3>
                <p>{r.desc}</p>
              </li>
            ))}
          </ol>
          <p className="lp-preview-link">
            <Link to="/onboarding">Xem trước phần hướng dẫn bắt đầu</Link>
            <span className="lp-note"> Bản xem trước, không lưu lựa chọn.</span>
          </p>
        </div>
      </section>

      {/* ── WHY AN ANSWER CAN BE CHECKED ── */}
      <section id="doichieu" className="lp-wrap py-14 sm:py-20 grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
        <div>
          <h2 className="lp-h2 mb-4">Câu trả lời đi kèm đoạn nguồn</h2>
          <p className="lp-lede">
            Mỗi ý trong câu trả lời có số trích dẫn. Bấm số để mở đúng đoạn trong tài liệu, đọc
            ngữ cảnh xung quanh, rồi tự quyết định có tin hay không. Câu sau không cần nhắc lại tên
            tài liệu: StudyMap hiểu “nó” là gì nhờ mạch trò chuyện trước đó.
          </p>
          <ul className="lp-facts">
            <li><Icon name="Check" size={15} strokeWidth={2.5} />Khi bạn chọn tài liệu, câu trả lời chỉ dựa trên các tài liệu đó.</li>
            <li><Icon name="Check" size={15} strokeWidth={2.5} />Xoá ngữ cảnh bất cứ lúc nào để bắt đầu chủ đề mới.</li>
            <li><Icon name="Check" size={15} strokeWidth={2.5} />Tóm tắt và sơ đồ được tạo ở nền, bạn vẫn hỏi tiếp được.</li>
          </ul>
        </div>
        <figure className="lp-panel lp-talk">
          <ChatBubble role="user">quy luật cầu là gì?</ChatBubble>
          <ChatBubble role="ai">
            Quy luật cầu nói rằng lượng cầu về một hàng hoá <strong>giảm khi giá của nó tăng</strong>, nếu các yếu tố khác không đổi.<span className="cite-chip">1</span>
          </ChatBubble>
          <ChatBubble role="user">nó có ngoại lệ không?</ChatBubble>
          <ChatBubble role="ai">
            Có. Tài liệu nêu hàng hoá Giffen là trường hợp <strong>giá tăng mà lượng cầu vẫn tăng</strong>.<span className="cite-chip">2</span>
          </ChatBubble>
          <figcaption className="lp-note">{SAMPLE} một cuộc hỏi đáp có trích dẫn.</figcaption>
        </figure>
      </section>

      {/* ── TOOLS ── */}
      <section id="tinhnang" className="lp-band">
        <div className="lp-wrap pt-14 sm:pt-20">
          <h2 className="lp-h2">Mỗi công cụ trả lời một câu hỏi lúc học</h2>

          <div className="lp-row">
            <div className="lp-copy">
              <h3>Bài này nói những ý chính nào?</h3>
              <p>
                Tóm tắt đi theo các mục của tài liệu gốc và giữ trích dẫn, nên mỗi ý tóm lại vẫn
                dẫn về được đoạn đã nói ra nó.
              </p>
            </div>
            <figure className="lp-panel">
              <ol className="lp-summary">
                <li><strong>2.1 Quy luật cầu.</strong> Giá tăng thì lượng cầu giảm, khi các yếu tố khác không đổi.<span className="cite-chip">1</span></li>
                <li><strong>2.2 Quy luật cung.</strong> Giá tăng thì người bán muốn bán nhiều hơn.<span className="cite-chip">2</span></li>
                <li><strong>2.3 Cân bằng.</strong> Giá dừng ở mức lượng cung bằng lượng cầu.<span className="cite-chip">3</span></li>
              </ol>
              <figcaption className="lp-note mt-4">{SAMPLE} một bản tóm tắt theo mục.</figcaption>
            </figure>
          </div>

          <div className="lp-row lp-row--flip">
            <div className="lp-copy">
              <h3>Chương này gồm những gì?</h3>
              <p>
                Sơ đồ tư duy dựng từ nội dung tài liệu. Mở, thu gọn từng nhánh, và từ mỗi nhánh quay
                lại đúng đoạn nguồn của nó.
              </p>
            </div>
            <figure className="lp-panel">
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
              <figcaption className="lp-note mt-4">{SAMPLE} một sơ đồ tư duy.</figcaption>
            </figure>
          </div>

          <div className="lp-row">
            <div className="lp-copy">
              <h3>Mình đã hiểu thật chưa?</h3>
              <p>
                Quiz tạo từ tài liệu của bạn. Chấm xong, StudyMap chỉ ra câu chưa đúng và dẫn lại phần
                cần ôn, để bạn không phải đọc lại từ đầu.
              </p>
            </div>
            <figure className="lp-panel">
              <p className="lp-quiz__q">Giá cà phê tăng, các yếu tố khác không đổi. Điều gì xảy ra?</p>
              <div className="lp-quiz__opt"><span className="lp-quiz__dot" aria-hidden="true" />Đường cầu dịch sang phải</div>
              <div className="lp-quiz__opt lp-quiz__opt--right">
                <span className="lp-quiz__dot" aria-hidden="true"><Icon name="Check" size={11} strokeWidth={3} /></span>
                <span><span className="sr-only">Đáp án đúng: </span>Lượng cầu giảm, trượt dọc theo đường cầu</span>
              </div>
              <div className="lp-quiz__opt"><span className="lp-quiz__dot" aria-hidden="true" />Lượng cung giảm</div>
              <p className="lp-quiz__why">Đúng. Giá thay đổi làm lượng cầu di chuyển trên đường cầu, không làm đường cầu dịch chuyển.</p>
              <figcaption className="lp-note mt-3">{SAMPLE} một câu quiz đã chấm.</figcaption>
            </figure>
          </div>

          <div className="pb-14 sm:pb-20">
            <h3 className="lp-h3 mb-2">Cũng có trong StudyMap</h3>
            <dl className="lp-also">
              {ALSO.map((a) => (
                <div key={a.title}>
                  <dt>{a.title}</dt>
                  <dd>{a.desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ── FAQ: independent details, any number open at once ── */}
      <section id="hoidap" className="lp-wrap py-14 sm:py-20">
        <h2 className="lp-h2 mb-6">Câu hỏi thường gặp</h2>
        <div className="lp-faq">
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="lp-ink lp-final">
        <div className="lp-wrap py-16 sm:py-24">
          <h2 className="lp-h2 mb-6" style={{ maxWidth: "22ch" }}>Bắt đầu bằng tài liệu bạn đang học tuần này.</h2>
          <div className="flex flex-wrap gap-3">
            <Link to={start.to} className="btn-seal inline-flex items-center gap-2">{start.label}</Link>
            {!user && <Link to="/login" className="btn-secondary">Đăng nhập</Link>}
          </div>
        </div>
      </section>
      </main>

      {/* ── FOOTER ── */}
      <footer className="border-t border-border" style={{ background: "var(--bg-sidebar)" }}>
        <div className="lp-wrap py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="lp-footer-wordmark font-display font-semibold text-body-lg text-text-primary">Study<span className="text-seal">Map</span></div>
          <div className="text-small text-text-muted">Đọc có nguồn. Hiểu đến gốc.</div>
        </div>
      </footer>
    </div>
  );
}
