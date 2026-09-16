import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { apiFetch, apiUrl, clearConversationContext, deleteConversation, resumeQuery, _appError, isNotFoundOrForbiddenError, isUnauthorizedError, getUserFriendlyApiError } from "../../utils/api";
import { newConversationId } from "../../utils/conversation";
import { cancelJob } from "../../utils/studyApi";
import { pollQueryStatus, shouldPollFallback } from "../../utils/queryPolling";
import { streamSse } from "../../utils/sseStream";
import { getToken } from "../../auth/tokenStore";
import { createPreviewThrottle } from "../../utils/streamPreview";
import { shouldFocusComposer, shouldRefocusComposer, shouldFocusOnSlash } from "../../utils/chatFocus";
import { Icon } from "../ui/Icon";
import { PROSE } from "../ui/Markdown";
import { useStudyContext } from "../../study/useStudyContext";
import { nodeLabel, processCitations, parseCiteHref, normStem, citeKey } from "../../utils/evidence";
import { pickImageFromClipboard, downscaleImage, transcribeImage, getVisionStatus, buildQuestionWithImage, IMAGE_TYPES } from "../../utils/chatImage";
import { QUERY_SSE_ERR_FALLBACK, ensureErrMsg, pickQueryDisplayText, sseErrorToMessage } from "../../utils/queryText";
import { computeReadyCount } from "../../utils/workspaceReadiness";
import { computeNextAction } from "../../utils/nextAction";

// ── Quick question chips (fill the composer; functional, not decorative) ──
// Generic fallback — used only when no source is selected yet (nothing to name).
const SUGGESTIONS_GENERIC = [
  "Các ý chính của tài liệu là gì?",
  "Tóm tắt nội dung chính.",
  "Giải thích khái niệm quan trọng nhất.",
];

// Product Experience Redesign, Question stage — JTBD + Priming (Growth.Design):
// a chip that already names the real selected document primes "ask about THIS"
// instead of a generic prompt the user has to mentally re-target. Real filenames
// only — never fabricated titles, honest per Hallmark's no-invented-content rule.
function buildSuggestions(selectedSources, sources) {
  const stems = Array.isArray(selectedSources) ? selectedSources : [];
  if (!stems.length) return SUGGESTIONS_GENERIC;
  const names = stems
    .map((stem) => sources.find((s) => (s.video_stem || s.video) === stem)?.filename)
    .filter(Boolean);
  if (!names.length) return SUGGESTIONS_GENERIC;
  const label = names.length > 1 ? `${names.length} tài liệu đã chọn` : names[0];
  return [
    `Tóm tắt ${label}.`,
    `Ý chính của ${label} là gì?`,
    `Khái niệm nào trong ${label} khó hiểu nhất?`,
  ];
}

