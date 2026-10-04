import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { apiFetch, generateMindmap, cancelMindmap, generateSummary, cancelSummary, getMindmapCapability, isUnauthorizedError, isNotFoundOrForbiddenError, getUserFriendlyApiError } from "../../utils/api";
import GuidedMindmapDialog from "./GuidedMindmapDialog";

// Permission-safe toast text: 401/403/404 → friendly line (no raw error/id); else
// keep the existing detail message.
function _errText(err, prefix, fallback) {
  if (isUnauthorizedError(err) || isNotFoundOrForbiddenError(err)) return getUserFriendlyApiError(err);
  return err?.message ? `${prefix}: ${err.message}` : fallback;
}
import { createMindmapPoller, stageLabel } from "../../utils/mindmapJob";
import { createSummaryPoller, stageLabel as summaryStageLabel, LENGTH_MODES, SUMMARY_MODES } from "../../utils/summaryJob";
import { saveActiveMindmapJob, loadActiveMindmapJob, clearActiveMindmapJob } from "../../utils/activeMindmapJob";
import { saveActiveSummaryJob, loadActiveSummaryJob, clearActiveSummaryJob } from "../../utils/activeSummaryJob";
import { confirmRegenerateIfDirty, stallBannerVisible, canRetry } from "../../utils/jobRecovery";
import { toast } from "../ui/Toaster";
import { Icon } from "../ui/Icon";
import ContextPanelCloseButton from "./ContextPanelCloseButton";
import Disclosure from "../ui/Disclosure";
import Spinner from "../ui/Spinner";
import { normStem, citeKey } from "../../utils/evidence";
import MdSnippet from "../ui/Markdown";
import TutorPanel from "../study/TutorPanel";
import ResearchTimeline from "../study/ResearchTimeline";
import KnowledgeDashboard from "../study/KnowledgeDashboard";
import KnowledgeInspector from "../mindmap/KnowledgeInspector";
import { normalizeSummaryRecord } from "../../utils/summaryJob";
import { useStudyContext } from "../../study/useStudyContext";

const IDLE_JOB_UI = { running: false, label: "", progress: null, stalled: false };
const legacyInspectorSurfacesEnabled = false;

