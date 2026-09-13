import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../components/ui/Icon";
import { useTheme } from "../hooks/useTheme";
import { useAuth } from "../auth/useAuth";

// Landing — public marketing page (route "/").
// Built entirely from the existing "Phòng đọc" design system (giấy dó paper +
// seal-red accent + Spectral display). Its own scroll container because the app
// sets `body { overflow: hidden }`.

const PROBLEMS = [
  { icon: "FileStack", title: "Tài liệu dài", desc: "Hàng chục trang, đọc hết rất tốn thời gian." },
  { icon: "Search", title: "Khó tìm ý chính", desc: "Ý quan trọng nằm rải rác, dễ bỏ sót." },
  { icon: "Clock", title: "Ôn tập mất thời gian", desc: "Xem lại từ đầu mỗi khi cần tra cứu." },
  { icon: "Unlink", title: "Hỏi rời rạc", desc: "Hỏi từng đoạn, mất mạch ngữ cảnh." },
];

const SOLUTIONS = [
  { icon: "Upload", title: "Upload tài liệu", desc: "PDF, Word, Markdown — vài giây là xong." },
  { icon: "Quote", title: "Hỏi đáp bám nguồn", desc: "Mỗi câu trả lời gắn dẫn chứng từ tài liệu." },
  { icon: "ScrollText", title: "Tóm tắt", desc: "Rút gọn theo mục lục, giữ đúng cấu trúc." },
  { icon: "Network", title: "Mindmap", desc: "Sơ đồ tư duy tự động từ nội dung." },
  { icon: "MessagesSquare", title: "Ngữ cảnh hội thoại", desc: 'Hiểu "nó", "phần đó" theo mạch trò chuyện.' },
];

const WORKFLOW = [
  { n: "01", title: "Upload tài liệu", desc: "Chọn tệp cần đọc, hệ thống lập chỉ mục bám nguồn." },
  { n: "02", title: "Chat với tài liệu", desc: "Đặt câu hỏi, nhận câu trả lời kèm trích dẫn." },
  { n: "03", title: "Tạo summary / mindmap", desc: "Một cú nhấp để có bản tóm tắt và sơ đồ tư duy." },
  { n: "04", title: "Ôn tập / tham khảo lại", desc: "Quay lại bất cứ lúc nào, hỏi tiếp theo ngữ cảnh." },
];

const FEATURES = [
  { icon: "MessageSquareText", title: "Document Chat", desc: "Trò chuyện trực tiếp với tài liệu đã chọn." },
  { icon: "Quote", title: "Source-grounded Answer", desc: "Câu trả lời trích dẫn đúng đoạn nguồn." },
  { icon: "ScrollText", title: "Summary v2", desc: "Tóm tắt theo mục lục, phản ánh cấu trúc thật." },
  { icon: "Network", title: "Mindmap v3", desc: "Sơ đồ tư duy nhiều tầng, xuất ảnh được." },
  { icon: "MessagesSquare", title: "Conversation Context", desc: "Hiểu câu hỏi nối tiếp, chống lẫn tài liệu." },
  { icon: "Zap", title: "Background Queue", desc: "Job nặng chạy nền, không chặn cuộc chat." },
];

