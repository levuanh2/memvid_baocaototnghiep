// Evidence drawer — right-side sliding panel. Still used standalone by
// SummaryModal (citation margin for tóm tắt). The mindmap's own node-click
// experience moved to the permanent KnowledgeInspector in Phase 5 — this
// file stays as the drawer-shaped variant, sharing every card/clamp/fetch
// piece with it via `knowledgeParts.jsx` (Phase 5 Task 12: reuse, don't
// duplicate).
import { useEffect, useRef, useMemo } from "react";
import { Icon } from "../ui/Icon";
import MdSnippet from "../ui/Markdown";
import { Clamp, MetaChip, EnrichmentCard, EvidenceCard, useChunkEvidence } from "./knowledgeParts";

export default function EvidenceDrawer({ node, onClose, generating, onAskAbout, sources }) {
  const panelRef = useRef(null);
  const closeBtnRef = useRef(null);
  const cacheRef = useRef(new Map());
  // Always holds the latest `node` — read at Escape-keydown time so the listener
  // effect below doesn't need `node` in its own deps (see that effect's comment).
  const nodeRef = useRef(node);
  nodeRef.current = node;

  const entries = useChunkEvidence(node?.chunkRefs, cacheRef);

  // Focus the close button ONLY when the drawer newly opens or the selected
  // node actually changes (deps [node?.id]) — not on every re-render a poll
  // tick causes. Previously this ran on every `node` identity change (every
  // tick), yanking keyboard focus to the close button even while the user
  // was hovering/interacting elsewhere on the canvas.
  useEffect(() => {
    if (node?.id == null) return;
    closeBtnRef.current?.focus();
  }, [node?.id]);

  // Esc-to-close: a SEPARATE effect from the focus one above, deps [onClose]
  // alone. `onClose` is expected to be a stable identity, so this listener is
  // attached once and never torn down/rebuilt purely because a poll tick
  // re-rendered the parent. Whether the drawer is actually open is checked at
  // KEYDOWN time via `nodeRef` (always the latest `node`).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && nodeRef.current) { e.stopPropagation(); onClose?.(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const enrichment = Array.isArray(node?.enrichment) ? node.enrichment : [];
  const sourceLabel = useMemo(() => {
    const list = Array.isArray(sources) ? sources : [];
    if (list.length === 1) return list[0];
    if (list.length > 1) return `${list.length} tài liệu`;
    return null;
  }, [sources]);
  const avgConfidencePct = useMemo(() => {
    const vals = enrichment.map((e) => e.confidence).filter((c) => Number.isFinite(c));
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100);
  }, [enrichment]);

  if (!node) return null;

  const emptyMessage = generating
    ? "Chưa có bằng chứng — đang làm giàu"
    : "Nhánh này chưa gắn trích đoạn";
  const nothingAtAll = entries.length === 0 && enrichment.length === 0;

  return (
    <div
      className="absolute inset-0 z-20 flex justify-end"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={`Bằng chứng cho ${node.title || "nhánh"}`}
        className="evidence-drawer h-full w-full max-w-[380px] flex flex-col border-l border-border shadow-card-hover animate-drawerIn"
        style={{ background: "var(--bg-sidebar)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2 px-4 py-3.5 border-b border-border flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-metadata font-mono uppercase text-text-muted mb-1">Bằng chứng</div>
            <h3 className="font-display font-semibold text-text-primary text-body truncate" title={node.title}>
              {node.title || "Nhánh"}
            </h3>
            {(node.number || sourceLabel || avgConfidencePct != null) && (
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {node.number && <MetaChip>{node.number}</MetaChip>}
                {sourceLabel && <MetaChip icon="FileStack" title="Nguồn tài liệu">{sourceLabel}</MetaChip>}
                {avgConfidencePct != null && (
                  <MetaChip icon="BadgeCheck" title="Độ tin cậy trung bình của phần làm giàu">{avgConfidencePct}%</MetaChip>
                )}
              </div>
            )}
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            className="icon-btn w-8 h-8 flex-shrink-0"
            aria-label="Đóng lề bằng chứng"
            title="Đóng (Esc)"
          >
            <Icon name="X" size={15} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5">
          {node.note && (
            <MdSnippet text={node.note}
              className="font-display text-body text-text-secondary mb-4 pb-4 border-b border-border" />
          )}

          {nothingAtAll ? (
            <div className="text-center px-2 pt-8 text-text-muted">
              <Icon name="Quote" size={22} className="mx-auto mb-2.5 opacity-60" />
              <p className="text-small text-text-secondary">{emptyMessage}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {enrichment.length > 0 && (
                <div className="flex flex-col gap-2 mb-1" role="group" aria-label="Nội dung được làm giàu">
                  {enrichment.map((entry) => (
                    <EnrichmentCard key={entry.semantic_node_id} entry={entry} />
                  ))}
                </div>
              )}
              {entries.length > 0 && (
                <div className="flex flex-col gap-2" role="group" aria-label="Trích đoạn nguồn">
                  {entries.map((entry, i) => (
                    <EvidenceCard key={`${entry.chunkId}-${i}`} entry={entry} index={i} onAskAbout={onAskAbout} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes drawerIn { from { transform: translateX(16px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .animate-drawerIn { animation: drawerIn 180ms ease-out both; }
        @media (prefers-reduced-motion: reduce) { .animate-drawerIn { animation: none !important; } }
      `}</style>
    </div>
  );
}