function SummaryEvidenceContent({ data, context, onOpenSource }) {
  const rec = normalizeSummaryRecord(data);
  const section = rec?.sections?.find((item) => item.id === context?.sectionId) || rec?.sections?.[0];
  const refs = Array.isArray(section?.chunk_refs) ? section.chunk_refs : [];
  if (!rec) return <div className="context-inspector-empty">Mở một bản tóm tắt để xem nguồn và bằng chứng.</div>;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto co-the-cuon-them px-3 py-3">
      <div className="text-metadata font-mono uppercase text-text-muted mb-2 px-1">Nguồn của bản tóm tắt</div>
      <div className="evidence-frame p-3 mb-3">
        <div className="text-small font-semibold text-text-primary truncate">{rec.title || "Tóm tắt tài liệu"}</div>
        <div className="text-caption text-text-muted mt-1">{rec.sources?.length || 0} tài liệu</div>
        {rec.sources?.length > 0 && <button type="button" onClick={() => onOpenSource?.(rec.sources[0])} className="text-caption text-accent hover:underline mt-2">Mở nguồn</button>}
      </div>
      {section ? (
        <>
          <div className="text-metadata font-mono uppercase text-text-muted mb-2 px-1">Mục đang chọn</div>
          <div className="evidence-frame p-3">
            <div className="text-small font-semibold text-text-primary">{section.title}</div>
            {section.sourceStems?.length > 0 && <div className="text-caption text-text-muted mt-1">Nguồn: {section.sourceStems.join(" · ")}</div>}
            {refs.length > 0 ? <div className="flex flex-wrap gap-1.5 mt-2">{refs.map((ref) => <span key={ref} className="cite-chip !text-caption">đoạn {ref}</span>)}</div> : <p className="text-small text-text-muted italic mt-2">Mục này chưa có trích dẫn được xác minh.</p>}
          </div>
        </>
      ) : <div className="context-inspector-empty">Chọn một mục trong bản tóm tắt để xem bằng chứng.</div>}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────
const formatTimeAgo = (isoDate) => {
  if (!isoDate) return "Không xác định";
  const diff = (Date.now() - new Date(isoDate).getTime()) / 1000;
  if (isNaN(diff)) return "Không xác định";
  if (diff < 60) return `${Math.floor(diff)}s trước`;
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  return `${Math.floor(diff / 86400)} ngày trước`;
};

// ── Saved-artifact card ───────────────────────────────
const ListCard = ({ title, meta, icon, onOpen, onDelete, deleteLabel = "Xóa" }) => (
  <div
    onClick={onOpen}
    className="flex items-center gap-3 px-3 py-2.5 rounded-[7px] border border-border hover:border-accent/30 cursor-pointer transition-all group transition-theme"
    style={{ background: "var(--bg-card)" }}
  >
    <div className="w-8 h-8 rounded-[6px] flex items-center justify-center flex-shrink-0 text-seal" style={{ background: "color-mix(in srgb, var(--seal) 10%, transparent)" }}>
      <Icon name={icon} size={15} />
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-small font-semibold text-text-primary truncate">{title}</div>
      <div className="text-caption text-text-muted flex items-center gap-1 mt-0.5 font-mono">
        <Icon name="Clock" size={10} />{meta}
      </div>
    </div>
    <button
      onClick={(e) => { e.stopPropagation(); onDelete(); }}
      title={deleteLabel}
      aria-label={deleteLabel}
      className="w-7 h-7 rounded-[6px] inline-flex items-center justify-center text-text-muted opacity-0 group-hover:opacity-100 hover:text-[var(--err)] transition-all"
    >
      <Icon name="Trash2" size={13} />
    </button>
  </div>
);

// ── Artifact selector chips ───────────────────────────
const ARTIFACTS = [
  { key: "mindmap", label: "Sơ đồ", icon: "Network" },
  { key: "summary", label: "Tóm tắt", icon: "ScrollText" },
];

// ── Main component ────────────────────────────────────
export default function SidebarRight({
  selectedSources, evidence, highlight, onHighlight, onClose, onGuidedClose, onAskAbout, onOpenSource, collapsible = true,
  mode = "chat", mindMapContext, summaryData,
  // Phase 4C — Gia sư AI sống trong CÙNG cột này, không phải một cột thứ ba
  // (xem hard constraint "no new sidebar"). `rightView` là CONTROLLED từ
  // MainLayout (Ctrl+/ và trạng thái ngăn kéo/bottom-sheet trên mobile cần
  // biết tab nào đang mở); `artifactRequest` là lệnh một-lần (nonce) để "Xem
  // sơ đồ"/"Xem tóm tắt" ở Tutor chuyển đúng tab Artifacts bên dưới.
  rightView = "evidence", onRightViewChange, artifactRequest, askDirect, openArtifact, tutorMemory,
  // Feature Pack A — Research Timeline is a THIRD tab in this same column
  // (still one column, per the hard constraint above), so it reuses the
  // exact same controller/callbacks the other two tabs already receive
  // rather than opening a second wiring channel for "jump to X".
  mindMapController, onJumpToMindMapNode,
  // Workspace architecture (approved audit) — MindMap/Summary no longer render
  // as modals FROM HERE; this component keeps 100% of its generation/polling
  // logic and just forwards the computed data upward so MainLayout/
  // WorkspaceContainer can dock it into the central region instead.
  onMindmapDataChange, onSummaryDataChange, onSwitchToChat,
  onMindmapLibraryChange, onSummaryLibraryChange,
}) {
  const { selectEvidence } = useStudyContext();
  const [artifactTab, setArtifactTab] = useState("mindmap");
  // "Ghim"/"Tách nổi" CHỈ đổi kiểu hiển thị của tab Gia sư AI TRONG cột này —
  // không tách sang cây DOM khác, không đụng bề rộng cột (đó là việc của
  // `usePanelLayout`, không phải của component này) — cục bộ, không cần state
  // ở MainLayout.
  const [tutorFloating, setTutorFloating] = useState(false);

  const [mindMaps, setMindMaps]           = useState([]);
  const [showModalMap, setShowModalMap]   = useState(null);
  const [guidedOpen, setGuidedOpen] = useState(false);
  const [guidedCapability, setGuidedCapability] = useState(false);
  const [guidedError, setGuidedError] = useState(null);
  const [showSummaryModal, setShowSummaryModal] = useState(null);
  useEffect(() => {
    if (artifactRequest?.tab) {
      setArtifactTab(artifactRequest.tab);
      if (artifactRequest.tab === "mindmap" && !mindMaps.length && selectedSources?.length) setGuidedOpen(true);
    }
  }, [artifactRequest, mindMaps.length, selectedSources]);
  // Task 4 — background generation: chip state driven by the Task 1 poller
  // (no FE hard-timeout; onTick reports stage label / progress / stalled).
  const [mindmapJobUi, setMindmapJobUi] = useState(IDLE_JOB_UI);
  const [summaryJobUi, setSummaryJobUi] = useState(IDLE_JOB_UI);
  const [loading, setLoading]             = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false); // POST round-trip của /generate-summary
  const [summaryLength, setSummaryLength] = useState("medium");
  const [summaryMode, setSummaryMode] = useState("standard");  // Phase 3: standard | study
  const [summaryCancelNotice, setSummaryCancelNotice] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [dangTaiSummary, setDangTaiSummary] = useState(true);
  const [loiTaiMindmap, setLoiTaiMindmap] = useState(null);
  const [loiTaiSummary, setLoiTaiSummary] = useState(null);
  const [summaries, setSummaries]         = useState([]);
  // `mindmapGenerating` now only drives the viewer's in-overlay "generating"
  // banner during a "Tạo lại" (regenerate) run — plain "Tạo sơ đồ" no longer
  // opens the overlay while the job runs, so it stays false for that path.
  const [mindmapGenerating, setMindmapGenerating] = useState(false);
  const [mindmapCancelNotice, setMindmapCancelNotice] = useState(false);
  // PR#8 retry: context của lần chạy hỏng gần nhất ({sources, ...params}) —
  // null = không có lỗi cần retry. Set ở onError, clear khi chạy job mới.
  const [mindmapRetry, setMindmapRetry] = useState(null);
  // P2 fix: the progress chip that used to show this text lived behind the
  // permanently-dead `legacyInspectorSurfacesEnabled` flag, so a failed
  // generation had no persistent visible error -- only an ephemeral toast.
  // Rehomed into modalMapData/onMindmapLibraryChange instead of that flag.
  const [mindmapJobError, setMindmapJobError] = useState(null);
  const [summaryRetry, setSummaryRetry] = useState(null);
  // PR#8 stall banner snooze ("Chờ tiếp"): timestamp lần dismiss gần nhất.
  const [stallDismissedAt, setStallDismissedAt] = useState({ mindmap: 0, summary: 0 });

  useEffect(() => {
    let active = true;
    getMindmapCapability().then((data) => {
      if (active) setGuidedCapability(data?.guided_mindmap_v3 === true);
    }).catch(() => {
      // Capability failure fails closed for Guided V3; the legacy V2 flow stays usable.
      if (active) setGuidedCapability(false);
    });
    return () => { active = false; };
  }, []);

  const frameRefs = useRef(new Map());
  // PR#8: dirty state của viewer mindmap (thread từ MindElixirView.onDirtyChange)
  // — dùng để confirm trước khi "Tạo lại" thay thế bản đang sửa.
  const mindmapDirtyRef = useRef(false);
  // Params của lần chạy gần nhất — nguồn context cho retry (kể cả job resume).
  const lastMindmapRunRef = useRef(null);
  const lastSummaryRunRef = useRef(null);
  const createMindmapRef = useRef(null);

  // ── Mindmap job refs ───────────────────────────────
  const pollerRef = useRef(null); // fresh createMindmapPoller() instance per run
  const currentMindmapJobIdRef = useRef(null);
  // ── Summary job refs (mirror mindmap — poller riêng, không chia sẻ ref) ──
  const summaryPollerRef = useRef(null);
  const currentSummaryJobIdRef = useRef(null);
  const summaryCancelRequestedRef = useRef(false);
  // Fix Round 1 (Fix 3): guards the "Đã huỷ tạo sơ đồ" notice so it fires exactly
  // once per generation regardless of which path notices the cancel first — the
  // optimistic click path (handleCancelMindMap, fires immediately) or the
  // authoritative status-driven path (poll tick observing status "cancelled").
  const cancelNoticeShownRef = useRef(false);
  // true từ lúc user bấm Huỷ tới khi job đạt terminal — giữ label "Đang huỷ…"
  // không bị onTick ghi đè bằng stage label thường.
  const cancelRequestedRef = useRef(false);
  const showCancelNotice = useCallback(() => {
    if (cancelNoticeShownRef.current) return;
    cancelNoticeShownRef.current = true;
    setMindmapCancelNotice(true);
  }, []);

  // ── Fetchers (logic unchanged) ────────────────────
  // Hỏng KHÁC rỗng: `setMindMaps([])` trong `catch` làm màn hình ghi "Chưa có sơ đồ
  // nào được lưu" cho một người có đủ sơ đồ, và họ sẽ dựng lại từ đầu. Giữ nguyên danh
  // sách đang có, nói ra là chưa tải được.
  const fetchMindMaps = useCallback(async () => {
    try {
      const res = await apiFetch(`/mindmaps`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMindMaps(Array.isArray(data?.mindmaps) ? data.mindmaps : []);
      setLoiTaiMindmap(null);
    } catch (err) {
      console.error("Mind map fetch error:", err);
      setLoiTaiMindmap("Chưa tải được danh sách sơ đồ.");
    }
    finally { setInitialLoading(false); }
  }, []);

  const fetchSummaries = useCallback(async () => {
    try {
      const res = await apiFetch(`/summaries`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSummaries(Array.isArray(data?.summaries) ? data.summaries : []);
      setLoiTaiSummary(null);
    } catch (err) {
      console.error("Summary fetch error:", err);
      setLoiTaiSummary("Chưa tải được danh sách tóm tắt.");
    }
    // Tab Tóm tắt trước đây KHÔNG có cờ tải nào, nên nó hiện "Chưa có tóm tắt nào"
    // ngay trong lúc đang tải lần đầu.
    finally { setDangTaiSummary(false); }
  }, []);

  useEffect(() => { fetchMindMaps(); fetchSummaries(); }, [fetchMindMaps, fetchSummaries]);

  // ── Scroll the highlighted source frame into view ──
  useEffect(() => {
    if (!highlight) return;
    const key = `${normStem(highlight.stem)}::${String(highlight.chunkId ?? "")}`;
    const el = frameRefs.current.get(key);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [highlight]);

  // ── Mindmap job completion handlers (shared by fresh generate, resume,
  // and cache-hit) ────────────────────────────────────
  // `isRegenerate` only matters for the "Tạo lại" (force=true) path — that's
  // the one case where `mindmapGenerating` was turned on (viewer overlay
  // stays open showing the old map with a banner), so it's the one case that
  // needs it turned back off on completion.
  const handleMindmapDone = useCallback(async (data, sourceList, { resumed = false, isRegenerate = false } = {}) => {
    clearActiveMindmapJob();
    if (isRegenerate) setMindmapGenerating(false);
    setMindmapJobError(null);
    const hasNodes = (Array.isArray(data?.nodes) && data.nodes.length > 0) ||
      (Array.isArray(data?.diagram?.nodes) && data.diagram.nodes.length > 0);
    if (!hasNodes) {
      toast("Không tạo được sơ đồ từ tài liệu đã chọn (nội dung quá ngắn hoặc không trích được ý chính). Thử chọn tài liệu khác.", { type: "error" });
      return;
    }
    // Spread `data` first so v2 fields (schema_version/relations/generator) that
    // the mindmap viewer needs for relations + the degraded banner survive —
    // the explicit keys below only backfill defaults, they don't drop anything.
    const record = {
      ...data,
      id: data.id || Date.now().toString(),
      title: data.title || "Sơ đồ tư duy",
      nodes: Array.isArray(data.nodes) ? data.nodes : [],
      diagram: data.diagram || null,
      sources: Array.isArray(data.sources) ? data.sources : sourceList,
      createdAt: data.createdAt || data.created_at || new Date().toISOString(),
      strategy: data.strategy || "iterative",
      initialLayoutType: "napkin",
    };
    setMindMaps((prev) => [record, ...prev.filter((item) => item.id !== record.id)]);
    await fetchMindMaps();
    if (resumed) {
      // The tab that started this job is gone — don't yank the user into a
      // full-screen overlay for a job they may not even remember starting.
      toast("Sơ đồ đã xong trong lúc bạn vắng mặt — mở từ danh sách", { type: "info" });
    } else {
      toast("Sơ đồ sẵn sàng", { type: "success" });
      setShowModalMap(record);
    }
  }, [fetchMindMaps]);

  const handleMindmapError = useCallback((err, { isRegenerate = false } = {}) => {
    clearActiveMindmapJob();
    if (isRegenerate) setMindmapGenerating(false);
    console.error("Mind Map Error:", err);
    const message = err?.message || "Không tạo được sơ đồ, kiểm tra console!";
    toast(err?.message ? `Không tạo được sơ đồ: ${err.message}` : message, { type: "error" });
    // PR#8: giữ context để hiện "Thử lại" — chỉ khi biết sources của lần chạy hỏng.
    setMindmapRetry(lastMindmapRunRef.current);
    // Persisted (not just toasted) so it survives past the toast's own
    // timeout -- shown in the generating banner / empty-state below.
    setMindmapJobError(message);
  }, []);

  // Starts a fresh poller instance (Task 1's createMindmapPoller has no hard
  // timeout and does NOT guard double-start) and drives the chip state.
  const startMindmapPoller = useCallback((jobId, sourceList, { resumed = false, isRegenerate = false } = {}) => {
    // Fresh instance per run (createMindmapPoller does not self-guard against
    // double-start) — stop whatever was previously tracked in the ref first so
    // a second click can't leave an orphaned poller ticking in the background.
    pollerRef.current?.stop();
    currentMindmapJobIdRef.current = jobId;
    cancelRequestedRef.current = false;
    setMindmapJobUi({ running: true, label: "Đang tạo sơ đồ…", progress: null, stalled: false });

    const fetchStatus = (id) =>
      apiFetch(`/mindmap-status/${encodeURIComponent(id)}`).then((r) => {
        if (!r.ok) {
          const e = new Error(`HTTP ${r.status}`);
          e.status = r.status; // poller cần biết 404 = job không tồn tại (terminal)
          throw e;
        }
        return r.json();
      });

    const poller = createMindmapPoller({
      fetchStatus,
      onTick: (status, { stalled }) => {
        setMindmapJobUi({
          running: true,
          label: cancelRequestedRef.current ? "Đang huỷ…" : stageLabel(status),
          progress: typeof status.progress === "number" ? status.progress : null,
          stalled,
        });
      },
      onDone: (result) => {
        setMindmapJobUi(IDLE_JOB_UI);
        currentMindmapJobIdRef.current = null;
        handleMindmapDone(result, sourceList, { resumed, isRegenerate });
      },
      onError: (err) => {
        setMindmapJobUi(IDLE_JOB_UI);
        currentMindmapJobIdRef.current = null;
        handleMindmapError(err, { isRegenerate });
      },
      onCancelled: () => {
        setMindmapJobUi(IDLE_JOB_UI);
        currentMindmapJobIdRef.current = null;
        if (isRegenerate) setMindmapGenerating(false);
        clearActiveMindmapJob();
        showCancelNotice();
      },
    });
    pollerRef.current = poller;
    poller.start(jobId);
  }, [handleMindmapDone, handleMindmapError, showCancelNotice]);

  // Resume-after-reload (Task 4 point 6): on mount, pick up a job that was
  // still running when the page unloaded and re-attach a poller so the chip
  // reappears. No StrictMode guard on purpose: the cleanup effect below stops
  // the poller between StrictMode's dev double-invoke passes, and a run-once
  // ref would block pass 2 from starting a replacement (chip stuck forever).
  // Re-running is safe — startMindmapPoller stops the previous instance first.
  useEffect(() => {
    const active = loadActiveMindmapJob();
    if (active?.jobId) {
      // PR#8: job resume cũng cần retry-context nếu nó hỏng sau này.
      lastMindmapRunRef.current = { sources: active.sources || [], force: false };
      startMindmapPoller(active.jobId, active.sources, { resumed: true, isRegenerate: false });
    }
    const activeSummary = loadActiveSummaryJob();
    if (activeSummary?.jobId) {
      lastSummaryRunRef.current = {
        sources: activeSummary.sources || [],
        lengthMode: activeSummary.extra?.lengthMode || "medium",
        mode: activeSummary.extra?.mode || "standard",
      };
      startSummaryPoller(activeSummary.jobId, { resumed: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { pollerRef.current?.stop(); summaryPollerRef.current?.stop(); }, []);

  // Auto-select most recent map on load (intermittent "no map" bug): showModalMap
  // defaulted to null and only became truthy via an explicit library click or a
  // resumed job's own completion handler — a user with existing completed maps
  // and no running job saw "no map" on every fresh /app load even though mindMaps
  // (the library) was already fully populated, because nothing ever auto-opened
  // one. store.list_records already orders by created_at DESC, so mindMaps[0] is
  // the most recent map. Skipped while a job is resuming/running so that job's
  // own completion picks the map instead; re-checked once it settles so a job
  // that fails without ever calling setShowModalMap still falls back correctly.
  const autoSelectedMapRef = useRef(false);
  useEffect(() => {
    if (autoSelectedMapRef.current || showModalMap) return;
    if (mindmapJobUi.running || loadActiveMindmapJob()?.jobId) return;
    if (mindMaps.length === 0) return;
    autoSelectedMapRef.current = true;
    // __restoredOnLoad: this is a library restore, not a freshly-finished
    // generation — MainLayout's own "auto-jump to a newly-populated tab"
    // effect must not fire for it (that effect exists so a real new map still
    // pulls the user to it; a page reload must not yank a Chat-first user
    // into Mind Map mode just because they happen to have an old map saved).
    setShowModalMap({ ...mindMaps[0], __restoredOnLoad: true });
  }, [mindMaps, showModalMap, mindmapJobUi.running]);

  // ── Handlers ───────────────────────────────────────
  // Shared by "Tạo sơ đồ" (force=false, uses BE content-hash cache) and the
  // mindmap viewer's degraded-banner "Tạo lại" (force=true, bypasses cache).
  const runMindmapGeneration = async (sourceList, { force = false, ...guidedOptions } = {}) => {
    if (!sourceList?.length) { toast("Vui lòng chọn ít nhất một tài liệu để tạo Sơ đồ!", { type: "error" }); return; }
    // PR#8: chạy job mới = hết trạng thái lỗi cũ; nhớ params cho retry lần sau.
    lastMindmapRunRef.current = { sources: sourceList, force };
    setMindmapRetry(null);
    setMindmapJobError(null);
    setLoading(true);
    setMindmapCancelNotice(false);
    cancelNoticeShownRef.current = false;
    if (force) setMindmapGenerating(true); // keep the open viewer's banner up during "Tạo lại"
    try {
      const startData = await generateMindmap(sourceList, { force, ...guidedOptions });
      if (startData.error) throw new Error(startData.error);

      if (startData.status === "done" && startData.result) {
        // Cache-hit (content_hash match, force=false): BE returns the record
        // straight away with no job_id — skip polling entirely instead of
        // throwing "Server không trả job_id." (known issue, fixed here).
        // Request outcome is known now (success) — safe to close the dialog.
        if (Object.keys(guidedOptions).length) setGuidedOpen(false);
        await handleMindmapDone(
          { ...startData.result, __usage: startData.usage || null },
          sourceList,
          { resumed: false, isRegenerate: force },
        );
        return;
      }

      if (!startData.job_id) throw new Error("Server không trả job_id.");
      // Generation now runs in the background — persist the job so a reload
      // mid-flight can resume polling (Task 4 point 6) instead of the user
      // having to F5 and lose track of it.
      saveActiveMindmapJob({ jobId: startData.job_id, sources: sourceList, startedAt: Date.now() });
      // 2026-09-24: this used to close BEFORE the request even started
      // (submitGuidedMindmap called setGuidedOpen(false) synchronously on
      // submit) — a real QA browser job ran for a genuine ~60s in the
      // background with zero visible feedback anywhere, because the only
      // surface that showed progress (this dialog) was already gone. Close
      // only now that the job is actually queued and the poller (which
      // drives mindmapJobUi, the visible progress chip) is about to start.
      if (Object.keys(guidedOptions).length) setGuidedOpen(false);
      startMindmapPoller(startData.job_id, sourceList, { resumed: false, isRegenerate: force });
    } catch (err) {
      console.error("Mind Map Error:", err);
      toast(_errText(err, "Không tạo được sơ đồ", "Không tạo được sơ đồ, kiểm tra console!"), { type: "error" });
      if (Object.keys(guidedOptions).length) {
        // Request failed before we ever confirmed acceptance — dialog was
        // never closed on this path (see above), so this just makes sure
        // it's visibly open with the error rather than assuming it needs
        // reopening.
        setGuidedError(err?.message || "Không tạo được sơ đồ.");
        setGuidedOpen(true);
      }
      if (force) setMindmapGenerating(false);
    }
    finally {
      setLoading(false);
    }
  };

  const handleGenerateMindMap = () => {
    if (guidedCapability) setGuidedOpen(true);
    else runMindmapGeneration(selectedSources);
  };
  createMindmapRef.current = handleGenerateMindMap;
  const onCreateNewMindmap = useCallback(() => createMindmapRef.current?.(), []);
  // 2026-09-24: no longer closes the dialog here -- runMindmapGeneration now
  // closes it only once the create request's outcome is actually known
  // (queued/done), so a failure keeps the dialog open with a visible error
  // instead of silently vanishing while work is unresolved. The dialog's own
  // `loading` prop (still wired below) keeps the submit button disabled and
  // showing "Đang tạo…" for the request round-trip in the meantime.
  const submitGuidedMindmap = (options) => {
    setGuidedError(null);
    runMindmapGeneration(options.sourceIds, options).catch((error) => setGuidedError(error?.message || "Không tạo được sơ đồ."));
  };

  // Degraded-banner "Tạo lại": regenerate the map that's currently open, using
  // the sources it was built from (falls back to the sidebar selection if the
  // record doesn't carry its own).
  const handleRegenerateMindMap = () => {
    // PR#8: bản đang mở có chỉnh sửa chưa lưu → confirm trước khi thay thế
    // (fix thật của known-issue "Tạo lại xong ghi đè chỉnh sửa chưa lưu").
    if (!confirmRegenerateIfDirty(mindmapDirtyRef.current, window.confirm)) return;
    const sources = showModalMap?.sources?.length ? showModalMap.sources : selectedSources;
    return runMindmapGeneration(sources, { force: true });
  };

  // Real cancel (codex #4): BE chỉ kiểm cờ cancel GIỮA các node — LLM call đang
  // bay không dừng được, job có thể vẫn chạy xong và persist. Vì vậy KHÔNG stop
  // poller ngay: gửi cancel rồi tiếp tục poll tới trạng thái terminal thật
  // ("Đang huỷ…" → onCancelled xác nhận / onDone nếu job kịp xong trước cancel).
  // `modalMapData` below memoizes on this reference — an un-memoized function
  // here recomputes that memo (and the effect that forwards it to
  // onMindmapDataChange) on EVERY render, which is invisible while
  // `showModalMap` is falsy (the memo's ternary always returns the same `null`)
  // but becomes an infinite render loop the moment a real map is open (every
  // render produces a new object, the effect fires, setMindmapData fires,
  // the parent re-renders this component, repeat) — found live watching a
  // real generation render for the first time; round 5 never got this far.
  const handleCancelMindMap = useCallback(() => {
    const jobId = currentMindmapJobIdRef.current;
    if (!jobId) { // không có job đang theo dõi — dọn UI là đủ
      pollerRef.current?.stop();
      pollerRef.current = null;
      clearActiveMindmapJob();
      setMindmapJobUi(IDLE_JOB_UI);
      setMindmapGenerating(false);
      showCancelNotice();
      return;
    }
    cancelRequestedRef.current = true;
    setMindmapJobUi((prev) => ({ ...prev, running: true, label: "Đang huỷ…" }));
    cancelMindmap(jobId).catch((err) => console.error("[MindMap] cancel request failed:", err));
  }, [showCancelNotice]);

  // "Hỏi về đoạn này" (EvidenceDrawer) → switch the Workspace back to the Chat
  // tab (mindmap stays generated, NOT cleared — Workspace architecture: a tab
  // switch must never lose the generated map), then hand the snippet up to
  // MainLayout to prefill + focus the composer.
  const handleAskAbout = useCallback((snippet) => {
    onSwitchToChat?.();
    onAskAbout?.(snippet);
  }, [onAskAbout, onSwitchToChat]);

  // Phase 5 (Knowledge Inspector) Task 5 — Learning Actions (Explain simpler/
  // deeper, flashcard, quiz, examples, ask) send a fully-formed prompt, unlike
  // `handleAskAbout`'s raw quoted snippet, so they reuse `askDirect` (already
  // threaded into this component for TutorPanel) instead of wrapping it in
  // `onAskAbout`'s "Về đoạn này..." template. Same switch-then-forward shape.
  const handleAskDirect = useCallback((text, context = null) => {
    onSwitchToChat?.();
    askDirect?.(text, context);
  }, [askDirect, onSwitchToChat]);

  // Task 8: after MindElixirView's explicit Save (PUT /mindmaps/<id>) succeeds,
  // sync both the saved-list card and the still-open modal with the returned
  // record — spread `saved` first so v2 fields (schema_version/relations/
  // generator) survive, mirroring the same rebuild-drops-fields lesson as
  // handleMindmapDone above.
  const handleMindmapSaved = useCallback((saved) => {
    setMindMaps((prev) => prev.map((m) => (m.id === saved.id ? saved : m)));
    setShowModalMap((prev) => (prev ? { ...prev, ...saved } : prev));
  }, []);

  const handleDeleteMap = async (id) => {
    if (!window.confirm("Xóa sơ đồ này?")) return;
    try {
      const res = await apiFetch(`/mindmaps/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMindMaps((prev) => prev.filter((m) => m.id !== id));
      await fetchMindMaps();
    } catch (err) { console.error("Mind Map delete error:", err); alert("Không xóa được sơ đồ!"); }
  };

  // ── Summary v2 job flow (mirror mindmap: poller + resume + cancel thật) ──
  const handleSummaryDone = useCallback(async (record, { resumed = false } = {}) => {
    clearActiveSummaryJob();
    await fetchSummaries(); // BE đã tự persist record — chỉ cần refresh danh sách
    if (resumed) {
      toast("Tóm tắt đã xong trong lúc bạn vắng mặt — mở từ danh sách", { type: "info" });
    } else {
      toast("Tóm tắt sẵn sàng", { type: "success" });
      setShowSummaryModal(record);
    }
  }, [fetchSummaries]);

  const handleSummaryError = useCallback((err) => {
    clearActiveSummaryJob();
    console.error("Summary Error:", err);
    toast(_errText(err, "Không tạo được tóm tắt", "Không tạo được tóm tắt, kiểm tra console!"), { type: "error" });
    setSummaryRetry(lastSummaryRunRef.current); // PR#8: context cho nút "Thử lại"
  }, []);

  const startSummaryPoller = useCallback((jobId, { resumed = false } = {}) => {
    // poller không tự guard double-start — dừng instance cũ trước khi gán mới
    summaryPollerRef.current?.stop();
    currentSummaryJobIdRef.current = jobId;
    summaryCancelRequestedRef.current = false;
    setSummaryJobUi({ running: true, label: "Đang tóm tắt…", progress: null, stalled: false });

    const fetchStatus = (id) =>
      apiFetch(`/summary-status/${encodeURIComponent(id)}`).then((r) => {
        if (!r.ok) {
          const e = new Error(`HTTP ${r.status}`);
          e.status = r.status; // 404 = job không tồn tại (terminal)
          throw e;
        }
        return r.json();
      });

    const poller = createSummaryPoller({
      fetchStatus,
      onTick: (status, { stalled }) => {
        setSummaryJobUi({
          running: true,
          label: summaryCancelRequestedRef.current ? "Đang huỷ…" : summaryStageLabel(status),
          progress: typeof status.progress === "number" ? status.progress : null,
          stalled,
        });
      },
      onDone: (result) => {
        setSummaryJobUi(IDLE_JOB_UI);
        currentSummaryJobIdRef.current = null;
        handleSummaryDone(result, { resumed });
      },
      onError: (err) => {
        setSummaryJobUi(IDLE_JOB_UI);
        currentSummaryJobIdRef.current = null;
        handleSummaryError(err);
      },
      onCancelled: () => {
        setSummaryJobUi(IDLE_JOB_UI);
        currentSummaryJobIdRef.current = null;
        clearActiveSummaryJob();
        setSummaryCancelNotice(true);
      },
    });
    summaryPollerRef.current = poller;
    poller.start(jobId);
  }, [handleSummaryDone, handleSummaryError]);

  // PR#8: tách runner nhận params tường minh — "Tạo tóm tắt" dùng state hiện tại,
  // "Thử lại" dùng đúng params của lần chạy hỏng (không lệ thuộc selection đã đổi).
  const runSummaryGeneration = async (sourceList, { lengthMode, mode }) => {
    if (!sourceList?.length) { toast("Vui lòng chọn ít nhất một tài liệu để tóm tắt!", { type: "error" }); return; }
    lastSummaryRunRef.current = { sources: sourceList, lengthMode, mode };
    setSummaryRetry(null);
    setSummaryLoading(true);
    setSummaryCancelNotice(false);
    try {
      const startData = await generateSummary(sourceList, { lengthMode, mode });
      if (startData.error) throw new Error(startData.error);

      if (startData.status === "done" && startData.result) {
        // Cache-hit: BE trả record thẳng, KHÔNG có job_id — branch trước (aec6017)
        await handleSummaryDone(
          { ...startData.result, __usage: startData.usage || null },
          { resumed: false },
        );
        return;
      }

      if (!startData.job_id) throw new Error("Server không trả job_id.");
      saveActiveSummaryJob({ jobId: startData.job_id, sources: sourceList, startedAt: Date.now(), extra: { lengthMode, mode } });
      startSummaryPoller(startData.job_id, { resumed: false });
    } catch (err) {
      handleSummaryError(err);
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleGenerateSummary = () =>
    runSummaryGeneration(selectedSources, { lengthMode: summaryLength, mode: summaryMode });
  // The runner is intentionally an existing imperative function; this wrapper
  // keeps the library callback stable without changing generation behavior.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const createSummaryFromLibrary = useCallback(() => handleGenerateSummary(), [selectedSources, summaryLength, summaryMode]);

  // Cancel thật (mirror mindmap): gửi cờ rồi TIẾP TỤC poll tới terminal —
  // LLM call đang bay không dừng được, job có thể vẫn kịp xong.
  const handleCancelSummary = () => {
    const jobId = currentSummaryJobIdRef.current;
    if (!jobId) {
      summaryPollerRef.current?.stop();
      summaryPollerRef.current = null;
      clearActiveSummaryJob();
      setSummaryJobUi(IDLE_JOB_UI);
      setSummaryCancelNotice(true);
      return;
    }
    summaryCancelRequestedRef.current = true;
    setSummaryJobUi((prev) => ({ ...prev, running: true, label: "Đang huỷ…" }));
    cancelSummary(jobId).catch((err) => console.error("[Summary] cancel request failed:", err));
  };

  const handleDeleteSummary = async (id) => {
    if (!id) { alert("Không xác định được ID tóm tắt"); return; }
    if (!window.confirm("Xóa tóm tắt này?")) return;
    try {
      const res = await apiFetch(`/summaries/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      await fetchSummaries();
    } catch (err) { console.error("Delete summary error:", err); alert("Không xóa được tóm tắt!"); }
  };

  // ── Derived ───────────────────────────────────────
  const chunks = Array.isArray(evidence?.chunks) ? evidence.chunks : [];
  const sourceStems = Array.isArray(evidence?.sources) ? evidence.sources : [];
  // `mindmapJobUi.running` is included so the button stays disabled for the
  // whole background run, not just the initial POST round-trip — otherwise a
  // second click while a job (or a resumed one) is in flight could kick off a
  // duplicate generation.
  const isGenerating = artifactTab === "mindmap"
    ? (loading || mindmapJobUi.running)
    : (summaryLoading || summaryJobUi.running);
  const onGenerate = artifactTab === "mindmap" ? handleGenerateMindMap : handleGenerateSummary;
  // Chip tiến độ dùng chung markup — jobUi/cancel theo tab đang mở
  const jobUi = artifactTab === "mindmap" ? mindmapJobUi : summaryJobUi;
  const onCancelJob = artifactTab === "mindmap" ? handleCancelMindMap : handleCancelSummary;
  const cancelNotice = artifactTab === "mindmap" ? mindmapCancelNotice : summaryCancelNotice;
  const cancelNoticeText = artifactTab === "mindmap" ? "Đã huỷ tạo sơ đồ." : "Đã huỷ tạo tóm tắt.";
  // PR#8: retry theo tab — chỉ hiện khi có context và không có job đang chạy.
  const retryCtx = artifactTab === "mindmap" ? mindmapRetry : summaryRetry;
  const showRetry = !isGenerating && canRetry(retryCtx);
  const handleRetry = () => {
    if (!canRetry(retryCtx)) return;
    if (artifactTab === "mindmap") {
      runMindmapGeneration(retryCtx.sources, { force: Boolean(retryCtx.force) });
    } else {
      runSummaryGeneration(retryCtx.sources, {
        lengthMode: retryCtx.lengthMode || "medium",
        mode: retryCtx.mode || "standard",
      });
    }
  };
  // PR#8: stall banner có snooze — "Chờ tiếp" ẩn cảnh báo thêm một cửa sổ nữa,
  // poller vẫn poll (KHÔNG auto-cancel, KHÔNG hard-timeout).
  const stallShown = jobUi.running && stallBannerVisible(
    jobUi.stalled, stallDismissedAt[artifactTab], Date.now());
  const dismissStall = () =>
    setStallDismissedAt((prev) => ({ ...prev, [artifactTab]: Date.now() }));

  // MindMapModal forwards `data` to MindmapView verbatim, so this is how
  // generating/progress/cancel/ask-about reach it without widening that
  // shell's prop list — applies to every open map (fresh, regenerated, or
  // reopened from the saved list), not just the live-generation preview.
  const modalMapData = useMemo(() => (showModalMap ? {
    ...showModalMap,
    // P2 fix: `mindmapGenerating` alone only ever turns true for the "Tạo
    // lại" (force=true) path -- a genuinely NEW guided generation with a map
    // already open left this banner off, the only visible surface being the
    // (dead, legacyInspectorSurfacesEnabled) chip. `mindmapJobUi.running`
    // covers both.
    generating: mindmapGenerating || mindmapJobUi.running,
    progress: mindmapJobUi.progress,
    jobLabel: mindmapJobUi.label,
    jobError: mindmapJobError,
    onRetryJob: canRetry(mindmapRetry) ? () => runMindmapGeneration(mindmapRetry.sources, { force: Boolean(mindmapRetry.force) }) : null,
    onCancel: handleCancelMindMap,
    onAskAbout: handleAskAbout,
    onAskDirect: handleAskDirect,
    onSaved: handleMindmapSaved,
    mindMaps,
    onSelectMap: setShowModalMap,
    onCreateNew: onCreateNewMindmap,
    creating: loading || mindmapJobUi.running,
    // PR#8: viewer báo dirty lên đây — handleRegenerateMindMap đọc ref này để
    // confirm trước khi "Tạo lại" thay thế bản đang sửa.
    onDirtyChange: (d) => { mindmapDirtyRef.current = Boolean(d); },
    // runMindmapGeneration (used by onRetryJob above) is a plain closure
    // recreated every render, not memoized; including it in deps would just
    // always be "changed", defeating this memo for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  } : null), [showModalMap, mindMaps, loading, mindmapJobUi.running, mindmapJobUi.label, mindmapGenerating, mindmapJobUi.progress, mindmapJobError, mindmapRetry, handleCancelMindMap, handleAskAbout, handleAskDirect, handleMindmapSaved, onCreateNewMindmap]);

  // Workspace architecture — forward the SAME `modalMapData` a portal used to
  // consume, plus the two extra props MindElixirView takes directly
  // (onRegenerate/regenerating, previously passed to MindMapModal alongside
  // `data`). `showModalMap.initialLayoutType` was dead (MindMapModal accepted
  // it but never forwarded it to MindElixirView) — not carried forward.
  useEffect(() => {
      onMindmapDataChange?.(modalMapData ? {
      data: modalMapData, onRegenerate: handleRegenerateMindMap, regenerating: mindmapGenerating,
    } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalMapData, mindmapGenerating, onMindmapDataChange]);

  useEffect(() => {
    onSummaryDataChange?.(showSummaryModal || null);
  }, [showSummaryModal, onSummaryDataChange]);

  useEffect(() => {
    onMindmapLibraryChange?.({
      mindMaps,
      // initialLoading/loadError let the empty-state distinguish "still
      // loading" and "failed to load" from genuinely "no maps yet" instead
      // of collapsing all three into the same "Chưa có sơ đồ" screen.
      initialLoading,
      loadError: loiTaiMindmap,
      actions: {
        select: setShowModalMap,
        create: onCreateNewMindmap,
        creating: loading || mindmapJobUi.running,
        // P2 fix: same job-status fields as modalMapData, for the case where
        // no map is open yet (WorkspaceEmptyState) -- there's no viewer to
        // put a banner into otherwise.
        jobLabel: mindmapJobUi.label,
        jobProgress: mindmapJobUi.progress,
        jobError: mindmapJobError,
        onRetry: canRetry(mindmapRetry) ? () => runMindmapGeneration(mindmapRetry.sources, { force: Boolean(mindmapRetry.force) }) : null,
      },
    });
    // runMindmapGeneration (used by onRetry above) is a plain closure
    // recreated every render, not memoized -- see modalMapData above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mindMaps, loading, mindmapJobUi.running, mindmapJobUi.label, mindmapJobUi.progress, mindmapJobError, mindmapRetry, onCreateNewMindmap, onMindmapLibraryChange, initialLoading, loiTaiMindmap]);

  useEffect(() => {
    onSummaryLibraryChange?.({
      summaries,
      actions: {
        select: setShowSummaryModal,
        create: createSummaryFromLibrary,
        creating: summaryLoading || summaryJobUi.running,
      },
    });
  }, [summaries, summaryLoading, summaryJobUi.running, createSummaryFromLibrary, onSummaryLibraryChange]);

  // ── Render ────────────────────────────────────────
  return (
    <div id="context-inspector" role="region" aria-label="Bộ kiểm tra ngữ cảnh" className="sidebar-right flex flex-col h-full overflow-hidden transition-theme" style={{ background: "var(--bg-sidebar)" }}>

      {/* Header — bốn view của MỘT cột: Bằng chứng / Gia sư AI / Dòng thời
          gian / Kiến thức. Visual Identity Reset: demoted from `.pill-tab`
          (permanently bordered+filled box) to `.inspector-tab` (underline,
          border-free at rest) — these are the same feature as the header's
          shortcut buttons (Layout/MainLayout.jsx), so the Inspector no
          longer reads as a second, equal-weight navigation bar duplicating
          the global header. */}
      <div className="study-surface-header">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name={rightView === "tutor" ? "Sparkles" : rightView === "timeline" ? "Clock" : rightView === "insights" ? "Network" : "Quote"} size={15} />
          <strong className="truncate">{mode === "mindmap" ? "Chi tiết sơ đồ" : mode === "summary" ? "Nguồn bản tóm tắt" : "Bằng chứng câu trả lời"}</strong>
        </div>
        <ContextPanelCloseButton collapsible={collapsible} onClose={onClose} />
      </div>
      {legacyInspectorSurfacesEnabled && <div className="px-4 pt-4 pb-3 border-b border-border flex items-center justify-between flex-shrink-0 gap-2" aria-hidden="true">
        <div className="flex gap-1 min-w-0">
          <button type="button" onClick={() => onRightViewChange?.("evidence")}
                  className={`inspector-tab ${rightView === "evidence" ? "pill-tab-active" : ""}`}
                  aria-pressed={rightView === "evidence"}>
            <Icon name="Quote" size={13} /> Bằng chứng
          </button>
          <button type="button" onClick={() => onRightViewChange?.("tutor")}
                  className={`inspector-tab ${rightView === "tutor" ? "pill-tab-active" : ""}`}
                  aria-pressed={rightView === "tutor"}>
            <Icon name="Sparkles" size={13} /> Gia sư AI
          </button>
          {/* Feature Pack A — peer of the two tabs above, same inspector-tab
              weight and aria-pressed semantics (this is a top-level view
              switch, not a sub-section — unlike the demoted pill-tab--sub
              artifact tabs inside the Evidence view below). */}
          <button type="button" onClick={() => onRightViewChange?.("timeline")}
                  className={`inspector-tab ${rightView === "timeline" ? "pill-tab-active" : ""}`}
                  aria-pressed={rightView === "timeline"}>
            <Icon name="Clock" size={13} /> Dòng thời gian
          </button>
          {/* Feature Pack D — same peer weight as Timeline above. */}
          <button type="button" onClick={() => onRightViewChange?.("insights")}
                  className={`inspector-tab ${rightView === "insights" ? "pill-tab-active" : ""}`}
                  aria-pressed={rightView === "insights"}>
            <Icon name="Network" size={13} /> Kiến thức
          </button>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Ghim/Tách nổi — chỉ có ý nghĩa trên màn rộng, nơi cột này có chỗ
              để "nổi" lên trên nội dung thay vì nằm phẳng trong hàng cột. */}
          {rightView === "tutor" && (
            <button type="button" onClick={() => setTutorFloating((v) => !v)}
                    className={`icon-btn w-8 h-8 hidden md:inline-flex ${tutorFloating ? "text-accent" : ""}`}
                    aria-pressed={tutorFloating}
                    title={tutorFloating ? "Ghim vào cột" : "Tách nổi"}
                    aria-label={tutorFloating ? "Ghim Gia sư AI vào cột" : "Tách Gia sư AI nổi lên"}>
              <Icon name="Pin" size={15} />
            </button>
          )}
        </div>
      </div>}

      {mode === "mindmap" ? (
        <KnowledgeInspector {...mindMapContext} onClose={undefined} />
      ) : mode === "summary" ? (
        <SummaryEvidenceContent data={summaryData} context={summaryData?.context} onOpenSource={onOpenSource} />
      ) : rightView === "tutor" ? (
        <div className={`flex-1 min-h-0 overflow-y-auto co-the-cuon-them ${tutorFloating ? "md:m-2.5 md:rounded-[12px] md:shadow-card-hover md:border md:border-border" : ""}`}>
          <TutorPanel askDirect={askDirect} openArtifact={openArtifact} memory={tutorMemory} />
        </div>
      ) : rightView === "timeline" ? (
        <ResearchTimeline
          mindMapController={mindMapController}
          onJumpQuestion={askDirect}
          onJumpNode={onJumpToMindMapNode}
          onJumpEvidence={({ stem, chunkId }) => {
            onRightViewChange?.("evidence");
            onHighlight?.({ stem, chunkId });
          }}
        />
      ) : rightView === "insights" ? (
        <KnowledgeDashboard
          mindMapController={mindMapController}
          onJumpQuestion={askDirect}
          onJumpNode={onJumpToMindMapNode}
          onJumpEvidence={({ stem, chunkId }) => {
            onRightViewChange?.("evidence");
            onHighlight?.({ stem, chunkId });
          }}
          onOpenTimeline={() => onRightViewChange?.("timeline")}
          selectedSources={selectedSources}
        />
      ) : (
      <>
      {/* ── EVIDENCE MARGIN ── */}
      <div className="flex-1 min-h-0 overflow-y-auto co-the-cuon-them px-3 py-3">
        {chunks.length > 0 ? (
          <>
            <div className="text-metadata font-mono uppercase text-text-muted mb-2 px-1">
              Nguồn của câu trả lời ({chunks.length})
            </div>
            <div className="flex flex-col gap-2">
              {chunks.map((c, i) => {
                const stem = c.stem || "";
                const chunkId = c.chunk_id ?? "";
                // Feature Pack B — same canonical id (`citeKey`, utils/evidence.js)
                // ChatArea's citation-click now uses too, not a second formula.
                const key = citeKey(stem, chunkId);
                const active = highlight && normStem(highlight.stem) === normStem(stem) && String(highlight.chunkId) === String(chunkId);
                // Feature Pack B (Cross Navigation) — this list is a SECOND
                // rendering of the same citation data the prose's inline chips
                // already show; the chips log to the Timeline on click (Pack
                // A), this list never did. Same id shape (`key`, already
                // computed above), same selectEvidence contract, click only
                // (hover keeps its existing, unlogged onHighlight — unchanged).
                const openEvidence = () => selectEvidence(key, { source: "chat", label: `${stem} · đoạn ${chunkId}` });
                // Chat -> MindMap node: a PURE lookup over data the mindmap
                // already built at load time (each node's sidecar already
                // lists its own chunkRefs) — no new data, no API call. `null`
                // when no node cites this exact chunk; the button below is
                // simply absent then, never a disabled fake.
                const mindMapNodeId = mindMapController?.findNodeByChunk?.(chunkId);
                return (
                  <div
                    key={`${key}-${i}`}
                    ref={(el) => { if (el) frameRefs.current.set(key, el); else frameRefs.current.delete(key); }}
                    className={`evidence-frame ${active ? "evidence-frame--active" : ""} p-3 cursor-pointer`}
                    role="button"
                    tabIndex={0}
                    onMouseEnter={() => onHighlight?.({ stem, chunkId })}
                    onMouseLeave={() => onHighlight?.(null)}
                    onClick={openEvidence}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEvidence(); } }}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-5 h-5 rounded-[4px] inline-flex items-center justify-center text-caption font-mono font-semibold flex-shrink-0"
                        style={{ color: "var(--seal)", border: "1px solid color-mix(in srgb, var(--seal) 35%, transparent)" }}>
                        {i + 1}
                      </span>
                      <span className="coord truncate flex-1" title={stem}>
                        {stem || "nguồn"}{chunkId !== "" ? ` · đoạn ${chunkId}` : ""}
                      </span>
                      {mindMapNodeId && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onJumpToMindMapNode?.(mindMapNodeId); }}
                          className="icon-btn w-6 h-6 flex-shrink-0"
                          title="Xem nhánh này trong sơ đồ tư duy"
                          aria-label="Xem nhánh này trong sơ đồ tư duy"
                        >
                          <Icon name="Network" size={12} />
                        </button>
                      )}
                    </div>
                    {c.snippet && (
                      <MdSnippet text={c.snippet}
                        className="font-display text-small text-text-secondary line-clamp-4" />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : sourceStems.length > 0 ? (
          <>
            <div className="text-metadata font-mono uppercase text-text-muted mb-2 px-1">
              Tài liệu đã dùng ({sourceStems.length})
            </div>
            <div className="flex flex-col gap-1.5">
              {sourceStems.map((s, i) => (
                <div key={`${s}-${i}`} className="evidence-frame p-2.5 flex items-center gap-2">
                  <Icon name="FileText" size={13} className="text-slate flex-shrink-0" />
                  <span className="coord truncate" title={s}>{s}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-center px-5 pt-12 text-text-muted">
            <Icon name="Quote" size={26} className="mx-auto mb-3 text-text-muted opacity-60" />
            <p className="text-small text-text-secondary">
              Đặt một câu hỏi — nguồn dẫn chứng của câu trả lời sẽ hiện ở đây, khớp với các chú thích<sup className="cite-chip mx-0.5">n</sup>trong câu trả lời.
            </p>
          </div>
        )}
      </div>

      {/* ── ARTIFACTS — tạo từ tài liệu ──
          Gập được: khối này chiếm chỗ cố định ở đáy cột, gập lại thì danh sách
          bằng chứng phía trên được nguyên chiều cao. */}
      {legacyInspectorSurfacesEnabled && <div className="flex-shrink-0 border-t border-border">
        <Disclosure title="Tạo từ tài liệu">
        <div className="flex items-center gap-2 mb-2.5">
          <div className="flex gap-1 ml-auto">
            {ARTIFACTS.map((a) => (
              <button
                key={a.key}
                onClick={() => setArtifactTab(a.key)}
                className={`pill-tab--sub ${artifactTab === a.key ? "pill-tab-active" : ""}`}
                aria-pressed={artifactTab === a.key}
              >
                <Icon name={a.icon} size={13} /> {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* Độ dài tóm tắt — nằm trong content_hash BE: đổi mode = bản tóm tắt khác */}
        {artifactTab === "summary" && (
          <div className="flex gap-1 mb-2.5" role="radiogroup" aria-label="Độ dài tóm tắt">
            {LENGTH_MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setSummaryLength(m.value)}
                className={`pill-tab flex-1 !px-2 !py-1.5 justify-center ${summaryLength === m.value ? "pill-tab-active" : ""}`}
                role="radio"
                aria-checked={summaryLength === m.value}
                disabled={isGenerating}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        {/* Kiểu tóm tắt — standard (thường) vs study (ôn tập). Trực giao độ dài; cũng nằm
            trong content_hash BE nên đổi kiểu = bản tóm tắt khác. */}
        {artifactTab === "summary" && (
          <div className="flex gap-1 mb-2.5" role="radiogroup" aria-label="Kiểu tóm tắt">
            {SUMMARY_MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setSummaryMode(m.value)}
                className={`pill-tab flex-1 !px-2 !py-1.5 justify-center ${summaryMode === m.value ? "pill-tab-active" : ""}`}
                role="radio"
                aria-checked={summaryMode === m.value}
                disabled={isGenerating}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={onGenerate}
          disabled={isGenerating || !selectedSources?.length}
          className="btn-secondary w-full !py-2.5 inline-flex items-center justify-center gap-2"
        >
          {isGenerating ? (
            <><Spinner size={14} /> Đang tạo…</>
          ) : (
            <><Icon name="Plus" size={15} /> Tạo {artifactTab === "mindmap" ? "sơ đồ" : "tóm tắt"}</>
          )}
        </button>

        {/* Background-generation progress chip — dùng chung cho cả hai tab
            (jobUi/onCancelJob đã switch theo artifactTab ở phần Derived). */}
        {jobUi.running && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-[8px] border px-2.5 py-2 text-small"
            style={{ borderColor: stallShown ? "var(--warn)" : "var(--border-strong)", background: "var(--bg-elevated)" }}>
            <span className="animate-spin inline-block w-3.5 h-3.5 rounded-full border-2 border-t-transparent"
              style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} aria-hidden />
            <span className="flex-1 truncate text-text-secondary">
              {stallShown ? "Job có thể đang kẹt hoặc máy chủ đang bận." : jobUi.label}
              {typeof jobUi.progress === "number" ? ` (${jobUi.progress}%)` : ""}
            </span>
            {/* PR#8: stall → chọn Chờ tiếp (snooze cảnh báo, vẫn poll) hoặc Huỷ.
                KHÔNG auto-cancel, KHÔNG hard-timeout — job nền dài là bình thường. */}
            {stallShown && (
              <button onClick={dismissStall} className="text-small underline text-text-muted hover:text-accent">Chờ tiếp</button>
            )}
            <button onClick={onCancelJob} className="text-small underline text-text-muted hover:text-accent">Huỷ</button>
          </div>
        )}
        {!jobUi.running && cancelNotice && (
          <div className="mt-2 flex items-center gap-1.5 text-small text-text-muted">
            <Icon name="Ban" size={12} /> {cancelNoticeText}
          </div>
        )}
        {/* PR#8: job hỏng → đường phục hồi một-bấm với đúng params lần chạy trước.
            Không có context (chưa chạy lần nào trong phiên) → nút Tạo thường ở trên. */}
        {showRetry && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-[8px] border px-2.5 py-2 text-small"
            style={{ borderColor: "var(--warn)", background: "var(--bg-elevated)" }}>
            <Icon name="TriangleAlert" size={13} className="text-text-muted" aria-hidden />
            <span className="flex-1 truncate text-text-secondary">
              {artifactTab === "mindmap" ? "Tạo sơ đồ không thành công." : "Tạo tóm tắt không thành công."}
            </span>
            <button onClick={handleRetry} className="text-small underline text-text-muted hover:text-accent inline-flex items-center gap-1">
              <Icon name="RotateCcw" size={12} aria-hidden /> Thử lại
            </button>
          </div>
        )}

        {/* Saved list — KHÔNG tự giới hạn chiều cao + cuộn riêng nữa. Cột này đã có
            đúng một vùng cuộn ở trên (`flex-1 min-h-0 overflow-y-auto`); lồng thêm một
            vùng nữa làm người dùng không biết mình đang cuộn cái nào, và con lăn dừng
            đột ngột khi trỏ đi qua ranh giới. Một cột, một vùng cuộn. */}
        <div className="mt-3">
          {artifactTab === "mindmap" ? (
            initialLoading ? (
              <div className="flex items-center justify-center py-6 text-text-muted text-small gap-2"><Spinner size={14} /> Đang tải…</div>
            ) : loiTaiMindmap && mindMaps.length === 0 ? (
              <p className="text-small text-center py-4" style={{ color: "var(--err)" }}>
                {loiTaiMindmap}{" "}
                <button type="button" className="underline" onClick={fetchMindMaps}>Thử lại</button>
              </p>
            ) : mindMaps.length === 0 ? (
              <p className="text-small text-text-muted text-center py-4">Chưa có sơ đồ nào được lưu.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {mindMaps.map((map) => (
                  <ListCard key={map.id} icon="Network" title={map.title}
                    meta={`${map.sources?.length || 0} tài liệu · ${formatTimeAgo(map.createdAt || map.created_at)}`}
                    onOpen={() => setShowModalMap(map)} onDelete={() => handleDeleteMap(map.id)} deleteLabel="Xóa sơ đồ" />
                ))}
              </div>
            )
          ) : (
            dangTaiSummary ? (
              <div className="flex items-center justify-center py-6 text-text-muted text-small gap-2"><Spinner size={14} /> Đang tải…</div>
            ) : loiTaiSummary && summaries.length === 0 ? (
              <p className="text-small text-center py-4" style={{ color: "var(--err)" }}>
                {loiTaiSummary}{" "}
                <button type="button" className="underline" onClick={fetchSummaries}>Thử lại</button>
              </p>
            ) : summaries.length === 0 ? (
              <p className="text-small text-text-muted text-center py-4">Chưa có tóm tắt nào được lưu.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {summaries.map((item) => (
                  <ListCard key={item.id} icon="ScrollText" title={item.title || "Tóm tắt"}
                    meta={formatTimeAgo(item.created_at || item.createdAt)}
                    onOpen={() => setShowSummaryModal(item)} onDelete={() => handleDeleteSummary(item.id)} deleteLabel="Xóa tóm tắt" />
                ))}
              </div>
            )
          )}
        </div>
        </Disclosure>
      </div>}
      </>
      )}

      {guidedOpen && (
        <GuidedMindmapDialog
          sources={selectedSources}
          onClose={() => { setGuidedOpen(false); onGuidedClose?.(); }}
          onSubmit={submitGuidedMindmap}
          loading={loading}
          error={guidedError}
        />
      )}

      <style>{`@media (min-width: 768px) { .md\\:hidden { display: none !important; } }`}</style>
    </div>
  );
}
