import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import SidebarLeft from "./SidebarLeft";
import ContextInspector from "./ContextInspector";
import WorkspaceContainer from "./WorkspaceContainer";
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
import { useStudyContext } from "../../study/useStudyContext";
import { useTutorMemory } from "../../study/useTutorMemory";
import { globalShortcutAction, mindmapRelationAction, hasVisibleBlockingOverlay } from "../../utils/keyboardShortcuts";
import { OPEN_SHORTCUTS_EVENT } from "../../utils/shortcutsBus";
import ShortcutsOverlay from "../shortcuts/ShortcutsOverlay";
import StudyToolsMenu from "./StudyToolsMenu";
import { fetchMindmapNodeContext } from "../../utils/mindmapNodeContext";
import UsageChip from "./UsageChip";

// Round 11 (mockup parity, explicit user decision) — the Chat/Mind Map/
// Summary mode switch, moved here from the now-deleted LessonHeader.jsx
// (was its own `TABS` constant there). Same three entries, same order,
// same icons — this is a render-location move, not a redesign.
const MODE_TABS = [
  { key: "chat", label: "Trò chuyện", icon: "MessageSquareText" },
  { key: "mindmap", label: "Sơ đồ tư duy", icon: "Network" },
  { key: "summary", label: "Tóm tắt", icon: "ScrollText" },
];

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
  // `selectedDocument` (Study Context's single-document pointer) used to
  // feed the header's center eyebrow/breadcrumb and the LessonHeader title
  // — both removed in round 11 (the merged single-row header has no
  // eyebrow/title slot, matching the approved reference image). Only
  // `selectDocument` (the setter, used by the Mind Map jump-to-node flow
  // below) is still needed from this hook.
  const { selectDocument } = useStudyContext();
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
  const [summaryContext, setSummaryContext] = useState(null);
  // Auto-switch to a newly-populated tab ONCE (null → non-null), not on every
  // later update (Save/regenerate) — those must not yank the user off Chat.
  const hadMindmapRef = useRef(false);
  const hadSummaryRef = useRef(false);
  useEffect(() => {
    // __restoredOnLoad (SidebarRight's auto-select-most-recent-map-on-load
    // fix): a library restore on mount must not also yank a Chat-first user
    // into Mind Map mode, only a freshly-finished generation should.
    if (mindmapData && !hadMindmapRef.current && !mindmapData?.data?.__restoredOnLoad) {
      setWorkspaceMode("mindmap");
    }
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
  const openTimeline = useCallback(() => {
    setRightView("timeline");
    if (panel.drawer) setRightOpen(true); else panel.setCollapsedFor("right", false);
  }, [panel]);

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
  const [mindMapBackendContext, setMindMapBackendContext] = useState(null);
  useEffect(() => {
    const mapId = mindmapData?.data?.id;
    const nodeId = mmSelected?.id;
    if (!mapId || !nodeId) { setMindMapBackendContext(null); return undefined; }
    const controller = new AbortController();
    fetchMindmapNodeContext(mapId, nodeId, controller.signal)
      .then(setMindMapBackendContext)
      .catch((error) => { if (error.name !== "AbortError") setMindMapBackendContext(null); });
    return () => controller.abort();
  }, [mindmapData?.data?.id, mmSelected?.id]);
  const { drawer: panelDrawer, setCollapsedFor: setPanelCollapsed } = panel;

  // Node/citation triggers open the same inspector used by Chat and Summary.
  // The controller remains mounted, so opening this surface never touches the
  // Mind Elixir instance or its viewport transform.
  useEffect(() => {
    if (!mmSelected?.id) return;
    if (panelDrawer) setRightOpen(true);
    else setPanelCollapsed("right", false);
  }, [mmSelected?.id, panelDrawer, setPanelCollapsed]);

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
  const onInspectorAskAI = useCallback((request) => {
    const text = typeof request === "string" ? request : request?.text;
    if (!text) return;
    mindmapData?.data?.onAskDirect?.(text, {
      mapId: mindmapData?.data?.id,
      nodeId: request?.nodeId,
      citations: request?.citations || [],
    });
  }, [mindmapData]);

  const inspectorProps = useMemo(() => ({
    node: mindMapController.selected, relations: mindMapController.relations, breadcrumb: mindMapController.breadcrumb,
    generating: Boolean(mindmapData?.data?.generating),
    documentTitle: mindmapData?.data?.title || "",
    sources: Array.isArray(mindmapData?.data?.sources) ? mindmapData.data.sources : [],
    mapMeta: mindmapData?.data ? {
      sources: Array.isArray(mindmapData.data.sources) ? mindmapData.data.sources.length : 0,
      nodes: Array.isArray(mindmapData.data.nodes) ? mindmapData.data.nodes.length : 0,
      created: mindmapData.data.created_at ? new Date(mindmapData.data.created_at).toLocaleDateString() : "",
    } : null,
    backendContext: mindMapBackendContext,
    onNavigate: mindMapController.jumpTo, onAskAI: onInspectorAskAI, onOpenSource: onInspectorOpenSource,
    nav: mindMapController.nav,
  }), [mindMapController, mindmapData, mindMapBackendContext, onInspectorAskAI, onInspectorOpenSource]);
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
  const askDirect = useCallback((text, context = null) => {
    const t = String(text || "").trim();
    if (!t) return;
    setAskAboutDraft({ text: t, nonce: Date.now(), context });
  }, []);

  // Gia sư AI + Lề bằng chứng dùng chung MỘT cột (hard constraint: không thêm
  // cột thứ ba) — `rightView` chọn tab nào đang hiện trong nó.
  const [rightView, setRightView] = useState(initialRightView);   // "evidence" | "tutor" | "timeline"
  const [headerSurface, setHeaderSurface] = useState(null); // study-tools
  const [libraries, setLibraries] = useState({ mindMaps: [], summaries: [], mindMapActions: null, summaryActions: null });
  const updateMindmapLibrary = useCallback((value) => setLibraries((prev) => ({
    ...prev,
    mindMaps: value.mindMaps || [],
    mindMapActions: value.actions || null,
    mindMapInitialLoading: Boolean(value.initialLoading),
    mindMapLoadError: value.loadError || null,
  })), []);
  const updateSummaryLibrary = useCallback((value) => setLibraries((prev) => ({ ...prev, summaries: value.summaries || [], summaryActions: value.actions || null })), []);
  // Lệnh một-lần (nonce) để "Xem sơ đồ"/"Xem tóm tắt" ở Tutor chuyển đúng tab
  // Artifacts trong SidebarRight — KHÔNG điều hướng, KHÔNG route mới (tutorActions.js
  // giải thích lý do: Workspace không có `document_id` để gọi `duongDi`).
  const [artifactRequest, setArtifactRequest] = useState(null);
  const openTutor = useCallback(() => {
    setRightView("tutor");
    if (panel.drawer) setRightOpen(true); else panel.setCollapsedFor("right", false);
  }, [panel]);
  // Snapshot of the right panel before an artifact request takes it over, so
  // closing the Guided dialog can put back exactly what was there (node detail,
  // another Inspector tab, or a collapsed panel) instead of blanking it.
  const panelBeforeArtifactRef = useRef(null);
  const openArtifact = useCallback((tab) => {
    if (!panelBeforeArtifactRef.current) {
      panelBeforeArtifactRef.current = { rightOpen, rightView, collapsed: panel.collapsed.right };
    }
    setRightView("evidence");
    setArtifactRequest({ tab, nonce: Date.now() });
    setRightOpen(true);
    if (!panel.drawer) panel.setCollapsedFor("right", false);
  }, [panel, rightOpen, rightView]);

  const closeHeaderSurface = useCallback(() => setHeaderSurface(null), []);
  const openStudyTool = useCallback((view) => {
    setRightView(view);
    setHeaderSurface(null);
    setRightOpen(true);
  }, []);
  // Structural refactor (Learning Canvas lesson header + next-action strip) —
  // ONE real action per artifact type, shared by the header's mode-switch
  // tabs and ChatArea's next-action strip: switch to the pane if it
  // already has data (same as clicking a mode tab), otherwise
  // bounce to the Inspector's existing "Tạo sơ đồ"/"Tạo tóm tắt" generator
  // via the SAME openArtifact mechanism Tutor's "Xem sơ đồ"/"Xem tóm tắt"
  // links already use just above — no new generation logic, no mock.
  const onMindmapAction = useCallback(() => {
    if (mindmapData?.data) setWorkspaceMode("mindmap"); else openArtifact("mindmap");
  }, [mindmapData, openArtifact]);
  const onSummaryAction = useCallback(() => {
    if (summaryData) setWorkspaceMode("summary"); else openArtifact("summary");
  }, [summaryData, openArtifact]);

  // Feature Pack B (Cross Navigation) — real dead end found: while on the
  // MindMap tab WITH a map loaded, the right column shows ONLY
  // KnowledgeInspector (see the `workspaceMode === "mindmap" && hasMindmap`
  // swap below); SidebarRight, and with it the Research Timeline tab, is
  // unreachable. Everywhere else `rightView = "timeline"` already works
  // (SidebarRight is what's showing — including MindMap mode with NO map
  // yet, round 5: SidebarRight shows its own generator there, not
  // KnowledgeInspector). This is the ONE case that needs an actual overlay —
  // a floating panel ON TOP of the Inspector, not a replacement for it.
  // Jumping to a question/evidence entry from the MindMap-mode overlay must
  // switch workspaceMode itself, or the jump has no visible effect (the
  // panel it lands in — Chat's composer, the Evidence tab — isn't the one on
  // screen). Closes the overlay too: once you've jumped away from MindMap,
  // there's nothing left for it to float over.


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
      //
      // Round 9 fix: `.me-container` stays PERMANENTLY in the DOM once a Mind
      // Map has ever been shown (WorkspaceContainer keeps panes mounted, only
      // toggling the wrapper's `hidden` class, so ChatArea/mind-elixir never
      // remount on a mode switch) — a bare existence check therefore matched
      // it even while hidden, silently blocking every global shortcut
      // (Alt+C/M/S/T, history back/forward) forever after the first
      // generation. `hasVisibleBlockingOverlay` (keyboardShortcuts.js)
      // restricts the guard to an element that's actually on screen.
      const overlayCandidates = document.querySelectorAll('[aria-modal="true"], .me-container');
      if (action !== "help" && hasVisibleBlockingOverlay(overlayCandidates)) return;
      e.preventDefault();
      switch (action) {
        case "help": return setShortcutsOpen((v) => !v);
        case "nav-chat": return onSwitchToChat();
        // Alt+M mirrors the header's own mode tabs above (IA pass, round 5:
        // the Mind Map tab is now always enabled — see WorkspaceEmptyState
        // for what renders with no map yet, same as clicking the tab does).
        case "nav-mindmap": return setWorkspaceMode("mindmap");
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
  }, [onSwitchToChat, navigate, openTimeline, mmGoBack, mmGoForward]);

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

  const rightSurfaceVisible = true;
  // 2026-09-21: Mind Map's node-detail surface must be a closed-by-default
  // overlay that does not consume grid width (spec section 8) -- distinct
  // from Chat/Summary's persistent evidence rail, which stays as-is.
  // `mindmapToolOverlay`'s fixed/floating styling already existed below
  // (`.mindmap-tools-overlay`) but this flag was hardcoded `false`, so that
  // branch never actually rendered -- Mind Map mode fell through to the
  // same always-visible persistent-rail behavior as Chat/Summary, taking
  // real grid width and showing an empty state with nothing selected,
  // contradicting both the approved desktop mock and this section's
  // explicit "closed by default... must not consume grid width... overlay
  // the right edge" requirement. (main independently kept this flag wired
  // through its own JSX but left it hardcoded `false` -- turning it on here
  // is what this branch's whole redesign is built around.)
  const mindmapToolOverlay = workspaceMode === "mindmap" && !panel.drawer;

  // Auto-open the overlay exactly when there's a node to show evidence for
  // (contextual, per section 4's ownership table); auto-close when the
  // selection is cleared or the mode is switched away, so the panel never
  // shows stale content from a previous node or a previous map. Manual
  // close (the drawer's own X) always wins until the next selection.
  const mindmapSelectedNodeId = mindMapController.selected?.id ?? null;
  useEffect(() => {
    if (!mindmapToolOverlay) return;
    setRightOpen(Boolean(mindmapSelectedNodeId));
  }, [mindmapToolOverlay, mindmapSelectedNodeId]);

  // Explicit close of the Guided dialog (X / Escape). Restores the panel state
  // captured by openArtifact; a selected MindMap node keeps the overlay open so
  // node detail reappears underneath. A successful submit does not call this,
  // so generation progress stays visible.
  const restoreAfterGuidedClose = useCallback(() => {
    const saved = panelBeforeArtifactRef.current;
    panelBeforeArtifactRef.current = null;
    if (!saved) return;
    setRightView(saved.rightView);
    if (mindmapToolOverlay) {
      setRightOpen(saved.rightOpen || Boolean(mindmapSelectedNodeId));
    } else if (!panel.drawer) {
      panel.setCollapsedFor("right", saved.collapsed);
    } else {
      setRightOpen(saved.rightOpen);
    }
  }, [mindmapToolOverlay, mindmapSelectedNodeId, panel]);

  return (
    <div className="flex flex-col h-screen overflow-hidden font-body transition-theme" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>

      {/* ── TOP HEADER ── */}
      <header
        className="flex items-center gap-4 px-4 sm:px-5 h-[56px] border-b border-border flex-shrink-0 transition-theme"
        style={{ background: "var(--bg-sidebar)" }}
      >
        {/* Mobile: open source library */}
        <button onClick={() => setLeftOpen(true)} className="md:hidden icon-btn w-9 h-9" aria-label="Mở thư mục nguồn">
          <Icon name="Menu" size={18} />
        </button>

        {/* Wordmark — a stamped seal + serif name. This IS the seal-stamp
            signature itself (Signature Contract §7) — stays --seal
            regardless of what --accent's general action/selection color is
            (forest, then blue); every other component only REFERENCES this
            motif, never duplicates its exact treatment.
            Round 11 (mockup parity) — "StudyMap" moved here, right next to
            the wordmark, matching the approved reference image's brand
            cluster; it's still the SAME real `<Link to="/app/study">`
            (Alt+S, quiz/practice mode) that used to sit in the right-side
            icon cluster, just relocated — not duplicated there anymore. */}
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

        {/* Mode switch — Round 11 (mockup parity, explicit user decision):
            moved here from the now-deleted LessonHeader.jsx/WorkspaceContainer
            second row, merging the app's two persistent chrome rows (global
            header 56px + workspace toolbar 52px = 108px) into the ONE row
            the approved reference image shows. Same `workspaceMode`/
            `setWorkspaceMode` state this file already owned before this
            round (LessonHeader only ever received it as a prop) — no new
            state, no prop drilling added, just rendered one level up.
            Pill styling (filled accent when active) matches the reference
            image; icon-only below `sm` so it still fits the mobile header
            alongside the hamburger/account/search icons (mode-switching
            must stay reachable on mobile — see round 10's own checklist
            item on this). */}
        <nav role="tablist" aria-label="Chế độ Workspace"
          className="workspace-mode-switch relative flex items-center gap-1 p-1 rounded-full flex-shrink-0 mx-auto"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)" }}>
          {MODE_TABS.map((t) => {
            const active = workspaceMode === t.key;
            return (
              <button key={t.key} type="button" role="tab" aria-selected={active}
                onClick={() => { setWorkspaceMode(t.key); closeHeaderSurface(); }}
                title={t.label}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-small rounded-full transition-colors"
                style={{
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "#FFFFFF" : "var(--text-secondary)",
                  fontWeight: active ? 600 : 500,
                }}>
                <Icon name={t.icon} size={14} />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Mobile: search has no keyboard shortcut to fall back on — needs its own icon button. */}
          <div className="relative">
            <button type="button" className="study-tools-trigger"
              onClick={() => setHeaderSurface((current) => current === "study-tools" ? null : "study-tools")}
              aria-haspopup="menu" aria-expanded={headerSurface === "study-tools"}>
              <span>StudyMap</span><Icon name="ChevronDown" size={14} />
            </button>
            <StudyToolsMenu open={headerSurface === "study-tools"} onClose={closeHeaderSurface} onSelect={openStudyTool} />
          </div>
          {/* IA pass (round 5), nav-ownership: Inspector is the ONLY
              persistent owner of Evidence/AI Tutor/Timeline/Knowledge — the
              header's Feature-Pack-B/C/D icon buttons for Gia sư AI/Dòng
              thời gian/Kiến thức are REMOVED (they duplicated the Inspector's
              own `.inspector-tab` row, SidebarRight.jsx), not just demoted.
              This one button is the sole header-level "open the panel"
              affordance, generic rather than feature-specific — it opens
              whichever Inspector tab was last active (`rightView`), same as
              before, just relabeled since it's no longer one of several
              feature-specific buttons. On desktop the panel is already
              reachable via its own PanelSpine expand click when collapsed,
              so this stays mobile-only (a second desktop entry point would
              itself violate "one owner"). Hotkeys (Ctrl+/, Alt+T) still work
              — removing the visible button doesn't remove the shortcut. */}
          <button onClick={() => setRightOpen(true)} className="md:hidden icon-btn w-9 h-9"
                  aria-label="Mở công cụ">
            <Icon name="PanelRight" size={18} />
          </button>
          {/* UI/UX Polish Issue 2 — search's discoverable HOME is the Study
              Workspace now, not buried in Library. Same global CommandPalette
              as Ctrl+K (Issue 2 doesn't ask for a second search engine, just
              a visible entry point reachable from here). */}
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

          <UsageChip />

          {/* Account: ảnh + tên + menu (hồ sơ · đổi mật khẩu · đăng xuất) */}
          {user && <AccountMenu user={user} onLogout={handleLogout} />}
        </div>
      </header>

      {/* ── BODY — kệ trái · trang giữa · lề phải ──
          Dưới 768px: hai cột thành ngăn kéo phủ lên nội dung (như cũ).
          Từ 768px: nới được bằng cách kéo, thu về gáy sách được, nhớ qua phiên. */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Nền mờ của ngăn kéo — chỉ tồn tại ở khổ hẹp. The desktop Mind Map
            overlay drawer deliberately does NOT get a backdrop: it floats
            over the canvas edge while leaving the canvas itself interactive
            (pan/zoom/select another node) -- a full-screen dim would turn a
            lightweight contextual panel into an unwanted modal. */}
        {(panel.drawer && (leftOpen || rightOpen)) && (
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
                  ? `fixed top-[56px] left-0 h-[calc(100vh-56px)] z-40 w-[252px] shrink-0
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
                onTransientSurfaceOpen={closeHeaderSurface}
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
            onMindmapAction={onMindmapAction}
            onSummaryAction={onSummaryAction}
            chatProps={{
              selectedSources, sources, onEvidence: setEvidence, highlight, onHighlight,
              onOpenLeft: () => (panel.drawer ? setLeftOpen(true) : panel.setCollapsedFor("left", false)),
              isLeftVisible: !panel.drawer && !panel.collapsed.left,
              askAboutDraft,
              hasSummary: Boolean(summaryData), onOpenSummary: onSwitchToSummary,
            }}
            mindmapData={mindmapData}
            mindmapInitialLoading={libraries.mindMapInitialLoading}
            mindmapLoadError={libraries.mindMapLoadError}
            mindmapCreating={libraries.mindMapActions?.creating}
            mindmapJobLabel={libraries.mindMapActions?.jobLabel}
            mindmapJobProgress={libraries.mindMapActions?.jobProgress}
            mindmapJobError={libraries.mindMapActions?.jobError}
            onRetryMindmap={libraries.mindMapActions?.onRetry}
            summaryData={summaryData}
            onSummaryContextChange={setSummaryContext}
            controller={mindMapController}
          />
        </main>

        {/* ── LỀ PHẢI — Bằng chứng và bản tạo ra ──
            Two independent same-day fixes for the same underlying rule
            ("a component that owns background data/generation logic must
            stay mounted regardless of whether its own visual surface is
            shown"), reconciled here:
            2026-09-21 (this branch): the Mind Map overlay's first draft only
            rendered <ContextInspector> (SidebarRight -- owner of
            fetchMindMaps/fetchSummaries/generation-polling/the library's
            onSelect handling) when `rightOpen` was true. Since `rightOpen`
            starts false, SidebarRight never mounted in Mind Map mode until a
            node was selected -- and nothing could ever select a node,
            because the library's own map-select handler lives inside the
            very component that hadn't mounted. Confirmed live via a
            `git stash` A/B test. Fixed by keeping the overlay's <aside>
            always mounted, hiding it via opacity/visibility/pointer-events
            instead of conditional JSX.
            2026-09-24 (main, independently): the desktop collapsed-rail case
            had the identical bug for a different visual state -- on a fresh
            session the right panel starts collapsed, so the old
            `panel.collapsed.right ? <PanelSpine/> : <aside>...</aside>`
            ternary never mounted the aside at all, and the mind map/summary
            catalog stayed permanently empty. Confirmed live: zero network
            calls to /mindmaps until the panel was expanded once. Fixed the
            same way -- PanelSpine renders ALONGSIDE the aside (not instead
            of it), aside hidden via width:0 when collapsed.
            Combined: the aside is now unconditionally mounted whenever
            `rightSurfaceVisible`, for all three visual states (Mind Map
            overlay, collapsed rail, mobile drawer) -- only className/style
            vary per state, never JSX presence. */}
        {!rightSurfaceVisible ? null : (
          <>
            {!mindmapToolOverlay && !panel.drawer && panel.collapsed.right && (
              <PanelSpine
                side="right"
                label={PANELS.right.label}
                count={evidence?.sources?.length || 0}
                onExpand={() => panel.setCollapsedFor("right", false)}
              />
            )}
            {!panel.drawer && !panel.collapsed.right && !mindmapToolOverlay && (
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
              aria-hidden={
                (mindmapToolOverlay && !rightOpen)
                || (!mindmapToolOverlay && !panel.drawer && panel.collapsed.right)
                  ? true : undefined
              }
              className={
                mindmapToolOverlay
                  ? "mindmap-tools-overlay fixed top-[56px] right-3 bottom-3 z-40 w-[340px] bg-surface-sidebar border border-border rounded-[12px] shadow-card-hover overflow-hidden transition-opacity duration-150"
                  : panel.drawer
                  // Gia sư AI trên mobile là bottom sheet (đúng yêu cầu Step 1),
                  // Bằng chứng vẫn là ngăn kéo trượt từ cạnh phải như cũ — cùng
                  // `rightOpen`/nền mờ, chỉ đổi hướng trượt theo `rightView`.
                  ? `context-inspector-shell fixed inset-x-0 bottom-0 max-h-[82vh] z-40 shrink-0
                     bg-surface-sidebar border-t border-border rounded-t-[16px]
                     transition-transform duration-200 ease-in-out
                     ${rightOpen ? "translate-y-0" : "translate-y-full"}`
                  : "context-inspector-shell shrink-0 bg-surface-sidebar overflow-hidden"
              }
              style={
                mindmapToolOverlay
                  ? (rightOpen ? undefined : { opacity: 0, pointerEvents: "none", visibility: "hidden" })
                  : !panel.drawer
                  ? (panel.collapsed.right
                      ? { width: 0, minWidth: 0, padding: 0, border: "none", pointerEvents: "none" }
                      : { width: panel.width.right })
                  : undefined
              }
            >
              <div className="h-full">
                <ContextInspector
                  mode={workspaceMode}
                  selectedSources={selectedSources}
                  evidence={evidence}
                  highlight={highlight}
                  onHighlight={onHighlight}
                  onClose={() => ((panel.drawer || mindmapToolOverlay) ? setRightOpen(false) : panel.setCollapsedFor("right", true))}
                  onGuidedClose={restoreAfterGuidedClose}
                  onAskAbout={onAskAbout}
                  onOpenSource={onInspectorOpenSource}
                  collapsible={!panel.drawer && !mindmapToolOverlay}
                  rightView={rightView}
                  onRightViewChange={setRightView}
                  artifactRequest={artifactRequest}
                  askDirect={askDirect}
                  openArtifact={openArtifact}
                  tutorMemory={tutorMemory}
                  onMindmapDataChange={setMindmapData}
                  onSummaryDataChange={setSummaryData}
                  onMindmapLibraryChange={updateMindmapLibrary}
                  onSummaryLibraryChange={updateSummaryLibrary}
                  onSwitchToChat={onSwitchToChat}
                  mindMapController={mindMapController}
                  mindMapContext={inspectorProps}
                  summaryData={summaryData ? { ...summaryData, context: summaryContext } : null}
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
