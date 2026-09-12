// Shared building blocks between EvidenceDrawer (Phase 4, still used standalone
// by SummaryModal) and KnowledgeInspector (Phase 5). Extracted here so neither
// duplicates the other — Phase 5 Task 12 ("reuse EvidenceDrawer... do not
// duplicate components").
import { useEffect, useRef, useState, memo, useMemo } from "react";
import { Icon } from "../ui/Icon";
import Spinner from "../ui/Spinner";
import MdSnippet from "../ui/Markdown";
import { fetchChunkText } from "../../utils/api";

// Task 2 — one visual identity per semantic type (icon + Vietnamese label).
// Only reuses icons already in the app's Icon registry (src/components/ui/Icon.jsx)
// — no new icon imports.
export const SEMANTIC_META = {
  definition: { label: "Định nghĩa", icon: "BookOpen" },
  concept: { label: "Khái niệm", icon: "BookOpen" },
  rule: { label: "Quy tắc", icon: "Star" },
  formula: { label: "Công thức", icon: "Star" },
  example: { label: "Ví dụ", icon: "Quote" },
  note: { label: "Ghi chú", icon: "Pin" },
  warning: { label: "Lưu ý", icon: "TriangleAlert" },
  procedure: { label: "Quy trình", icon: "ScrollText" },
  question: { label: "Câu hỏi", icon: "HelpCircle" },
  answer: { label: "Trả lời", icon: "MessageCircleQuestion" },
  reference: { label: "Tham chiếu", icon: "Library" },
  table: { label: "Bảng", icon: "FileText" },
  figure: { label: "Hình", icon: "Image" },
  code: { label: "Mã", icon: "ScrollText" },
  exercise: { label: "Bài tập", icon: "Pencil" },
};
export const semanticMeta = (type) => SEMANTIC_META[type] || { label: "Nội dung", icon: "Tag" };

// UI/UX Polish Sprint A — one collapsible wrapper for every Inspector section
// (Definition/Key ideas/Examples/Notes/Warnings/Other/Evidence/Related), state
// persisted to localStorage so a collapsed section stays collapsed across
// node switches and reloads. Key scheme deliberately distinct from the other
// localStorage keys already in this app (`memvidx.panels.v1`,
// `memvidx.palette.history.v1`, `memvidx.palette.advanced.v1`).
const COLLAPSE_KEY = "memvidx.inspector.collapsed.v1";

function readCollapsed() {
  try {
    const raw = typeof window !== "undefined" && window.localStorage.getItem(COLLAPSE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch { return new Set(); }
}
function writeCollapsed(set) {
  try { window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set])); } catch { /* private mode/full — bỏ qua */ }
}