function Mockup() {
  // Static 3-pane sketch of the workspace — decorative, no real data.
  return (
    <div className="surface-card !p-3 select-none" aria-hidden>
      <div className="flex gap-2 h-[230px]">
        <div className="w-[26%] rounded-[6px] border border-border p-2 flex flex-col gap-1.5" style={{ background: "var(--bg-elevated)" }}>
          <div className="h-2 w-3/4 rounded-full" style={{ background: "var(--border-strong)" }} />
          <div className="h-6 rounded-[4px] border border-border" style={{ background: "var(--bg-card)" }} />
          <div className="h-6 rounded-[4px] border" style={{ borderColor: "rgba(178,58,46,0.4)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" }} />
          <div className="h-6 rounded-[4px] border border-border" style={{ background: "var(--bg-card)" }} />
        </div>
        <div className="flex-1 rounded-[6px] border border-border p-2.5 flex flex-col gap-2" style={{ background: "var(--bg-card)" }}>
          <div className="self-end w-[55%] h-6 rounded-[8px] rounded-br-[3px] border border-border" style={{ background: "var(--bg-elevated)" }} />
          <div className="w-[85%] h-2 rounded-full" style={{ background: "var(--border-strong)" }} />
          <div className="w-[70%] h-2 rounded-full" style={{ background: "var(--border-color)" }} />
          <div className="flex items-center gap-1">
            <div className="w-[45%] h-2 rounded-full" style={{ background: "var(--border-color)" }} />
            <span className="cite-chip">1</span>
          </div>
          <div className="mt-auto h-8 rounded-[6px] border border-border" style={{ background: "var(--bg-elevated)" }} />
        </div>
        <div className="w-[24%] rounded-[6px] border border-border p-2 flex flex-col gap-1.5" style={{ background: "var(--bg-sidebar)" }}>
          <div className="coord">NGUỒN · 1</div>
          <div className="h-14 rounded-[5px] border" style={{ borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 6%, transparent)" }} />
          <div className="h-10 rounded-[5px] border border-border" style={{ background: "var(--bg-card)" }} />
        </div>
      </div>
    </div>
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
    <div className="self-start max-w-[86%] font-display text-body text-text-primary">{children}</div>
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
        <nav className="max-w-[1080px] mx-auto px-5 sm:px-8 h-[60px] flex items-center gap-4">
          <div className="flex items-center gap-2.5 select-none">
            {/* Same wordmark seal as MainLayout.jsx — stays --seal (Signature Contract §7). */}
            <span className="w-[30px] h-[30px] rounded-[6px] inline-flex items-center justify-center font-display text-body-lg font-semibold"
              style={{ color: "var(--seal)", border: "1.5px solid var(--seal)", transform: "rotate(-4deg)" }} aria-hidden>M</span>
            <span className="font-display font-semibold text-title tracking-tight text-text-primary">MemVid<span className="text-seal">X</span></span>
          </div>
          <div className="flex-1" />
          <button onClick={() => scrollTo("tinhnang")} className="hidden md:inline text-body text-text-secondary hover:text-forest transition-theme">Tính năng</button>
          <button onClick={() => scrollTo("quytrinh")} className="hidden md:inline text-body text-text-secondary hover:text-forest transition-theme">Quy trình</button>
          <button onClick={() => scrollTo("demo")} className="hidden md:inline text-body text-text-secondary hover:text-forest transition-theme">Demo</button>
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

      {/* ── HERO ── */}
      <section className="max-w-[1080px] mx-auto px-5 sm:px-8 pt-16 pb-14 grid md:grid-cols-2 gap-10 items-center">
        <div className="animate-fadeUp">
          <div className="font-mono text-metadata uppercase text-text-muted mb-4">Phòng đọc · RAG bám nguồn</div>
          <h1 className="font-display text-display font-semibold text-text-primary" style={{ textWrap: "balance" }}>
            Hỏi tài liệu của bạn — <span className="text-seal">kèm dẫn chứng</span>.
          </h1>
          <p className="font-body text-body text-text-secondary mt-6 max-w-[520px]">
            Upload tài liệu, hỏi đáp bám nguồn, tóm tắt, tạo mindmap và tiếp tục hỏi bằng ngữ cảnh hội thoại.
          </p>
          <div className="flex flex-wrap gap-3 mt-7">
            {user ? (
              <Link to="/app" className="btn-seal inline-flex items-center gap-2">Vào workspace <Icon name="ArrowRight" size={16} /></Link>
            ) : (
              <Link to="/register" className="btn-seal inline-flex items-center gap-2">Bắt đầu miễn phí <Icon name="ArrowRight" size={16} /></Link>
            )}
            <button onClick={() => scrollTo("demo")} className="btn-secondary">Xem demo</button>
          </div>
        </div>
        <div className="animate-fadeUp"><Mockup /></div>
      </section>

      {/* ── PROBLEM ── */}
      {/* Sprint J (Hallmark C2/L1): was a 4-col icon-tile grid — the same
          shape as the SOLUTION grid right below it, so the page opened with
          two back-to-back identical-looking sections. Dropped the icons and
          the grid; reads as a short list of friction points, not a second
          feature-tile row, and its tighter rhythm (py-12, gap-y-3) varies
          against its neighbors instead of matching their py-14 uniformly. */}
      <section className="border-t border-border" style={{ background: "var(--bg-sidebar)" }}>
        <div className="max-w-[1080px] mx-auto px-5 sm:px-8 py-12">
          <h2 className="font-display text-h1 font-semibold text-text-primary mb-2">Đọc tài liệu dài không nên khó đến vậy</h2>
          <p className="text-body text-text-secondary mb-6 max-w-[560px]">Những trở ngại quen thuộc khi làm việc với tài liệu học tập và nghiên cứu.</p>
          <ul className="grid sm:grid-cols-2 gap-x-10 gap-y-3 max-w-[760px]">
            {PROBLEMS.map((p) => (
              <li key={p.title} className="text-body text-text-secondary">
                <span className="font-display font-semibold text-text-primary">{p.title}.</span>{" "}{p.desc}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── SOLUTION ── */}
      <section className="max-w-[1080px] mx-auto px-5 sm:px-8 py-14">
        <h2 className="font-display text-h1 font-semibold text-text-primary mb-2">MemVidX làm gì cho bạn</h2>
        <p className="text-body text-text-secondary mb-8 max-w-[560px]">Một chỗ để đọc, hỏi, tóm tắt và ghi nhớ tài liệu — luôn bám nguồn.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-x-6 gap-y-10">
          {SOLUTIONS.map((s) => (
            <div key={s.title} className="p-1">
              <Icon name={s.icon} size={20} className="text-forest mb-3" />
              <div className="font-display font-semibold text-body-lg text-text-primary mb-1">{s.title}</div>
              <div className="text-small text-text-secondary leading-relaxed">{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── WORKFLOW (a real 4-step sequence → numbering earns its place) ── */}
      <section id="quytrinh" className="border-t border-border" style={{ background: "var(--bg-sidebar)" }}>
        <div className="max-w-[1080px] mx-auto px-5 sm:px-8 py-14">
          <h2 className="font-display text-h1 font-semibold text-text-primary mb-8">Bốn bước, từ tài liệu tới hiểu bài</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {WORKFLOW.map((w) => (
              <div key={w.n} className="relative">
                <div className="font-mono text-h3 text-bronze mb-2 tabular-nums">{w.n}</div>
                <div className="font-display text-title text-text-primary mb-1.5">{w.title}</div>
                <div className="text-small text-text-secondary leading-relaxed">{w.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURE LIST ── Sprint J (Hallmark C2): was a 3-col grid of
          colored-icon-square cards — Hallmark's own named "3-column feature
          grid" / "icon-tile feature card" tells, verbatim. Dropped the
          colored icon box and the per-item card border; icon sits inline
          beside the heading, rows separated by a hairline (not four sides),
          2 columns instead of 3 so it doesn't repeat the SOLUTION grid's
          shape a second time on the same page. */}
      <section id="tinhnang" className="max-w-[1080px] mx-auto px-5 sm:px-8 py-14">
        <h2 className="font-display text-h1 font-semibold text-text-primary mb-8">Tính năng chính</h2>
        <div className="grid sm:grid-cols-2 gap-x-10">
          {FEATURES.map((f, i) => (
            <div key={f.title}
              className={`flex items-start gap-3 py-4 ${i < FEATURES.length - 2 ? "border-b border-border" : ""}`}>
              <Icon name={f.icon} size={18} className="text-forest mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-display font-semibold text-body-lg text-text-primary mb-1">{f.title}</div>
                <div className="text-small text-text-secondary leading-relaxed">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── DEMO PREVIEW (static) ── */}
      <section id="demo" className="border-t border-border" style={{ background: "var(--bg-sidebar)" }}>
        <div className="max-w-[760px] mx-auto px-5 sm:px-8 py-14">
          <h2 className="font-display text-h1 font-semibold text-text-primary mb-2 text-center">Hỏi nối tiếp, không mất mạch</h2>
          <p className="text-body text-text-secondary mb-8 text-center">Ví dụ một đoạn hội thoại — câu sau hiểu được nhờ ngữ cảnh câu trước.</p>
          <div className="surface-card !p-6 flex flex-col gap-4">
            <ChatBubble role="user">nội dung file là gì?</ChatBubble>
            <ChatBubble role="ai">
              File giới thiệu <strong>Bình lọc nước Hải Đăng 3000</strong> — thiết bị xử lý nước nhiễm phèn, nhiễm mặn cho vùng đồng bằng.<span className="cite-chip">1</span>
            </ChatBubble>
            <ChatBubble role="user">nó giải quyết vấn đề gì?</ChatBubble>
            <ChatBubble role="ai">
              Bình lọc Hải Đăng 3000 giải quyết nước <strong>nhiễm phèn và nhiễm mặn</strong> ở đồng bằng sông Cửu Long.<span className="cite-chip">2</span>
            </ChatBubble>
            <div className="pt-2 mt-1 border-t border-border flex items-center gap-2 text-small text-text-muted">
              <Icon name="MessagesSquare" size={13} className="text-forest" />
              Hiểu “nó” nhờ ngữ cảnh hội thoại — không cần nhắc lại tên tài liệu.
            </div>
          </div>
        </div>
      </section>

      {/* ── TRUST / TECH (honest) ── */}
      <section className="max-w-[1080px] mx-auto px-5 sm:px-8 py-14">
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { icon: "Quote", t: "Bám nguồn đã chọn", d: "Câu trả lời dựa trên tài liệu bạn chọn, có trích dẫn." },
            { icon: "Eraser", t: "Xóa ngữ cảnh bất cứ lúc nào", d: "Bắt đầu chủ đề mới mà không lẫn hội thoại cũ." },
            { icon: "Zap", t: "Job nền không chặn chat", d: "Tóm tắt / mindmap chạy nền, bạn vẫn hỏi tiếp được." },
          ].map((x) => (
            <div key={x.t} className="flex gap-3">
              <div className="w-9 h-9 rounded-[7px] inline-flex items-center justify-center flex-shrink-0"
                style={{ background: "color-mix(in srgb, var(--ok) 12%, transparent)" }}>
                <Icon name={x.icon} size={16} style={{ color: "var(--ok)" }} />
              </div>
              <div>
                <div className="font-display font-semibold text-body-lg text-text-primary mb-0.5">{x.t}</div>
                <div className="text-small text-text-secondary leading-relaxed">{x.d}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="border-t border-border">
        <div className="max-w-[1080px] mx-auto px-5 sm:px-8 py-16 text-center">
          <h2 className="font-display text-[26px] sm:text-[32px] font-semibold text-text-primary mb-4">Bắt đầu học với tài liệu của bạn</h2>
          <div className="flex flex-wrap gap-3 justify-center">
            {user ? (
              <Link to="/app" className="btn-seal inline-flex items-center gap-2">Vào workspace <Icon name="ArrowRight" size={16} /></Link>
            ) : (
              <>
                <Link to="/register" className="btn-seal inline-flex items-center gap-2">Bắt đầu miễn phí <Icon name="ArrowRight" size={16} /></Link>
                <Link to="/login" className="btn-secondary">Đăng nhập</Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-border" style={{ background: "var(--bg-sidebar)" }}>
        <div className="max-w-[1080px] mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="font-display font-semibold text-body-lg text-text-primary">MemVid<span className="text-seal">X</span></div>
          <div className="text-small text-text-muted font-mono">Đọc · Truy hồi · Dẫn chứng</div>
        </div>
      </footer>
    </div>
  );
}