// ── Markdown components for the answer prose ──────────
// Frontend V3 (Reading Experience, §1) — built on the shared PROSE base
// (ui/Markdown.jsx) instead of a near-duplicate set of p/ul/ol/blockquote/
// table renderers. This is a real, cited fix, not a style refresh: PROSE's
// own comments document that ChatArea's old blockquote carried a decorative
// `italic` on the whole block — exactly the "generic AI redesign" tell
// Sprint G already found and removed from every OTHER prose surface
// (SummaryPane). Only `a` genuinely needs to differ here (citation chips,
// [n](#cite:stem:chunkId)); everything else now renders through the same
// path the rest of the app already uses ("một đường render").
// Feature Pack A (Research Timeline) — `onEvidenceOpen` fires ONLY from a
// deliberate click/keypress, never from hover. Hover already drives
// `onHighlight` (transient, no record kept); logging that too would flood
// the timeline with every citation the cursor happened to pass over, not
// what the user actually opened (reviewed and agreed: evidence logs on
// click only).
function makeMdComponents({ highlight, onHighlight, onEvidenceOpen }) {
  return {
    ...PROSE,
    a: ({ node, href, children, ...props }) => {
      const cite = parseCiteHref(href);
      if (cite) {
        const active = highlight && normStem(highlight.stem) === normStem(cite.stem) && String(highlight.chunkId) === String(cite.chunkId);
        const open = () => { onHighlight?.(cite); onEvidenceOpen?.(cite); };
        return (
          <sup
            className={`cite-chip ${active ? "cite-chip--active" : ""}`}
            role="button"
            tabIndex={0}
            title={`Nguồn: ${cite.stem} · đoạn ${cite.chunkId}`}
            onMouseEnter={() => onHighlight?.(cite)}
            onMouseLeave={() => onHighlight?.(null)}
            onClick={open}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
          >
            {children}
          </sup>
        );
      }
      return <a href={href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2" {...props}>{children}</a>;
    },
  };
}

// ── Answer block (memo-light): runs citation pass once per content ──
// `dropCap` — the editorial opening-paragraph flourish (MdProse's own rule,
// reused via the same `.prose-drop-cap` class it defines in index.css).
// Applied to the FIRST answer of a session only, per that rule's own
// constraint ("use on ONE reading surface's first block, never repeated") —
// wired at the call site below, not decided in here.
function AnswerProse({ content, mdComponents, dropCap = false }) {
  const { md } = useMemo(() => processCitations(content), [content]);
  return (
    <div className={dropCap ? "font-display prose-drop-cap" : "font-display"}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={mdComponents}>{md}</ReactMarkdown>
    </div>
  );
}

export default function ChatArea({
  selectedSources, sources = [], onEvidence, highlight, onHighlight, onOpenLeft, askAboutDraft,
  // Feature Pack B (Cross Navigation) — Chat -> Summary. `hasSummary` gates a
  // real link, never a dead one; `onOpenSummary` reuses MainLayout's existing
  // workspaceMode switch (same shape as the pre-existing `onSwitchToChat`).
  hasSummary = false, onOpenSummary,
}) {
  // Feature Pack A (Research Timeline) — ChatArea never touched Study Context
  // before this; it's the one surface where the user's two most-timeline-
  // worthy actions (ask a question, open a citation) actually happen.
  const { selectQuestion, selectEvidence } = useStudyContext();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(() => newConversationId());
  // Conversation controls: kebab menu, a transient notice, and whether the AI is
  // currently using prior turns as context (hidden right after Clear context).
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [contextCleared, setContextCleared] = useState(false);
  // Goal banner collapse (IA pass round 5, item 4) — collapsed by default
  // once a conversation has an answer, click to re-expand.
  const [goalExpanded, setGoalExpanded] = useState(false);
  const [jobProgress, setJobProgress] = useState(0);
  const [seenNodes, setSeenNodes] = useState([]);
  const [streamingPreview, setStreamingPreview] = useState("");
  const [pendingReview, setPendingReview] = useState(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  // Ảnh dán vào khung gõ. Sống đúng một lượt gửi: đọc xong chữ là bỏ, không lưu.
  const [attachedImage, setAttachedImage] = useState(null);   // {file, previewUrl}
  const [transcribing, setTranscribing] = useState(false);
  const [visionReady, setVisionReady] = useState(false);
  // Chữ gợi ý trong ô nhập không đổi được bằng CSS, mà câu dài thì xuống dòng
  // rồi bị ô cao 46px xén mất. Nghe matchMedia thay vì đo lại mỗi lần cuộn.
  const [roomy, setRoomy] = useState(
    () => typeof window === "undefined" || window.matchMedia("(min-width: 640px)").matches
  );
  const imageInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const abortControllerRef = useRef(null);
  const cancelledRef = useRef(false);
  const eventSourceRef = useRef(null);
  const streamAccRef = useRef("");
  // Token gom trong streamAccRef; state chỉ flush qua throttle (tránh ReactMarkdown
  // re-parse toàn bộ text mỗi token — xem utils/streamPreview.js).
  const previewThrottleRef = useRef(null);

  // Feature Pack B — was a hand-rolled `${normStem(stem)}::${chunkId}`
  // template literal, duplicating `citeKey` (utils/evidence.js), which
  // already exists and is already this app's one canonical id shape for a
  // citation (used internally by `processCitations`). Now the actual same
  // function, not a second formula that happened to produce the same string
  // — SidebarRight's evidence-frame click (same pack) uses the same import.
  const handleEvidenceOpen = useCallback((cite) => {
    selectEvidence(citeKey(cite.stem, cite.chunkId), {
      source: "chat", label: `${cite.stem} · đoạn ${cite.chunkId}`,
    });
  }, [selectEvidence]);
  const mdComponents = useMemo(
    () => makeMdComponents({ highlight, onHighlight, onEvidenceOpen: handleEvidenceOpen }),
    [highlight, onHighlight, handleEvidenceOpen],
  );
  const suggestions = useMemo(() => buildSuggestions(selectedSources, sources), [selectedSources, sources]);
  // Structural refactor (Learning Canvas goal banner) — real readiness count,
  // same can_query/status data SidebarLeft's own badges already read, not an
  // invented multi-step "goal" flow. Shared, tested pure fn — see
  // utils/workspaceReadiness.js (LessonHeader/WorkspaceContainer use the
  // same one, was duplicated inline in both places before).
  const readyCount = useMemo(() => computeReadyCount(sources, selectedSources), [sources, selectedSources]);
  const nextAction = computeNextAction({ messagesCount: messages.length, selectedCount: selectedSources?.length || 0 });
  const focusComposer = useCallback(() => textareaRef.current?.focus(), []);
  // Feature epic M1 (Multi-Document Intelligence, mục 2) — names the real
  // contributing documents for a small set, same stem->filename resolution
  // `buildSuggestions` above already uses (not a second lookup convention).
  // Falls back to the raw stem when no matching source is found (never
  // fabricates a name), and to a plain count once there are too many to
  // read as a label — same threshold SummaryPane/KnowledgeInspector use.
  const sourcesLabel = useCallback((stems) => {
    const list = Array.isArray(stems) ? stems : [];
    if (!list.length) return "";
    const nameOf = (stem) => sources.find((s) => (s.video_stem || s.video) === stem)?.filename || stem;
    if (list.length <= 4) return list.length === 1 ? nameOf(list[0]) : list.map(nameOf).join(" · ");
    return `${list.length} nguồn`;
  }, [sources]);
  // First assistant answer only — the drop-cap is an "a reading surface begins
  // here" signal (MdProse's own rule), not a per-turn decoration.
  const firstAssistantIdx = useMemo(() => messages.findIndex((m) => m.role === "ai"), [messages]);

  // Stop any in-flight SSE stream / status-polling loop when the component unmounts
  // (cancelledRef is what pollQueryStatus checks each iteration).
  useEffect(() => () => {
    cancelledRef.current = true;
    try { eventSourceRef.current?.close(); } catch { /* already closed */ }
  }, []);

  const QUERY_TIMEOUT_MS = (() => {
    const raw = import.meta.env.VITE_QUERY_TIMEOUT_MS;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 10 * 60 * 1000;
    return Math.max(30_000, Math.min(60 * 60 * 1000, Math.floor(n)));
  })();

  // ── SSE streaming (logic unchanged; + node trace) ───
  const streamQueryJob = (jobId, { timeoutMs = QUERY_TIMEOUT_MS } = {}) =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      streamAccRef.current = "";
      setStreamingPreview("");
      previewThrottleRef.current?.cancel();
      const throttle = createPreviewThrottle(() => setStreamingPreview(streamAccRef.current));
      previewThrottleRef.current = throttle;
      if (eventSourceRef.current) { try { eventSourceRef.current.close(); } catch {} }

      // `fetch` + ReadableStream thay cho `EventSource`: EventSource không gửi được
      // header nên không đính được Bearer, và /query-stream gọi _require_app_user()
      // ngay dòng đầu — mọi kết nối đều 401 rồi tụt về polling, mất sạch token chảy
      // dần. `abort()` đóng vai trò `es.close()` cũ, nên ref vẫn giữ hình dạng đó.
      const ctrl = new AbortController();
      const es = { close: () => ctrl.abort() };
      eventSourceRef.current = es;

      const tick = setInterval(() => {
        if (cancelledRef.current) { clearInterval(tick); try { es.close(); } catch {} reject(new Error("CANCELLED")); }
        if (Date.now() - start > timeoutMs) {
          clearInterval(tick); try { es.close(); } catch {}
          reject(new Error(`Quá thời gian chờ phản hồi (~${Math.round(timeoutMs / 1000)}s). Vui lòng thử lại.`));
        }
      }, 500);

      const onMessage = (raw) => {
        try {
          const d = JSON.parse(raw);
          if (d.type === "token" && d.content) { streamAccRef.current += d.content; throttle.schedule(); }
          const isStatus = d.type === "status" || d.type == null;
          if (isStatus) {
            if (typeof d.progress === "number") setJobProgress(Math.max(0, Math.min(100, d.progress)));
            if (d.current_node) {
              const k = String(d.current_node);
              setSeenNodes((prev) => (prev[prev.length - 1] === k || prev.includes(k) ? prev : [...prev, k]));
            }
            if (d.status === "done") {
              clearInterval(tick); try { es.close(); } catch {}
              throttle.cancel();
              const streamed = streamAccRef.current; streamAccRef.current = ""; setStreamingPreview("");
              resolve({ result: d.result, streamed });
            } else if (d.status === "interrupted" && d?.result?.payload?.review?.type === "review") {
              clearInterval(tick); try { es.close(); } catch {}
              throttle.cancel();
              streamAccRef.current = ""; setStreamingPreview("");
              resolve({ result: d.result, streamed: "", interrupted: true });
            } else if (d.status === "error") {
              clearInterval(tick); try { es.close(); } catch {}
              throttle.cancel();
              streamAccRef.current = ""; setStreamingPreview("");
              const HARD = "Loi query SSE (status=error). Xem log server.";
              let msg = HARD;
              try { msg = ensureErrMsg(sseErrorToMessage(d.error), HARD); } catch { msg = HARD; }
              reject(new Error(String(msg || "").trim() || HARD));
            }
          }
        } catch {}
      };

      const token = getToken();
      streamSse(apiUrl(`/query-stream/${encodeURIComponent(jobId)}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: ctrl.signal,
        onEvent: onMessage,
      })
        .then(() => {
          // Luồng đóng mà chưa có khung status nào chốt job: coi như mất kết nối để
          // handleSend còn dùng lại đường polling, đúng như hành vi onerror cũ.
          clearInterval(tick);
          throttle.cancel();
          streamAccRef.current = ""; setStreamingPreview("");
          const e = new Error("Luồng realtime kết thúc sớm. Vui lòng thử lại.");
          e.sseConnectionLost = true;
          reject(e);
        })
        .catch((err) => {
          clearInterval(tick);
          throttle.cancel();
          streamAccRef.current = ""; setStreamingPreview("");
          if (cancelledRef.current || err?.name === "AbortError") {
            reject(new Error("CANCELLED"));
            return;
          }
          const e = new Error("Mất kết nối realtime (SSE). Vui lòng thử lại.");
          e.sseConnectionLost = true;
          e.cause = err;
          reject(e);
        });
    });

  const stemBaseLoose = (s) => String(s || "").trim().toLowerCase().replace(/_\d{8}_\d{6}$/, "");
  const hasIndexReadySources =
    selectedSources?.length > 0 &&
    sources.some((src) => {
      if (src.status !== "index_ready") return false;
      const key = src.video_stem || src.video;
      if (!selectedSources.includes(key)) return false;
      const b = stemBaseLoose(key);
      return !sources.some((o) => o.status === "ready" && (stemBaseLoose(o.video_stem || o.video) === b || (o.video_stem || o.video) === key));
    });

  const jobIdRef = useRef(null);

  const resetJobState = () => { setJobProgress(0); setSeenNodes([]); previewThrottleRef.current?.cancel(); setStreamingPreview(""); streamAccRef.current = ""; };

  // Huỷ ở đây là huỷ PHÍA MÁY BẠN, không phải phía máy chủ: BE chưa có route huỷ cho
  // job `query` (`_CANCELLABLE_JOB_TYPES` không có "query", và query_graph không gọi
  // `is_cancel_requested` ở đâu cả). Job vẫn chạy tới xong và vẫn giữ slot LLM duy
  // nhất. Nói "Đã huỷ truy vấn" là hứa một việc không xảy ra — người dùng bấm Huỷ rồi
  // hỏi câu mới và không hiểu vì sao phải chờ lâu.
  //
  // `prev.slice(0, -1)` cũng phải đi: lúc gửi chỉ tin nhắn NGƯỜI DÙNG được đẩy vào
  // (không có bong bóng AI giữ chỗ), nên nó xoá đúng câu hỏi vừa gõ.
  const handleCancel = async () => {
    if (pendingReview) return;
    cancelledRef.current = true;
    abortControllerRef.current?.abort();
    try { eventSourceRef.current?.close(); } catch {}
    resetJobState(); setLoading(false);
    setMessages((prev) => [...prev, { role: "cancelled", content: "Đang dừng truy vấn…" }]);

    const jid = jobIdRef.current;
    // `slice(0, -1)` ở đây AN TOÀN: nó xoá đúng dòng "Đang dừng truy vấn…" mà chính hàm
    // này vừa thêm. Bản trước vòng 8 slice khi chưa thêm gì nên xoá mất câu hỏi của
    // người dùng.
    const thay = (noiDung) =>
      setMessages((prev) => [...prev.slice(0, -1), { role: "cancelled", content: noiDung }]);
    if (!jid) {
      thay("Đã ngừng chờ câu trả lời.");
      return;
    }
    try {
      await cancelJob(jid);
      // Huỷ tới được ở ranh giới node, không cắt được node đang chạy (một request HTTP
      // tới Ollama). Nói đúng phạm vi thay vì hứa dừng tức thì.
      thay("Đã yêu cầu dừng truy vấn. Bước đang chạy sẽ kết thúc rồi job dừng hẳn.");
    } catch {
      thay("Đã ngừng chờ câu trả lời. Máy chủ vẫn chạy nốt truy vấn này, nên câu hỏi tiếp theo có thể phải đợi thêm một lúc.");
    }
  };

  // ── Conversation controls ───────────────────────────
  // Guarded while a query streams so we never rotate/clear mid-answer.
  const showNotice = (msg) => { setNotice(msg); setTimeout(() => setNotice(""), 4000); };

  // Sau khi đổi/xoá hội thoại, focus đang nằm trên nút vừa bấm (hoặc nút đó đã biến mất
  // cùng menu kebab) → trả về ô nhập để gõ câu tiếp theo ngay. Cảm ứng thì bỏ qua.
  const refocusComposer = () => {
    const ta = textareaRef.current;
    if (!ta || ta.disabled || isCoarsePointer()) return;
    ta.focus();
  };

  const handleNewChat = () => {
    if (loading || pendingReview) return;
    setMenuOpen(false);
    setSessionId(newConversationId());   // fresh thread, empty context (keeps selected sources)
    setMessages([]);
    setContextCleared(false);
    onEvidence?.(null); onHighlight?.(null);
    showNotice("Đã mở cuộc trò chuyện mới.");
    refocusComposer();
  };

  const handleClearContext = async () => {
    if (loading || pendingReview) return;
    setMenuOpen(false);
    setContextCleared(true);            // messages stay visible; AI stops using old turns
    refocusComposer();                  // trước await: nút vừa bấm đã biến mất cùng menu
    try {
      await clearConversationContext(sessionId);
      showNotice("Đã xóa ngữ cảnh. Câu hỏi tiếp theo sẽ được xử lý như chủ đề mới.");
    } catch {
      // `catch {}` rồi vẫn báo "Đã xóa" là báo cáo một việc chưa làm: cờ phía máy này
      // tắt ngữ cảnh, nhưng máy chủ vẫn giữ mốc cũ và lượt sau vẫn có thể dùng lại nó.
      setContextCleared(false);
      showNotice("Không xóa được ngữ cảnh trên máy chủ. Thử lại, hoặc mở cuộc trò chuyện mới.");
    }
  };

  const handleDeleteHistory = async () => {
    if (loading || pendingReview) return;
    setMenuOpen(false);
    if (!window.confirm("Xóa toàn bộ lịch sử chat của cuộc trò chuyện này? Hành động này không thể hoàn tác.")) return;
    try {
      await deleteConversation(sessionId);
    } catch {
      // Xoá hỏng mà vẫn dọn sạch khung chat là tệ nhất: người dùng tin đã xoá, còn máy
      // chủ vẫn giữ nguyên lịch sử và vẫn đưa nó vào ngữ cảnh lượt sau.
      showNotice("Không xóa được lịch sử chat trên máy chủ. Lịch sử vẫn còn, hãy thử lại.");
      return;
    }
    setMessages([]);
    setContextCleared(false);
    onEvidence?.(null); onHighlight?.(null);
    showNotice("Đã xóa lịch sử chat.");
    refocusComposer();
  };

  const usingContext = !contextCleared && messages.some((m) => m.role === "ai");

  const applyFinalQueryResult = (jobResult, streamedText = "") => {
    const data = jobResult?.payload || {};
    let aiContent = pickQueryDisplayText(jobResult, streamedText) || "Không có phản hồi.";
    if (data.processing_message) aiContent = `${data.processing_message}\n\n${aiContent}`;
    const evidence = {
      sources: Array.isArray(data.sources) ? data.sources : [],
      chunks: Array.isArray(data.chunks) ? data.chunks : [],
    };
    setMessages((prev) => [...prev, { role: "ai", content: aiContent, evidence }]);
    onEvidence?.(evidence);
  };

  const handleReview = async (action) => {
    if (!pendingReview || reviewSubmitting) return;
    if (action === "edit" && !String(pendingReview.answer || "").trim()) return;
    setReviewSubmitting(true);
    setLoading(true);
    try {
      await resumeQuery(pendingReview.jobId, { action, answer: pendingReview.answer });
      const result = await pollQueryStatus(pendingReview.jobId, {
        apiFetch,
        isCancelled: () => false,
        onStatus: (d) => {
          if (typeof d?.progress === "number") setJobProgress(Math.max(0, Math.min(100, d.progress)));
        },
      });
      applyFinalQueryResult(result);
      setPendingReview(null);
    } catch (err) {
      const content = (isUnauthorizedError(err) || isNotFoundOrForbiddenError(err))
        ? getUserFriendlyApiError(err)
        : ensureErrMsg(err?.message, "Không thể tiếp tục quy trình duyệt. Vui lòng thử lại.");
      showNotice(content);
    } finally {
      setReviewSubmitting(false);
      setLoading(false);
    }
  };

  // ── Send (logic unchanged; + evidence capture) ──────
  // ── Ảnh dán vào khung chat ───────────────────────────────────────────────
  // Hỏi một lần lúc mount: không có mô hình thị giác thì đừng hiện nút kèm ảnh,
  // mời người dùng làm việc chắc chắn hỏng còn tệ hơn là không mời.
  useEffect(() => {
    let alive = true;
    getVisionStatus().then((st) => { if (alive) setVisionReady(Boolean(st?.available)); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const onChange = (e) => setRoomy(e.matches);
    setRoomy(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Thu hồi object URL của ảnh trước, nếu không mỗi lần dán lại rò một blob.
  const attachImage = useCallback((file) => {
    if (!file) return;
    setAttachedImage((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return { file, previewUrl: URL.createObjectURL(file) };
    });
  }, []);

  const clearImage = useCallback(() => {
    setAttachedImage((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    if (imageInputRef.current) imageInputRef.current.value = "";
  }, []);

  useEffect(() => () => {
    if (attachedImage?.previewUrl) URL.revokeObjectURL(attachedImage.previewUrl);
  }, [attachedImage]);

  const handlePaste = useCallback((e) => {
    if (!visionReady || loading || pendingReview) return;
    const file = pickImageFromClipboard(e.clipboardData);
    if (!file) return;   // dán chữ thường thì để trình duyệt xử lý như cũ
    e.preventDefault();
    attachImage(file);
  }, [visionReady, loading, pendingReview, attachImage]);

  const handlePickImage = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) attachImage(file);
  }, [attachImage]);

  const handleSend = async () => {
    // Có ảnh thì cho gửi dù chưa gõ chữ — ảnh đã là câu hỏi.
    if ((!input.trim() && !attachedImage) || loading || pendingReview || transcribing) return;
    setContextCleared(false);          // a new question resumes using conversation context

    // Đọc ảnh TRƯỚC khi vào luồng hỏi: /query vẫn chỉ nhận chữ, đúng như cũ.
    let imageText = "";
    let imageName = "";
    if (attachedImage) {
      setTranscribing(true);
      try {
        const small = await downscaleImage(attachedImage.file);
        const read = await transcribeImage(small);
        imageText = String(read?.text || "").trim();
        imageName = attachedImage.file?.name || "ảnh dán";
      } catch (err) {
        setTranscribing(false);
        setMessages((prev) => [...prev, { role: "ai", content: getUserFriendlyApiError(err) }]);
        return;   // giữ nguyên ảnh và câu đang gõ để người dùng thử lại
      }
      setTranscribing(false);
    }

    const question = buildQuestionWithImage(input, imageText);
    const userMsg = {
      role: "user",
      content: input.trim() || "Giải thích nội dung trong ảnh này.",
      imageText,
      imageName,
    };
    setMessages((prev) => [...prev, userMsg]);
    // Feature Pack A (Research Timeline) — the moment a question is genuinely
    // submitted (not every keystroke, not a suggestion merely filled into the
    // composer), matching the other five select* actions' "log the action" rule.
    selectQuestion(userMsg.content, { source: "chat", label: userMsg.content });
    setInput("");
    clearImage();
    setLoading(true); resetJobState(); setSeenNodes(["Queued"]);
    onHighlight?.(null);
    cancelledRef.current = false;
    abortControllerRef.current = new AbortController();
    if (textareaRef.current) textareaRef.current.style.height = "44px";
    try {
      const payloadSources = Array.isArray(selectedSources)
        ? selectedSources.map((s) => (typeof s === "string" ? s : s.name || s.id || s))
        : undefined;
      const res = await apiFetch(`/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: question, sources: payloadSources?.length ? payloadSources : null, session_id: sessionId || undefined }),
        signal: abortControllerRef.current.signal,
      });
      if (!res.ok) throw await _appError(res);  // carries .status for 401/403/404 UX
      const startData = await res.json();
      if (!startData.job_id) throw new Error("Không nhận được job_id từ server.");
      const jobId = startData.job_id;
      jobIdRef.current = jobId;   // để nút Huỷ gọi được route huỷ thật
      let jobOutcome;
      try {
        jobOutcome = await streamQueryJob(jobId);
      } catch (streamErr) {
        // Phase F.1: EventSource can't send Bearer, so under protected mode the stream
        // 401s. Fall back to polling /query-status (apiFetch → authed). Real job
        // errors / timeouts / cancels propagate unchanged (no pointless polling).
        if (!shouldPollFallback(streamErr, { cancelled: cancelledRef.current })) throw streamErr;
        console.warn("SSE stream lost; falling back to /query-status polling");
        const result = await pollQueryStatus(jobId, {
          apiFetch,
          isCancelled: () => cancelledRef.current,
          onStatus: (d) => {
            if (typeof d?.progress === "number") setJobProgress(Math.max(0, Math.min(100, d.progress)));
            if (d?.current_node) {
              const k = String(d.current_node);
              setSeenNodes((prev) => (prev.includes(k) ? prev : [...prev, k]));
            }
          },
        });
        jobOutcome = { result, streamed: "" };
      }
      if (cancelledRef.current) return;
      const jobResult = jobOutcome?.result ?? jobOutcome;
      const streamedText = jobOutcome?.streamed ?? "";
      const review = jobResult?.payload?.review;
      if (review?.type === "review") {
        setPendingReview({ jobId, answer: String(review.answer || "") });
        setJobProgress((p) => Math.max(p, 90));
        return;
      }
      applyFinalQueryResult(jobResult, streamedText);
    } catch (err) {
      if (cancelledRef.current || err.name === "AbortError" || err.message === "CANCELLED") return;
      console.error("Query error:", err);
      // 401 also triggers a global redirect (apiFetch fired auth:unauthorized); show a
      // permission-safe line meanwhile. 403/404 map to friendly text (no raw JSON/id).
      const content = (isUnauthorizedError(err) || isNotFoundOrForbiddenError(err))
        ? getUserFriendlyApiError(err)
        : ensureErrMsg(err?.message, "Loi khi goi AI. Vui long thu lai.");
      setMessages((prev) => [...prev, { role: "ai", content, evidence: null }]);
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  };

  // `isComposing`: đang gõ tiếng Việt qua IME thì Enter là để CHỐT chữ đang soạn, không
  // phải để gửi — thiếu guard này là câu bị gửi giữa chừng lúc chưa xong từ.
  const handleKeyDown = (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };
  const handleInput = (e) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "44px";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  };
  const fillSuggestion = (q) => { setInput(q); textareaRef.current?.focus(); };

  // ── Focus UX ────────────────────────────────────────
  // Đọc sự thật DOM ở đây, quyết định để utils/chatFocus.js (thuần, test được).
  // matchMedia có thể vắng ở môi trường lạ → optional chain, mặc định false = coi như
  // chuột (an toàn hơn: sai hướng này chỉ là focus thừa, sai hướng kia là bàn phím ảo nhảy).
  const isCoarsePointer = () => window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const hasTextSelection = () => {
    const sel = window.getSelection?.();
    return Boolean(sel && !sel.isCollapsed);
  };

  // Click vào vùng trống của khung chat → nhảy vào ô nhập.
  // mouseUP chứ không phải click: bôi đen text rồi nhả chuột cũng phát sinh click, chỉ ở
  // mouseup mới đọc được selection đã hoàn tất để biết mà tránh cướp.
  const handlePanelMouseUp = (e) => {
    if (e.button !== 0) return;         // chuột phải mở context menu, không phải ý định gõ
    if (!shouldFocusComposer(e.target, {
      hasSelection: hasTextSelection(),
      coarsePointer: isCoarsePointer(),
      disabled: loading,
    })) return;
    textareaRef.current?.focus();
  };

  // Trả focus về ô nhập khi `loading` chuyển true → false: bao trọn CẢ 3 đường kết thúc
  // (stream done, polling fallback done, lỗi) vì tất cả đều đổ về `finally` của handleSend,
  // và cả huỷ (handleCancel). Không cần cắm hook riêng vào từng đường.
  // Phải là hiệu ứng theo TRANSITION, không phải `!loading`, nếu không mỗi lần render lại
  // lúc rảnh cũng giật focus.
  const prevLoadingRef = useRef(loading);
  useEffect(() => {
    const was = prevLoadingRef.current;
    prevLoadingRef.current = loading;
    if (!was || loading) return;
    const ta = textareaRef.current;
    if (!shouldRefocusComposer({
      activeElement: document.activeElement,
      body: document.body,
      composer: ta,
      coarsePointer: isCoarsePointer(),
    })) return;
    ta.focus();
  }, [loading]);

  // `/` nhảy vào ô nhập. Chat vẫn mount PHÍA DƯỚI mọi overlay nên không guard là gõ `/`
  // lúc đang mở sơ đồ/hộp thoại sẽ rơi xuống ô nhập bị che.
  // `[aria-modal="true"]` bắt Modal.jsx (SummaryModal); `.me-container` bắt overlay sơ đồ
  // (MindElixirView dựng overlay tay, không có role dialog).
  const focusFromSlash = useCallback((e) => {
    if (!shouldFocusOnSlash(e, {
      activeElement: document.activeElement,
      overlayOpen: Boolean(document.querySelector('[aria-modal="true"], .me-container')),
    })) return;
    const ta = textareaRef.current;
    if (!ta || ta.disabled) return;
    e.preventDefault();   // nếu không, ký tự "/" lọt vào ô ngay sau khi focus
    ta.focus();
  }, []);
  useEffect(() => {
    window.addEventListener("keydown", focusFromSlash);
    return () => window.removeEventListener("keydown", focusFromSlash);
  }, [focusFromSlash]);

  // Task 16 — "Hỏi về đoạn này" (mindmap EvidenceDrawer) prefills the composer.
  // Keyed on the whole draft object (not just `.text`) so asking about the
  // same snippet twice in a row still re-focuses/re-fills.
  useEffect(() => {
    if (!askAboutDraft?.text) return;
    setInput(askAboutDraft.text);
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "44px";
      ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
      ta.focus();
    }
  }, [askAboutDraft]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, streamingPreview]);

  const apparatusSteps = seenNodes.length ? seenNodes : ["Queued"];

  // ── Render ─────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0" style={{ background: "var(--bg-base)" }}>

      {/* Reading session — click vùng trống bất kỳ là vào thẳng ô nhập (xem handlePanelMouseUp) */}
      <div onMouseUp={handlePanelMouseUp}
        // KHÔNG dùng `co-the-cuon-them` ở đây: khung chat neo nội dung ở ĐÁY, tin mới nhất
        // nằm dưới cùng — dải mờ đáy sẽ làm mờ đúng câu trả lời vừa tới. Dải mờ chỉ
        // đúng cho danh sách neo từ trên xuống (hai cột bên).
        className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-8 py-7 flex flex-col gap-6">

        {/* In-flow conversation header (round 7): conversation controls
            (context indicator / New chat / kebab), transient notices, and
            the goal banner + next action all scroll away with content now —
            "only two persistent horizontal layers: global header,
            workspace toolbar" (strategy point 1). These used to be up to
            three separate always-pinned rows stacked under LessonHeader
            (conv-toolbar 32px + notice rows + goal banner up to ~96px);
            grouped into one block here so they read as a section, not
            scattered rows, and share ONE `gap-2` instead of each carrying
            its own duplicate top padding. */}
        <div className="flex flex-col gap-2 flex-shrink-0">
          <div className="flex items-center gap-2 h-8 -mx-5 sm:-mx-8 px-5 sm:px-8">
            {usingContext && (
              <span className="inline-flex items-center gap-1.5 text-caption font-mono text-text-muted">
                <Icon name="MessageSquare" size={12} className="text-accent" />
                Đang dùng ngữ cảnh cuộc trò chuyện
              </span>
            )}
            <div className="flex-1" />
            {/* Feature Pack B (Cross Navigation) — only when a summary genuinely
                exists (never a link to a surface that isn't there yet); reuses
                the exact same tab-switch MainLayout already exposes for "back to
                chat" from elsewhere, just the other direction. */}
            {hasSummary && (
              <button
                onClick={onOpenSummary}
                className="pill-action !py-1 !text-small"
                title="Xem bản tóm tắt của tài liệu đang chọn">
                <Icon name="ScrollText" size={13} /> Xem tóm tắt
              </button>
            )}
            <button
              onClick={handleNewChat} disabled={loading || Boolean(pendingReview)}
              className="pill-action !py-1 !text-small disabled:opacity-40"
              title="Bắt đầu cuộc trò chuyện mới">
              <Icon name="Plus" size={13} /> Chat mới
            </button>
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)} disabled={loading || Boolean(pendingReview)}
                className="icon-btn w-8 h-8 disabled:opacity-40"
                aria-label="Tùy chọn cuộc trò chuyện" aria-expanded={menuOpen}>
                <Icon name="MoreVertical" size={16} />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
                  <div className="absolute right-0 top-9 z-20 min-w-[190px] rounded-[8px] border py-1 shadow-card-hover"
                    style={{ borderColor: "var(--border-color)", background: "var(--bg-elevated)" }}>
                    <button onClick={handleClearContext} className="menu-item">
                      <Icon name="Eraser" size={14} /> Xóa ngữ cảnh
                    </button>
                    <button onClick={handleDeleteHistory} className="menu-item menu-item--danger">
                      <Icon name="Trash2" size={14} /> Xóa lịch sử chat
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Transient feedback (New chat / Clear context / Delete history) */}
          {notice && (
            <div className="-mx-5 sm:-mx-8 px-5 sm:px-8 py-1.5 text-small flex items-center gap-2 border-y"
              style={{ borderColor: "var(--border-color)", background: "color-mix(in srgb, var(--accent) 8%, transparent)", color: "var(--text-secondary)" }}>
              <Icon name="Info" size={13} className="text-accent" />
              <span>{notice}</span>
            </div>
          )}

          {/* Notice: sources still indexing */}
          {hasIndexReadySources && (
            <div className="-mx-5 sm:-mx-8 px-5 sm:px-8 py-2 text-small flex items-center gap-2 border-y"
              style={{ borderColor: "var(--border-color)", background: "color-mix(in srgb, var(--warn) 10%, transparent)", color: "var(--warn)" }}>
              <Icon name="Info" size={14} />
              <span>Một số tài liệu vẫn đang lập chỉ mục — câu trả lời có thể chưa đầy đủ.</span>
            </div>
          )}

          {/* Goal banner + next action (IA pass round 5, item 4). Real,
              derived content only — no per-user "learning objective" exists
              in this app's data model, so the banner states real readiness
              instead of an invented goal. Compact (44px) full form before
              any question; collapses to a slim single-line row (not hidden
              entirely — round 4's full-hide was a stricter interim fix for a
              real contradiction: this banner's copy is live-derived from
              selectedSources, which can lag behind reality right after a
              send, see docs/VISUAL_IDENTITY_WORKSPACE_REDESIGN.md) once a
              conversation has an answer, click to re-expand. */}
          {messages.length === 0 ? (
            <div className="flex items-center gap-3 rounded-control px-4 h-11"
              style={{ background: "var(--accent-subtle)" }}>
              <Icon name="Target" size={16} className="text-accent flex-shrink-0" />
              {selectedSources?.length > 0 ? (
                <p className="text-small text-text-secondary flex-1 truncate">
                  {readyCount}/{selectedSources.length} tài liệu đã chọn sẵn sàng tra cứu.
                  {readyCount < selectedSources.length && " Một số tài liệu vẫn đang lập chỉ mục."}
                </p>
              ) : (
                <p className="text-small text-text-secondary flex-1 truncate">
                  Chưa chọn tài liệu nào.
                </p>
              )}
              <button type="button" onClick={onOpenLeft} className="text-small font-medium text-accent flex-shrink-0">
                {selectedSources?.length > 0 ? "Sửa" : "Chọn tài liệu"}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setGoalExpanded((v) => !v)}
              className="flex items-center gap-2 rounded-control px-3 h-7 text-caption text-text-muted hover:text-text-secondary transition-colors self-start"
              aria-expanded={goalExpanded}>
              <Icon name="Target" size={12} className="text-accent flex-shrink-0" />
              {readyCount}/{selectedSources?.length || 0} tài liệu
              <Icon name={goalExpanded ? "ChevronUp" : "ChevronDown"} size={12} />
            </button>
          )}
          {messages.length > 0 && goalExpanded && (
            <div className="flex items-center gap-3 rounded-control px-4 h-11"
              style={{ background: "var(--accent-subtle)" }}>
              <p className="text-small text-text-secondary flex-1 truncate">
                {readyCount}/{selectedSources?.length || 0} tài liệu đã chọn sẵn sàng tra cứu.
              </p>
              <button type="button" onClick={onOpenLeft} className="text-small font-medium text-accent flex-shrink-0">Sửa</button>
            </div>
          )}

          {/* Next action — ONE contextual button, not a permanent 3-button
              strip: "Mind Map/Summary mode navigation must not be repeated as
              next-action buttons" — those two now live only as
              WorkspaceEmptyState's own CTA inside their own mode (previous
              commit), never duplicated here. Decision pulled into a real,
              tested pure function (utils/nextAction.js) instead of an inline
              ternary. */}
          {nextAction === "ask-question" && (
            <button type="button" onClick={focusComposer} className="btn-primary !text-small !py-1.5 self-start">
              <Icon name="Sparkles" size={14} /> Đặt câu hỏi
            </button>
          )}
          {nextAction === "select-sources" && (
            <button type="button" onClick={onOpenLeft} className="btn-primary !text-small !py-1.5 self-start">
              <Icon name="FileStack" size={14} /> Chọn tài liệu
            </button>
          )}
        </div>

        {/* Empty state — the reading-room thesis */}
        {messages.length === 0 && !loading && (
          <div className="flex-1 flex flex-col items-center justify-center text-center pb-16 animate-fadeUp max-w-[440px] mx-auto">
            <div className="font-mono text-metadata uppercase text-text-muted mb-4">Phòng đọc</div>
            <h1 className="font-display text-[26px] sm:text-[30px] leading-[1.2] font-semibold text-text-primary mb-3">
              Hỏi tài liệu của bạn — <span className="text-seal">kèm dẫn chứng</span>.
            </h1>
            <p className="font-display text-body-lg text-text-secondary mb-6">
              Mỗi câu trả lời được truy hồi từ tài liệu đã chọn và gắn nguồn ở lề phải. Chọn tài liệu bên trái, rồi đặt câu hỏi.
            </p>
            {selectedSources?.length > 0 ? (
              <div className="flex flex-wrap gap-2 justify-center">
                {suggestions.map((q) => (
                  <button key={q} onClick={() => fillSuggestion(q)} className="pill-action">{q}</button>
                ))}
              </div>
            ) : (
              <button onClick={onOpenLeft} className="md:hidden pill-action">
                <Icon name="Menu" size={14} /> Mở thư mục nguồn
              </button>
            )}
          </div>
        )}

        {/* Messages */}
        {messages.map((msg, idx) =>
          msg.role === "cancelled" ? (
            <div key={idx} className="self-center text-small font-mono text-text-muted flex items-center gap-2 py-1">
              <Icon name="Ban" size={13} /> {msg.content}
            </div>
          ) : msg.role === "user" ? (
            <div key={idx} className="self-end max-w-[78%]">
              <div className="px-4 py-2.5 text-body leading-relaxed rounded-[10px] rounded-br-[3px] border transition-theme"
                style={{ background: "var(--bg-elevated)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}>
                {msg.content}
              </div>
              {msg.imageText ? (
                /* Người học phải xem được máy đọc ra gì: đọc sai là kiểu hỏng số một,
                   và không thấy phần này thì câu trả lời lệch trông như model dốt. */
                <details className="mt-1.5 text-small rounded-[8px] border px-3 py-2"
                  style={{ borderColor: "var(--border-color)", background: "var(--bg-base)", color: "var(--text-secondary)" }}>
                  <summary className="cursor-pointer select-none inline-flex items-center gap-1.5 text-text-muted">
                    <Icon name="Image" size={12} />
                    Đã đọc từ ảnh{msg.imageName ? ` · ${msg.imageName}` : ""}
                  </summary>
                  <div className="mt-1.5 whitespace-pre-wrap">{msg.imageText}</div>
                </details>
              ) : null}
            </div>
          ) : (
            <div key={idx} className="self-start w-full max-w-[760px] flex flex-col gap-2 animate-fadeUp">
              <div className="flex items-center gap-2 text-metadata font-mono uppercase text-text-muted">
                <Icon name="BookOpen" size={13} className="text-accent" /> Trả lời
                {msg.evidence?.sources?.length ? (
                  <span className="text-text-muted">· {sourcesLabel(msg.evidence.sources)}</span>
                ) : null}
              </div>
              <div className="text-text-primary">
                <AnswerProse content={msg.content} mdComponents={mdComponents} dropCap={idx === firstAssistantIdx} />
              </div>
              {/* Product Experience Redesign, Question→Evidence handoff — Peak-End Rule:
                  the resting point of a reading turn (not mid-stream, not every turn)
                  gets a distinct settled marker instead of fading identically into the
                  next question. Real citation count only — no count means no claim.
                  Feature epic M1 — names the sources instead of just a count, when
                  the answer drew from more than one document: `evidence.sources` is
                  the SAME real, backend-returned array `onEvidence` already forwards
                  to the Evidence panel, not a new signal. */}
              {idx === messages.length - 1 && !loading && msg.evidence?.sources?.length > 0 && (
                <div className="flex items-center gap-1.5 text-caption font-mono text-text-muted pt-0.5">
                  {/* Success/settled marker (accent flip carve-out: forest
                      stays for success/ready/progress, not interactive). */}
                  <Icon name="BadgeCheck" size={12} className="text-forest" />
                  Đã trả lời với {sourcesLabel(msg.evidence.sources)} — xem chi tiết ở lề phải
                </div>
              )}
            </div>
          )
        )}

        {pendingReview && (
          <div className="self-start w-full max-w-[760px] animate-fadeUp">
            {/* Final sprint: "waiting for review" is an attention/warning
                state (HITL pause), not a brand/selection/provenance signal —
                was on `border-brand`/`text-brand` by default, migrated to
                `--warn` (inline style; no Tailwind `warn` utility exists yet,
                same as every other --warn consumer in this codebase). */}
            <div className="surface-card !p-4" style={{ borderColor: "color-mix(in srgb, var(--warn) 30%, transparent)" }}>
              <div className="text-metadata font-mono uppercase mb-2" style={{ color: "var(--warn)" }}>
                Chờ người dùng duyệt câu trả lời
              </div>
              <p className="text-small text-text-secondary mb-3">
                Kiểm tra bản nháp dưới đây. Có thể phê duyệt, chỉnh sửa rồi gửi lại, hoặc từ chối.
              </p>
              <textarea
                value={pendingReview.answer}
                onChange={(e) => setPendingReview((prev) => ({ ...prev, answer: e.target.value }))}
                disabled={reviewSubmitting}
                rows={7}
                className="w-full input-surface text-body resize-y min-h-[150px] mb-3 disabled:opacity-60"
                aria-label="Bản nháp câu trả lời cần duyệt"
              />
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={reviewSubmitting} onClick={() => handleReview("approve")}>Phê duyệt</button>
                <button className="pill-action" disabled={reviewSubmitting || !pendingReview.answer.trim()} onClick={() => handleReview("edit")}>Lưu bản chỉnh sửa</button>
                <button className="btn-danger" disabled={reviewSubmitting} onClick={() => handleReview("reject")}>Từ chối</button>
              </div>
            </div>
          </div>
        )}

        {/* Loading — the retrieval apparatus */}
        {loading && !pendingReview && (
          <div className="self-start w-full max-w-[760px] animate-fadeUp">
            <div className="surface-card !p-4">
              <div className="flex items-center justify-between text-metadata font-mono uppercase text-text-muted mb-3">
                <span>Bộ máy truy hồi</span>
                <span className="tabular-nums text-text-secondary">{Math.round(jobProgress)}%</span>
              </div>
              <div className="flex flex-col">
                {apparatusSteps.map((key, i) => {
                  const isActive = i === apparatusSteps.length - 1;
                  return (
                    <div key={`${key}-${i}`} className="apparatus-step">
                      <span className={`apparatus-dot ${isActive ? "apparatus-dot--active" : "apparatus-dot--done"}`} />
                      <span className={`text-small ${isActive ? "text-text-primary font-medium" : "text-text-secondary"}`}>{nodeLabel(key)}</span>
                    </div>
                  );
                })}
              </div>
              {streamingPreview && (
                <div className="mt-3 pt-3 border-t border-border font-display text-body text-text-primary max-h-[42vh] overflow-y-auto">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{streamingPreview}</ReactMarkdown>
                  {/* Streaming/in-progress cursor (accent flip carve-out:
                      forest stays for success/ready/progress). */}
                  <span className="inline-block w-0.5 h-4 bg-forest animate-pulse ml-0.5 align-middle rounded-sm" aria-hidden />
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── COMPOSER ── */}
      <div onMouseUp={handlePanelMouseUp}
        className="flex-shrink-0 border-t border-border transition-theme" style={{ background: "var(--bg-sidebar)" }}>
        {/* Follow-up suggestions */}
        {messages.length > 0 && !loading && !pendingReview && (
          <div className="px-4 sm:px-8 pt-3 pb-1 flex gap-2 overflow-x-auto scrollbar-none">
            {suggestions.map((q) => (
              <button key={q} onClick={() => fillSuggestion(q)} className="pill-action flex-shrink-0">{q}</button>
            ))}
          </div>
        )}

        {attachedImage && (
          <div className="px-4 sm:px-8 pt-3 -mb-1">
            <div className="inline-flex items-center gap-2.5 rounded-[9px] border px-2 py-2"
              style={{ borderColor: "var(--border-color)", background: "var(--bg-elevated)" }}>
              <img src={attachedImage.previewUrl} alt="Ảnh sắp gửi kèm câu hỏi"
                className="w-11 h-11 object-cover rounded-[6px] border"
                style={{ borderColor: "var(--border-color)" }} />
              <div className="text-small leading-tight">
                <div className="text-text-primary">
                  {transcribing ? "Đang đọc ảnh…" : "Ảnh sẽ được đọc trước khi hỏi"}
                </div>
                <div className="text-text-muted">{Math.round((attachedImage.file?.size || 0) / 1024)} KB</div>
              </div>
              <button type="button" onClick={clearImage} disabled={transcribing}
                className="icon-btn w-7 h-7 disabled:opacity-40" aria-label="Bỏ ảnh đính kèm">
                <Icon name="X" size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Resting height 56-64px (IA pass round 5, item 5): tightened outer
            padding, textarea min-height brought closer to the 40-44px send
            button instead of a taller independent 46px. Attachment button
            moved INSIDE the same input-surface as the textarea (one shared
            border, not two separate bordered elements) — "integrate
            attachment into input area". Max-height capped to ~4 lines
            (was 140px, roughly 6-7 lines). */}
        <div className="px-3 sm:px-6 py-2.5 sm:py-3 flex items-end gap-2 sm:gap-3">
          <div className="flex-1 relative flex items-end input-surface !p-0 gap-1">
            {visionReady && (
              <>
                <input ref={imageInputRef} type="file" className="hidden"
                  accept={IMAGE_TYPES.join(",")} onChange={handlePickImage} />
                <button type="button" onClick={() => imageInputRef.current?.click()}
                  disabled={loading || Boolean(pendingReview) || transcribing}
                  className="w-9 h-9 my-auto ml-1 flex-shrink-0 rounded-control inline-flex items-center justify-center text-text-muted hover:text-accent hover:bg-surface-hover transition-colors disabled:opacity-40"
                  aria-label="Đính kèm ảnh" title="Đính kèm ảnh, hoặc dán thẳng vào ô nhập">
                  <Icon name="ImagePlus" size={17} />
                </button>
              </>
            )}
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder={pendingReview ? "Hãy hoàn tất bước duyệt câu trả lời…" : transcribing ? "Đang đọc ảnh…" : loading ? "Đang chờ phản hồi…" : visionReady && roomy ? "Đặt câu hỏi, hoặc dán ảnh đề bài vào đây…"
              : !roomy ? "Đặt câu hỏi…" : "Đặt câu hỏi về tài liệu đã chọn…"}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              disabled={loading || Boolean(pendingReview) || transcribing}
              className="w-full bg-transparent outline-none text-body resize-none min-h-[40px] max-h-[112px] px-3 py-2.5 disabled:opacity-60"
              style={{ lineHeight: 1.55 }}
            />
          </div>

          {loading && !pendingReview ? (
            <button
              onClick={handleCancel}
              className="btn-danger w-10 h-10 !p-0 rounded-[9px] inline-flex items-center justify-center flex-shrink-0"
              aria-label="Huỷ truy vấn" title="Huỷ"
            >
              <Icon name="Square" size={15} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={(!input.trim() && !attachedImage) || Boolean(pendingReview) || transcribing}
              className="btn-primary w-10 h-10 !p-0 rounded-[9px] inline-flex items-center justify-center flex-shrink-0"
              aria-label="Gửi câu hỏi"
            >
              <Icon name="Send" size={16} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      <style>{`
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }
        @media (min-width: 768px) { .md\\:hidden { display: none !important; } }
        .menu-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 12px;
          font-size: 13px; color: var(--text-primary); background: transparent; text-align: left; }
        .menu-item:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
        .menu-item--danger { color: var(--err); }
        .menu-item--danger:hover { background: color-mix(in srgb, var(--err) 12%, transparent); }
      `}</style>
    </div>
  );
}
