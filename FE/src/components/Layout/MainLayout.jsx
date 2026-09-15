import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import SidebarLeft from "./SidebarLeft";
import SidebarRight from "./SidebarRight";
import WorkspaceContainer from "./WorkspaceContainer";
import KnowledgeInspector from "../mindmap/KnowledgeInspector";
import ResearchTimeline from "../study/ResearchTimeline";
import { useMindMapController } from "../../hooks/useMindMapController";
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
import { openCommandPalette } from "../../utils/commandPaletteBus";
import { useTutorMemory } from "../../study/useTutorMemory";
import { globalShortcutAction, mindmapRelationAction } from "../../utils/keyboardShortcuts";
import { OPEN_SHORTCUTS_EVENT } from "../../utils/shortcutsBus";
import ShortcutsOverlay from "../shortcuts/ShortcutsOverlay";

export default function MainLayout({
  selectedSources, setSelectedSources, initialAskAbout = null,
  // Feature Pack B (Cross Navigation) — read once as the INITIAL value only,
  // same contract as `initialAskAbout` above (Workspace.jsx already documents
  // why: "sau đó [state] làm chủ y như cũ", so a later click is never
  // fought by a stale URL). A page that lands with `tab=mindmap` but no
  // mindmap data loaded yet shows the same brief blank pane a fresh page
  // load already can (WorkspaceContainer only mounts the MindMap pane once
  // `hasMindmap` is true) — a pre-existing rough edge, not a new one.
  initialWorkspaceMode = "chat", initialRightView = "evidence",
}) {
  const [sources, setSources] = useState([]);
  const [leftOpen, setLeftOpen] = useState(false);   // chỉ dùng ở chế độ ngăn kéo (<768px)
  const [rightOpen, setRightOpen] = useState(false);
  // Từ 768px trở lên hai cột nới được và thu về gáy sách được; trạng thái nhớ qua phiên.
  const panel = usePanelLayout();
  const { isDark, setLight, setDark } = useTheme();
  const { user, logout } = useAuth();
  const { selectedDocument, selectDocument } = useStudyContext();
  const tutorMemory = useTutorMemory();
  const navigate = useNavigate();

  // ── Workspace architecture (approved audit) ──────────────────────────────
  // Chat/MindMap/Summary now share this ONE central region — `workspaceMode`
  // is pure client state, no navigation. SidebarRight keeps 100% of its own
  // generation/polling logic (untouched) and just FORWARDS its computed data
  // here via `onMindmapDataChange`/`onSummaryDataChange` instead of portaling
  // a modal — see SidebarRight.jsx's two small forwarding effects.
  const [workspaceMode, setWorkspaceMode] = useState(initialWorkspaceMode);
  const [mindmapData, setMindmapData] = useState(null);   // { data, onRegenerate, regenerating } | null
  const [summaryData, setSummaryData] = useState(null);   // summary record | null
  // Auto-switch to a newly-populated tab ONCE (null → non-null), not on every
  // later update (Save/regenerate) — those must not yank the user off Chat.
  const hadMindmapRef = useRef(false);
  const hadSummaryRef = useRef(false);
  useEffect(() => {
    if (mindmapData && !hadMindmapRef.current) setWorkspaceMode("mindmap");
    hadMindmapRef.current = Boolean(mindmapData);
  }, [mindmapData]);
  useEffect(() => {
    if (summaryData && !hadSummaryRef.current) setWorkspaceMode("summary");
    hadSummaryRef.current = Boolean(summaryData);
  }, [summaryData]);
  const onSwitchToChat = useCallback(() => setWorkspaceMode("chat"), []);
  // Feature Pack B — the other direction of the same switch, for Chat's own
  // "Xem tóm tắt" button.
  const onSwitchToSummary = useCallback(() => setWorkspaceMode("summary"), []);

  // ONE controller, ONE Inspector, shared by MindElixirView (via WorkspaceContainer)
  // and the KnowledgeInspector rendered directly below — selection state
  // survives switching modes because it lives HERE, not inside MindElixirView.
  const mindMapController = useMindMapController(mindmapData?.data);
  // Feature Pack C (Keyboard-first Research Workspace) — the individual
  // callbacks below are each `useCallback`-stabilized INSIDE the hook, but
  // the object `useMindMapController` returns is a fresh literal every
  // render (pre-existing — see `onJumpToMindMapNode`'s own dependency on the
  // whole object just below). Destructuring the specific pieces this file's
  // new keyboard effects need keeps THOSE effects from re-subscribing on
  // every unrelated render, without touching the hook itself.
  const { goBack: mmGoBack, goForward: mmGoForward, jumpTo: mmJumpTo, selected: mmSelected, relations: mmRelations } = mindMapController;

  // Feature Pack A (Research Timeline) — "Jump" to a mindmap-node entry must
  // switch the pane INTO view before scrolling it: MindElixirView stays
  // permanently mounted once it's had data (WorkspaceContainer toggles CSS
  // `hidden`, never unmounts it — see that file's own comment), but a
  // `display:none` pane has no layout box, so `scrollIntoView` needs one
  // paint after becoming visible before it can compute anything real.
  const onJumpToMindMapNode = useCallback((id) => {
    setWorkspaceMode("mindmap");
    requestAnimationFrame(() => mindMapController.jumpTo(id));
  }, [mindMapController]);

  // Task 3 "Open source" (Knowledge Inspector) — reuses the EXISTING Study
  // Context selector, same call SummaryPane already makes; "closing" now
  // means switching the Workspace back to Chat, not dismissing a modal.
  const onInspectorOpenSource = useCallback((stem) => {
    if (!stem) return;
    selectDocument(stem, { source: "mindmap" });
    setWorkspaceMode("chat");
  }, [selectDocument]);
  const onInspectorAskAI = useCallback((text) => {
    mindmapData?.data?.onAskDirect?.(text);
  }, [mindmapData]);

  const inspectorProps = useMemo(() => ({
    node: mindMapController.selected, relations: mindMapController.relations, breadcrumb: mindMapController.breadcrumb,
    generating: Boolean(mindmapData?.data?.generating),
    documentTitle: mindmapData?.data?.title || "",
    sources: Array.isArray(mindmapData?.data?.sources) ? mindmapData.data.sources : [],
    onNavigate: mindMapController.jumpTo, onAskAI: onInspectorAskAI, onOpenSource: onInspectorOpenSource,
    nav: mindMapController.nav,
  }), [mindMapController, mindmapData, onInspectorAskAI, onInspectorOpenSource]);
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

  // Phase 4C, Step 6 — "một bộ phát duy nhất": Gia sư AI gửi câu hỏi thẳng vào
  // chat qua CHÍNH `setAskAboutDraft` ở trên, không bọc mẫu "Về đoạn này...",
  // giống hệt cách `initialAskAbout` (Câu hỏi gợi ý, Phase 4A.3) đã seed state
  // này. Không tạo state chat thứ hai.
  const askDirect = useCallback((text) => {
    const t = String(text || "").trim();
    if (!t) return;
    setAskAboutDraft({ text: t, nonce: Date.now() });
  }, []);

  // Gia sư AI + Lề bằng chứng dùng chung MỘT cột (hard constraint: không thêm
  // cột thứ ba) — `rightView` chọn tab nào đang hiện trong nó.
  const [rightView, setRightView] = useState(initialRightView);   // "evidence" | "tutor" | "timeline"
  // Lệnh một-lần (nonce) để "Xem sơ đồ"/"Xem tóm tắt" ở Tutor chuyển đúng tab
  // Artifacts trong SidebarRight — KHÔNG điều hướng, KHÔNG route mới (tutorActions.js
  // giải thích lý do: Workspace không có `document_id` để gọi `duongDi`).
  const [artifactRequest, setArtifactRequest] = useState(null);
  const openTutor = useCallback(() => {
    setRightView("tutor");
    if (panel.drawer) setRightOpen(true); else panel.setCollapsedFor("right", false);
  }, [panel]);
  const openArtifact = useCallback((tab) => {
    setRightView("evidence");
    setArtifactRequest({ tab, nonce: Date.now() });
    if (panel.drawer) setRightOpen(true); else panel.setCollapsedFor("right", false);
  }, [panel]);

  // Feature Pack B (Cross Navigation) — real dead end found: while on the
  // MindMap tab, the right column shows ONLY KnowledgeInspector (see the
  // `workspaceMode === "mindmap"` swap below); SidebarRight, and with it the
  // Research Timeline tab, is entirely unreachable. Everywhere else `rightView
  // = "timeline"` already works (SidebarRight is what's showing). This is the
  // ONE case that needs an actual overlay — a floating panel ON TOP of the
  // Inspector, not a replacement for it (Inspector must stay mounted/visible
  // underneath, not lose its own state).
  const [timelineOverlayOpen, setTimelineOverlayOpen] = useState(false);
  const openTimeline = useCallback(() => {
    if (workspaceMode === "mindmap") { setTimelineOverlayOpen(true); return; }
    setRightView("timeline");
    if (panel.drawer) setRightOpen(true); else panel.setCollapsedFor("right", false);
  }, [workspaceMode, panel]);
  useEffect(() => {
    if (!timelineOverlayOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setTimelineOverlayOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timelineOverlayOpen]);
  // Jumping to a question/evidence entry from the MindMap-mode overlay must
  // switch workspaceMode itself, or the jump has no visible effect (the
  // panel it lands in — Chat's composer, the Evidence tab — isn't the one on
  // screen). Closes the overlay too: once you've jumped away from MindMap,
  // there's nothing left for it to float over.
  const onOverlayJumpQuestion = useCallback((text) => {
    setWorkspaceMode("chat");
    askDirect(text);
    setTimelineOverlayOpen(false);
  }, [askDirect]);
  const onOverlayJumpEvidence = useCallback(({ stem, chunkId }) => {
    setWorkspaceMode("chat");
    setRightView("evidence");
    if (panel.drawer) setRightOpen(true); else panel.setCollapsedFor("right", false);
    onHighlight?.({ stem, chunkId });
    setTimelineOverlayOpen(false);
  }, [onHighlight, panel]);

  // Feature Pack D — Knowledge Dashboard entry point. Deliberately NOT given
  // the MindMap-mode floating-overlay treatment Timeline got in Feature Pack
  // B: on the MindMap tab this behaves the same way the pre-existing "Gia sư
  // AI" button already does (`openTutor`, above) — sets `rightView` without
  // checking `workspaceMode`, a real no-visible-effect no-op while
  // SidebarRight is swapped for KnowledgeInspector. That's an existing,
  // documented rough edge (see docs/FEATURE_PACK_D_REPORT.md), not a new one
  // this pack introduces or is scoped to fix.
  const openInsights = useCallback(() => {
    setRightView("insights");
    if (panel.drawer) setRightOpen(true); else panel.setCollapsedFor("right", false);
  }, [panel]);

  // Step 10 — Ctrl+/ (hoặc Cmd+/) mở Gia sư AI từ bất cứ đâu trong Workspace.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") { e.preventDefault(); openTutor(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openTutor]);

  // Feature Pack C (Keyboard-first Research Workspace) — "?" and the global
  // Alt+ workspace shortcuts (mục 3 + 7). ShortcutsOverlay's open state lives
  // HERE, same reasoning as `timelineOverlayOpen` above: it's the one place
  // already reachable both from the header AND from CommandPalette.jsx (a
  // sibling component mounted outside this tree — see shortcutsBus.js for
  // why that needs a DOM event instead of a prop).
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    const onExternalOpen = () => setShortcutsOpen(true);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onExternalOpen);
    return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, onExternalOpen);
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      const action = globalShortcutAction(e, { activeElement: document.activeElement });
      if (!action) return;
      // Global shortcuts must not reach THROUGH an open modal (ShortcutsOverlay
      // itself, Command Palette, the Summary modal, the MindMap-mode Timeline
      // overlay's `.me-container`-adjacent siblings...) — same selector
      // MainLayout's own right-drawer Escape effect already guards with below.
      // "help" is the ONE exception: it must still be able to TOGGLE its own
      // overlay closed while that overlay is the thing open, same self-toggle
      // exception CommandPalette's own Ctrl+K already has for its own modal.
      if (action !== "help" && document.querySelector('[aria-modal="true"], .me-container')) return;
      e.preventDefault();
      switch (action) {
        case "help": return setShortcutsOpen((v) => !v);
        case "nav-chat": return onSwitchToChat();
        // Alt+M mirrors WorkspaceTabs.jsx's own gate exactly (`enabled.mindmap
        // = hasMindmap`) — a keyboard shortcut for a disabled tab must stay a
        // no-op, not switch into an empty pane the click path itself refuses.
        case "nav-mindmap": return mindmapData?.data && setWorkspaceMode("mindmap");
        // Alt+S mirrors the EXISTING header "StudyMap" <Link to="/app/study">
        // above — same destination, no new route invented.
        case "nav-studymap": return navigate("/app/study");
        case "nav-timeline": return openTimeline();
        case "history-back": return mmGoBack();
        case "history-forward": return mmGoForward();
        default: return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSwitchToChat, mindmapData, navigate, openTimeline, mmGoBack, mmGoForward]);

  // Feature Pack C — MindMap relation navigation (mục 4 + 5): center / parent /
  // child / sibling, bare c/u/d/[/]. Scoped to `workspaceMode === "mindmap"`
  // only, and skipped entirely while the mind-elixir canvas itself has focus
  // (`.me-container` — see keyboardShortcuts.js's `mindmapRelationAction` doc
  // comment for why: that canvas is `editable: true` and binds its OWN
  // Arrow/Enter/Tab/Delete keymap directly on the container; this effect
  // never claims any key mind-elixir's table already uses, so the two never
  // fight over the same press). `jumpTo` already both selects AND centers
  // (mind.selectNode + scrollIntoView, see useMindMapController.js), so
  // "center" and every relation jump share the one existing primitive.
  useEffect(() => {
    if (workspaceMode !== "mindmap") return;
    const onKey = (e) => {
      if (document.activeElement?.closest?.(".me-container")) return;
      // Same open-modal guard as the global effect above — belt-and-suspenders
      // alongside `mindmapRelationAction`'s own interactive-target check
      // (ShortcutsOverlay's close button already blocks it that way, since
      // Modal.jsx focuses that button on open; this also covers a modal open
      // while focus happens to sit on non-interactive text inside it).
      if (document.querySelector('[aria-modal="true"]')) return;
      const action = mindmapRelationAction(e, { activeElement: document.activeElement });
      if (!action || !mmSelected?.id) return;
      e.preventDefault();
      switch (action) {
        case "center": return mmJumpTo(mmSelected.id);
        case "parent": return mmRelations.parent && mmJumpTo(mmRelations.parent.id);
        case "child": return mmRelations.children[0] && mmJumpTo(mmRelations.children[0].id);
        case "prev-sibling": return mmRelations.prev && mmJumpTo(mmRelations.prev.id);
        case "next-sibling": return mmRelations.next && mmJumpTo(mmRelations.next.id);
        default: return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [workspaceMode, mmSelected, mmRelations, mmJumpTo]);

  // Step 10 — Escape đóng ngăn kéo lề phải (khổ hẹp). Bỏ qua khi một overlay
  // khác đang mở (modal tóm tắt/sơ đồ — `[aria-modal]`/`.me-container`) để
  // không tranh phím Escape với overlay đó, giống guard đã có ở
  // `chatFocus.js::shouldFocusOnSlash`.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || !panel.drawer || !rightOpen) return;
      if (document.querySelector('[aria-modal="true"], .me-container')) return;
      setRightOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel.drawer, rightOpen]);

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

        {/* Wordmark — a stamped seal + serif name. This IS the seal-stamp
            signature itself (Signature Contract §7) — stays --seal even
            after --accent flips to forest; every other component only
            REFERENCES this motif, never duplicates its exact treatment. */}
        <div className="flex items-center gap-2.5 flex-shrink-0 select-none">
          <span
            className="w-[30px] h-[30px] rounded-[6px] inline-flex items-center justify-center font-display text-body-lg font-semibold flex-shrink-0"
            style={{ color: "var(--seal)", border: "1.5px solid var(--seal)", transform: "rotate(-4deg)" }}
            aria-hidden
          >
            M
          </span>
          <span className="font-display font-semibold text-title tracking-tight text-text-primary hidden sm:block">
            MemVid<span className="text-seal">X</span>
          </span>
        </div>

        {/* Center eyebrow — the thesis, not a dead search box. Phase 4B #8: khi
            Study Context có tài liệu đang chọn (tới đây qua moBeMat), thay eyebrow
            tĩnh bằng chặng đường thật Document > Bề mặt > Chủ đề > Câu hỏi > Chat —
            KHÔNG suy từ URL, chỉ đọc context. Chưa có lựa chọn thì giữ eyebrow cũ. */}
        <div className="flex-1 flex justify-center px-2 min-w-0">
          {selectedDocument ? (
            // Final QA: was `md:flex` (768px) — at that width this row also has
            // the StudyMap/search/tutor buttons appearing (all `hidden md:*`
            // too), so the breadcrumb gets squeezed into near-zero space and
            // truncates to one letter. `lg` (1024px) gives it room.
            <StudyBreadcrumb showChat className="hidden lg:flex" />
          ) : (
            <span className="hidden lg:block text-metadata uppercase text-text-muted font-mono truncate">
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
            title="Quiz chẩn đoán, ôn tập theo lỗ hổng (Alt+S)"
          >
            <Icon name="ScrollText" size={14} />
            <span className="hidden sm:inline">StudyMap</span>
          </Link>

          {/* Mobile: search has no keyboard shortcut to fall back on — needs its own icon button. */}
          <button onClick={openCommandPalette} className="md:hidden icon-btn w-9 h-9" aria-label="Tìm kiếm">
            <Icon name="Search" size={18} />
          </button>
          {/* Mobile: open right column (whichever tab — Bằng chứng/Gia sư AI — was last open) */}
          <button onClick={() => setRightOpen(true)} className="md:hidden icon-btn w-9 h-9"
                  aria-label={rightView === "tutor" ? "Mở Gia sư AI" : "Mở lề bằng chứng"}>
            <Icon name={rightView === "tutor" ? "Sparkles" : "PanelRight"} size={18} />
          </button>
          {/* UI/UX Polish Issue 2 — search's discoverable HOME is the Study
              Workspace now, not buried in Library. Same global CommandPalette
              as Ctrl+K (Issue 2 doesn't ask for a second search engine, just
              a visible entry point reachable from here). */}
          <button onClick={openCommandPalette} className="hidden md:inline-flex pill-action !text-small"
                  title="Tìm kiếm (Ctrl+K)">
            <Icon name="Search" size={14} /> Tìm kiếm
          </button>
          {/* Gia sư AI — luôn có mặt (ẩn trên mobile để tránh chật hàng nút; Ctrl+/ vẫn mở được). */}
          <button onClick={openTutor} className="hidden md:inline-flex pill-action !text-small"
                  title="Gia sư AI (Ctrl+/)">
            <Icon name="Sparkles" size={14} /> Gia sư AI
          </button>
          {/* Feature Pack B — luôn có mặt, kể cả khi đang ở sơ đồ tư duy (nơi
              cột phải bị Trình khám phá tri thức chiếm, xem openTimeline). */}
          <button onClick={openTimeline} className="hidden md:inline-flex pill-action !text-small"
                  title="Dòng thời gian nghiên cứu (Alt+T)">
            <Icon name="Clock" size={14} /> Dòng thời gian
          </button>
          {/* Feature Pack D — Knowledge Dashboard. */}
          <button onClick={openInsights} className="hidden md:inline-flex pill-action !text-small"
                  title="Kiến thức của bạn">
            <Icon name="Network" size={14} /> Kiến thức
          </button>
          {/* Feature Pack C — Discoverability (mục 7). */}
          <button onClick={() => setShortcutsOpen(true)} className="hidden md:inline-flex icon-btn w-9 h-9"
                  title="Phím tắt (?)" aria-label="Xem phím tắt">
            <Icon name="Keyboard" size={16} />
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
                     transition-transform duration-200 ease-in-out
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

        {/* ── TRANG GIỮA — Workspace: Chat ⇄ MindMap ⇄ Summary ── */}
        <main className="flex flex-1 flex-col min-w-0 min-h-0">
          <WorkspaceContainer
            mode={workspaceMode}
            onModeChange={setWorkspaceMode}
            chatProps={{
              selectedSources, sources, onEvidence: setEvidence, highlight, onHighlight,
              onOpenLeft: () => (panel.drawer ? setLeftOpen(true) : panel.setCollapsedFor("left", false)),
              askAboutDraft,
              hasSummary: Boolean(summaryData), onOpenSummary: onSwitchToSummary,
            }}
            mindmapData={mindmapData}
            summaryData={summaryData}
            controller={mindMapController}
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
                  // Gia sư AI trên mobile là bottom sheet (đúng yêu cầu Step 1),
                  // Bằng chứng vẫn là ngăn kéo trượt từ cạnh phải như cũ — cùng
                  // `rightOpen`/nền mờ, chỉ đổi hướng trượt theo `rightView`.
                  ? rightView === "tutor"
                    ? `fixed inset-x-0 bottom-0 max-h-[80vh] z-40 shrink-0
                       bg-surface-sidebar border-t border-border rounded-t-[14px]
                       transition-transform duration-200 ease-in-out
                       ${rightOpen ? "translate-y-0" : "translate-y-full"}`
                    : `fixed top-[58px] right-0 h-[calc(100vh-58px)] z-40 w-[326px] shrink-0
                       bg-surface-sidebar border-l border-border
                       transition-transform duration-200 ease-in-out
                       ${rightOpen ? "translate-x-0" : "translate-x-full"}`
                  : "shrink-0 bg-surface-sidebar overflow-hidden"
              }
              style={panel.drawer ? undefined : { width: panel.width.right }}
            >
              {/* Workspace architecture — exactly ONE Inspector, ONE SidebarRight,
                  both ALWAYS mounted (CSS `hidden`, never conditional JSX) so
                  neither remounts when `workspaceMode` changes. MindMap mode shows
                  the Inspector; Chat/Summary keep SidebarRight's evidence/tutor
                  tabs (unrelated to node selection, unaffected by this refactor). */}
              <div className={workspaceMode === "mindmap" ? "h-full" : "hidden h-full"}>
                <KnowledgeInspector {...inspectorProps} />
                {/* Feature Pack B — floating OVER the Inspector, not replacing
                    it (Inspector stays mounted/visible underneath, keeps its
                    own scroll/selection). Fixed-position slide-in, same shape
                    as the mobile right-drawer elsewhere in this file, just
                    available regardless of viewport width because this is
                    the one case with no other way to reach the Timeline. */}
                {timelineOverlayOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40 bg-black/20"
                      onClick={() => setTimelineOverlayOpen(false)}
                      aria-hidden="true"
                    />
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-label="Dòng thời gian nghiên cứu"
                      className="fixed top-[58px] right-0 h-[calc(100vh-58px)] z-50 w-[326px] max-w-[90vw]
                                 bg-surface-sidebar border-l border-border shadow-card-hover
                                 flex flex-col"
                    >
                      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
                        <span className="text-caption text-text-muted">
                          Nổi trên Trình khám phá tri thức
                        </span>
                        <button type="button" onClick={() => setTimelineOverlayOpen(false)}
                                className="icon-btn w-7 h-7" autoFocus
                                aria-label="Đóng dòng thời gian" title="Đóng (Esc)">
                          <Icon name="X" size={14} />
                        </button>
                      </div>
                      <div className="flex-1 min-h-0">
                        <ResearchTimeline
                          mindMapController={mindMapController}
                          onJumpQuestion={onOverlayJumpQuestion}
                          onJumpNode={onJumpToMindMapNode}
                          onJumpEvidence={onOverlayJumpEvidence}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className={workspaceMode === "mindmap" ? "hidden h-full" : "h-full"}>
                <SidebarRight
                  selectedSources={selectedSources}
                  evidence={evidence}
                  highlight={highlight}
                  onHighlight={onHighlight}
                  onClose={() => (panel.drawer ? setRightOpen(false) : panel.setCollapsedFor("right", true))}
                  onAskAbout={onAskAbout}
                  collapsible={!panel.drawer}
                  rightView={rightView}
                  onRightViewChange={setRightView}
                  artifactRequest={artifactRequest}
                  askDirect={askDirect}
                  openArtifact={openArtifact}
                  tutorMemory={tutorMemory}
                  onMindmapDataChange={setMindmapData}
                  onSummaryDataChange={setSummaryData}
                  onSwitchToChat={onSwitchToChat}
                  mindMapController={mindMapController}
                  onJumpToMindMapNode={onJumpToMindMapNode}
                />
              </div>
            </aside>
          </>
        )}
      </div>

      {/* ── TOAST STACK ── */}
      <Toaster />

      {/* Feature Pack C — Discoverability (mục 7): "?" hoặc lệnh "Phím tắt"
          trong Command Palette đều mở đúng overlay này. */}
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