export function CollapsibleSection({ id, title, icon, count, defaultOpen = true, children }) {
  const [open, setOpen] = useState(() => {
    const collapsed = readCollapsed();
    return collapsed.has(id) ? false : defaultOpen;
  });
  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      const collapsed = readCollapsed();
      next ? collapsed.delete(id) : collapsed.add(id);
      writeCollapsed(collapsed);
      return next;
    });
  };
  return (
    <div className="pt-3 border-t border-border">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`insp-section-${id}`}
        className="w-full flex items-center gap-1.5 mb-2 text-left"
      >
        {icon && <Icon name={icon} size={12} className="text-text-muted flex-shrink-0" />}
        <span className="text-[10.5px] font-mono uppercase tracking-[0.1em] text-text-muted flex-1">{title}</span>
        {count != null && <span className="text-[10.5px] font-mono text-text-muted">{count}</span>}
        <Icon name="ChevronDown" size={12} className={`text-text-muted flex-shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div id={`insp-section-${id}`}>{children}</div>}
    </div>
  );
}

// Copy Quote / Copy Citation (Sprint A, item 4) — clipboard only, no backend.
// `navigator.clipboard` can reject (insecure context, permission) — callers
// get a boolean back and decide how to tell the user, never a thrown error.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text ?? ""));
    return true;
  } catch { return false; }
}
export function formatCitation({ text, sourceLabel, heading }) {
  const attribution = [sourceLabel, heading].filter(Boolean).join(" · ");
  return attribution ? `"${text}" — ${attribution}` : `"${text}"`;
}

// Skeleton loading (Sprint A, item 5) — replaces the old Spinner+"Đang tải…"
// for evidence text specifically (the thing that visibly takes a moment).
// `prefers-reduced-motion` is handled in mindmap.css (`.skel` pulse disabled
// there), not inline, so it stays in the one place the rest of this file's
// motion rules already live.
export function EvidenceSkeleton() {
  return (
    <div className="flex flex-col gap-1.5" role="status" aria-label="Đang tải trích đoạn">
      <div className="skel h-3 rounded-[3px]" style={{ width: "92%" }} />
      <div className="skel h-3 rounded-[3px]" style={{ width: "78%" }} />
      <div className="skel h-3 rounded-[3px]" style={{ width: "85%" }} />
    </div>
  );
}

export const MetaChip = ({ icon, children, title }) => (
  <span
    title={title}
    className="inline-flex items-center gap-1 text-[10.5px] font-mono text-text-muted px-1.5 py-0.5 rounded-[4px] border border-border"
  >
    {icon && <Icon name={icon} size={10} />} {children}
  </span>
);

// Task 8 — clamp long text visually instead of (a) overflowing or (b) blindly
// slicing the DATA. Full text always stays in the DOM — selectable, searchable,
// readable by assistive tech regardless of clamp state — only a CSS box height
// toggles. `clampable` hides the toggle when content never actually overflowed.
export function Clamp({ children, lines = 6 }) {
  const [open, setOpen] = useState(false);
  const [clampable, setClampable] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setClampable(el.scrollHeight - el.clientHeight > 2);
  });

  return (
    <div>
      <div
        ref={ref}
        style={open ? undefined : {
          display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}
      >
        {children}
      </div>
      {clampable && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-1 text-[11.5px] font-medium text-brand hover:underline"
        >
          {open ? "Thu gọn" : "Xem thêm"}
        </button>
      )}
    </div>
  );
}

// Task 10 — memoized so a poll-tick re-render of the parent (new `node` object,
// same content) doesn't re-render every card; each card only re-renders when
// its OWN entry actually changes.
export const EnrichmentCard = memo(function EnrichmentCard({ entry }) {
  const meta = semanticMeta(entry.semantic_type);
  const pct = Number.isFinite(entry.confidence) ? Math.round(entry.confidence * 100) : null;
  const body = [entry.short_explanation, entry.key_idea && `**Ý chính:** ${entry.key_idea}`]
    .filter(Boolean).join("\n\n");

  return (
    <div className="evidence-frame p-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-text-secondary px-1.5 py-0.5 rounded-[4px] border border-border">
          <Icon name={meta.icon} size={11} /> {meta.label}
        </span>
        {pct != null && <MetaChip title="Độ tin cậy của phần làm giàu này">{pct}%</MetaChip>}
      </div>
      {body && (
        <Clamp lines={5}>
          <MdSnippet text={body} className="font-display text-[13px] leading-[1.55] text-text-secondary" />
        </Clamp>
      )}
      {entry.important_facts?.length > 0 && (
        <ul className="mt-1.5 pl-4 list-disc text-[12.5px] text-text-secondary space-y-0.5">
          {entry.important_facts.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}
      {entry.memory_hint && (
        <p className="mt-1.5 text-[11.5px] italic text-text-muted">
          <Icon name="Zap" size={11} className="inline -mt-0.5 mr-1" /> {entry.memory_hint}
        </p>
      )}
    </div>
  );
});

// Chunk-text fetch/cache, shared by EvidenceDrawer and KnowledgeInspector so
// neither reimplements its own fetch-and-cache effect (this used to live only
// in EvidenceDrawer — Phase 5 lifted it out rather than copy it a second time).
// Cache is scoped to the CALLER's lifetime via `cacheRef` (a ref the caller
// owns and passes in), matching EvidenceDrawer's original per-drawer-instance
// cache contract.
export function useChunkEvidence(chunkRefs, cacheRef) {
  const [entries, setEntries] = useState([]); // [{ chunkId, text, loading, error }]
  const chunkKey = useMemo(
    () => (Array.isArray(chunkRefs) ? chunkRefs.filter((c) => c != null && c !== "").join(",") : ""),
    [chunkRefs]
  );

  useEffect(() => {
    const refs = chunkKey ? chunkKey.split(",") : [];
    let cancelled = false;

    if (refs.length === 0) { setEntries([]); return; }

    setEntries(refs.map((chunkId) => {
      const cached = cacheRef.current.get(chunkId);
      return cached !== undefined
        ? { chunkId, text: cached, loading: false, error: cached == null }
        : { chunkId, text: "", loading: true, error: false };
    }));

    refs.forEach(async (chunkId) => {
      if (cacheRef.current.has(chunkId)) return;
      try {
        const text = await fetchChunkText(chunkId);
        cacheRef.current.set(chunkId, text);
        if (cancelled) return;
        setEntries((prev) => prev.map((e) => (
          e.chunkId === chunkId ? { ...e, text, loading: false, error: text == null } : e
        )));
      } catch {
        if (cancelled) return;
        setEntries((prev) => prev.map((e) => (
          e.chunkId === chunkId ? { ...e, loading: false, error: true } : e
        )));
      }
    });

    return () => { cancelled = true; };
  }, [chunkKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return entries;
}

export const EvidenceCard = memo(function EvidenceCard({ entry, index, onAskAbout }) {
  return (
    <div className="evidence-frame p-3">
      <div className="flex items-center gap-2 mb-1.5">
        {/* Citation index badge — provenance, stays --seal (Signature Contract §1). */}
        <span
          className="w-5 h-5 rounded-[4px] inline-flex items-center justify-center text-[11px] font-mono font-semibold flex-shrink-0"
          style={{ color: "var(--seal)", border: "1px solid color-mix(in srgb, var(--seal) 35%, transparent)" }}
        >
          {index + 1}
        </span>
        <span className="coord truncate flex-1">Trích đoạn nguồn {index + 1}</span>
      </div>

      {entry.loading ? (
        <div className="flex items-center gap-2 text-[12px] text-text-muted py-1"><Spinner size={12} /> Đang tải…</div>
      ) : entry.error ? (
        <p className="text-[12.5px] text-text-muted italic">Không tải được trích đoạn này.</p>
      ) : (
        <>
          <Clamp lines={7}>
            <MdSnippet text={entry.text} className="font-display text-[13px] leading-[1.55] text-text-secondary" />
          </Clamp>
          {typeof onAskAbout === "function" && (
            <button
              onClick={() => onAskAbout(entry.text)}
              className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-brand hover:underline"
            >
              <Icon name="MessageCircleQuestion" size={12} /> Hỏi về đoạn này
            </button>
          )}
        </>
      )}
    </div>
  );
});
