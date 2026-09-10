import { useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import SidebarLeft from "./SidebarLeft";
import ChatArea from "./ChatArea";
import SidebarRight from "./SidebarRight";
import PanelSpine from "./PanelSpine";
import PanelDivider from "./PanelDivider";
import { usePanelLayout } from "../../hooks/usePanelLayout";
import { PANELS } from "../../hooks/panelLayout";
import { useTheme } from "../../hooks/useTheme";
import { useAuth } from "../../auth/useAuth";
import { Icon } from "../ui/Icon";
import Toaster from "../ui/Toaster";
import AccountMenu from "./AccountMenu";
import StudyBreadcrumb from "../study/StudyBreadcrumb";
import { useStudyContext } from "../../study/useStudyContext";

export default function MainLayout({ selectedSources, setSelectedSources, initialAskAbout = null }) {
  const [sources, setSources] = useState([]);
  const [leftOpen, setLeftOpen] = useState(false);   // chỉ dùng ở chế độ ngăn kéo (<768px)
  const [rightOpen, setRightOpen] = useState(false);
  // Từ 768px trở lên hai cột nới được và thu về gáy sách được; trạng thái nhớ qua phiên.
  const panel = usePanelLayout();
  const { isDark, setLight, setDark } = useTheme();
  const { user, logout } = useAuth();
  const { selectedDocument } = useStudyContext();
  const navigate = useNavigate();
  // Đăng xuất thường giữ NGUYÊN hành vi cũ: về trang chủ, không thông báo gì.
  // Chỉ ca đăng xuất-vì-vừa-đổi-mật-khẩu mới đi tới `/login` kèm một MÃ thông báo —
  // người dùng cần thấy xác nhận rằng mật khẩu đã đổi, và cần đăng nhập lại ngay ở
  // đúng chỗ để làm việc đó.
  const handleLogout = async (tuyChon) => {
    await logout();
    const ma = tuyChon?.lyDo;
    if (ma) navigate(`/login?tb=${encodeURIComponent(ma)}`, { replace: true });
    else navigate("/");
  };

  // ── Signature state: evidence margin ⇄ citation chips ──
  // `evidence` = provenance of the latest answer ({ sources, chunks }).
  // `highlight` = the citation a user is pointing at, shared so a chip in the
  // answer and its source frame light up together (either direction).
  const [evidence, setEvidence] = useState(null);
  const [highlight, setHighlight] = useState(null); // { stem, chunkId } | null
  const onHighlight = useCallback((c) => setHighlight(c), []);

  // Task 16 — "Hỏi về đoạn này" (EvidenceDrawer, inside the mindmap overlay)
  // prefills + focuses the chat composer with the evidence snippet. `nonce`
  // forces ChatArea's effect to re-fire even if the same snippet is asked
  // about twice in a row (object identity, not just text, changes).
  //
  // Phase 4A.3: một Câu hỏi gợi ý bấm từ Thư viện học tập tới thẳng đây qua
  // `initialAskAbout` (Workspace.jsx đọc `?prompt=`) — dùng NGUYÊN VĂN câu hỏi đã
  // sinh sẵn từ Question Engine, KHÔNG bọc qua mẫu "Về đoạn này..." của
  // `onAskAbout` bên dưới (mẫu đó chỉ đúng cho một ĐOẠN trích dẫn, không đúng cho
  // một câu hỏi đã hoàn chỉnh).
  const [askAboutDraft, setAskAboutDraft] = useState(initialAskAbout); // { text, nonce } | null
  const onAskAbout = useCallback((snippet) => {
    const text = String(snippet || "").trim();
    if (!text) return;
    setAskAboutDraft({ text: `Về đoạn này: "${text}" — hãy giải thích thêm.`, nonce: Date.now() });
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden font-body transition-theme" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>

      {/* ── TOP HEADER ── */}
      <header
        className="flex items-center gap-4 px-4 sm:px-5 h-[58px] border-b border-border flex-shrink-0 transition-theme"
        style={{ background: "var(--bg-sidebar)" }}
      >
        {/* Mobile: open source library */}
        <button onClick={() => setLeftOpen(true)} className="md:hidden icon-btn w-9 h-9" aria-label="Mở thư mục nguồn">
          <Icon name="Menu" size={18} />
        </button>

        {/* Wordmark — a stamped seal + serif name */}
        <div className="flex items-center gap-2.5 flex-shrink-0 select-none">
          <span
            className="w-[30px] h-[30px] rounded-[6px] inline-flex items-center justify-center font-display text-[16px] font-semibold flex-shrink-0"
            style={{ color: "var(--accent)", border: "1.5px solid var(--accent)", transform: "rotate(-4deg)" }}
            aria-hidden
          >
            M
          </span>
          <span className="font-display font-semibold text-[17px] tracking-tight text-text-primary hidden sm:block">
            MemVid<span className="text-brand">X</span>
          </span>
        </div>

        {/* Center eyebrow — the thesis, not a dead search box. Phase 4B #8: khi
            Study Context có tài liệu đang chọn (tới đây qua moBeMat), thay eyebrow
            tĩnh bằng chặng đường thật Document > Bề mặt > Chủ đề > Câu hỏi > Chat —
            KHÔNG suy từ URL, chỉ đọc context. Chưa có lựa chọn thì giữ eyebrow cũ. */}
        <div className="flex-1 flex justify-center px-2 min-w-0">
          {selectedDocument ? (
            <StudyBreadcrumb showChat className="hidden md:flex" />
          ) : (
            <span className="hidden md:block text-[12px] tracking-[0.14em] uppercase text-text-muted font-mono truncate">
              Đọc · Truy hồi · Dẫn chứng
            </span>
          )}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Sang gian StudyMap — cùng toà nhà, khác việc: đọc ở đây, kiểm tra ở kia. */}
          <Link
            to="/app/study"
            className="pill-action"
            title="Quiz chẩn đoán, ôn tập theo lỗ hổng"
          >
            <Icon name="ScrollText" size={14} />
            <span className="hidden sm:inline">StudyMap</span>
          </Link>

          {/* Mobile: open evidence margin */}
          <button onClick={() => setRightOpen(true)} className="md:hidden icon-btn w-9 h-9" aria-label="Mở lề bằng chứng">
            <Icon name="PanelRight" size={18} />
          </button>
          {/* Theme toggle */}
          <div className="hidden sm:flex theme-toggle" role="group" aria-label="Chế độ sáng/tối">
            <button onClick={setLight} title="Nền sáng" aria-pressed={!isDark} className={`theme-toggle-btn ${!isDark ? "theme-toggle-btn-active" : ""}`} aria-label="Nền sáng">
              <Icon name="Sun" size={15} />
            </button>
            <button onClick={setDark} title="Nền tối" aria-pressed={isDark} className={`theme-toggle-btn ${isDark ? "theme-toggle-btn-active" : ""}`} aria-label="Nền tối">
              <Icon name="Moon" size={15} />
            </button>
          </div>

          {/* Account: ảnh + tên + menu (hồ sơ · đổi mật khẩu · đăng xuất) */}
          {user && <AccountMenu user={user} onLogout={handleLogout} />}
        </div>
      </header>

      {/* ── BODY — kệ trái · trang giữa · lề phải ──
          Dưới 768px: hai cột thành ngăn kéo phủ lên nội dung (như cũ).
          Từ 768px: nới được bằng cách kéo, thu về gáy sách được, nhớ qua phiên. */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Nền mờ của ngăn kéo — chỉ tồn tại ở khổ hẹp */}
        {panel.drawer && (leftOpen || rightOpen) && (
          <div
            className="fixed inset-0 bg-black/40 z-30 backdrop-blur-sm"
            onClick={() => { setLeftOpen(false); setRightOpen(false); }}
          />
        )}

        {/* ── KỆ TRÁI — Thư mục nguồn ── */}
        {!panel.drawer && panel.collapsed.left ? (
          <PanelSpine
            side="left"
            label={PANELS.left.label}
            count={sources.length}
            onExpand={() => panel.setCollapsedFor("left", false)}
          />
        ) : (
          <>
            <aside
              className={
                panel.drawer
                  ? `fixed top-[58px] left-0 h-[calc(100vh-58px)] z-40 w-[252px] shrink-0
                     bg-surface-sidebar border-r border-border
                     transition-transform duration-300 ease-in-out
                     ${leftOpen ? "translate-x-0" : "-translate-x-full"}`
                  // Không kẻ border ở đây: PanelDivider bên cạnh CHÍNH LÀ đường kẻ.
                  // Giữ cả hai sẽ thành đường đôi 2px.
                  : "shrink-0 bg-surface-sidebar overflow-hidden"
              }
              style={panel.drawer ? undefined : { width: panel.width.left }}
            >
              <SidebarLeft
                selectedSources={selectedSources}
                setSelectedSources={setSelectedSources}
                onSourcesChange={setSources}
                onClose={() => (panel.drawer ? setLeftOpen(false) : panel.setCollapsedFor("left", true))}
                collapsible={!panel.drawer}
              />
            </aside>
            {!panel.drawer && (
              <PanelDivider
                side="left"
                label={PANELS.left.label}
                width={panel.width.left}
                min={PANELS.left.min}
                max={PANELS.left.max}
                active={panel.dragging === "left"}
                onDrag={(e) => panel.startDrag("left", e)}
                onNudge={(d) => panel.nudgeWidth("left", d)}
                onReset={() => panel.resetWidth("left")}
              />
            )}
          </>
        )}

        {/* ── TRANG GIỮA — Phiên đọc ── */}
        <main className="flex flex-1 flex-col min-w-0 min-h-0">
          <ChatArea
            selectedSources={selectedSources}
            sources={sources}
            onEvidence={setEvidence}
            highlight={highlight}
            onHighlight={onHighlight}
            onOpenLeft={() => (panel.drawer ? setLeftOpen(true) : panel.setCollapsedFor("left", false))}
            onOpenRight={() => (panel.drawer ? setRightOpen(true) : panel.setCollapsedFor("right", false))}
            askAboutDraft={askAboutDraft}
          />
        </main>

        {/* ── LỀ PHẢI — Bằng chứng và bản tạo ra ── */}
        {!panel.drawer && panel.collapsed.right ? (
          <PanelSpine
            side="right"
            label={PANELS.right.label}
            count={evidence?.sources?.length || 0}
            onExpand={() => panel.setCollapsedFor("right", false)}
          />
        ) : (
          <>
            {!panel.drawer && (
              <PanelDivider
                side="right"
                label={PANELS.right.label}
                width={panel.width.right}
                min={PANELS.right.min}
                max={PANELS.right.max}
                active={panel.dragging === "right"}
                onDrag={(e) => panel.startDrag("right", e)}
                onNudge={(d) => panel.nudgeWidth("right", d)}
                onReset={() => panel.resetWidth("right")}
              />
            )}
            <aside
              className={
                panel.drawer
                  ? `fixed top-[58px] right-0 h-[calc(100vh-58px)] z-40 w-[326px] shrink-0
                     bg-surface-sidebar border-l border-border
                     transition-transform duration-300 ease-in-out
                     ${rightOpen ? "translate-x-0" : "translate-x-full"}`
                  : "shrink-0 bg-surface-sidebar overflow-hidden"
              }
              style={panel.drawer ? undefined : { width: panel.width.right }}
            >
              <SidebarRight
                selectedSources={selectedSources}
                evidence={evidence}
                highlight={highlight}
                onHighlight={onHighlight}
                onClose={() => (panel.drawer ? setRightOpen(false) : panel.setCollapsedFor("right", true))}
                onAskAbout={onAskAbout}
                collapsible={!panel.drawer}
              />
            </aside>
          </>
        )}
      </div>

      {/* ── TOAST STACK ── */}
      <Toaster />
    </div>
  );
}
