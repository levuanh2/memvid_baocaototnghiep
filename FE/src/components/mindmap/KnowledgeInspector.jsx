// Knowledge Inspector — Phase 5, UI/UX Polish Sprint A. Permanent right-side
// panel (NOT a modal, NOT a drawer, NOT floating): mounted once alongside the
// mind-elixir canvas in MindElixirView and stays on screen for the whole time
// the MindMap is open. Clicking a node only ever changes THIS component's
// props — the canvas is a sibling, never remounted, never re-diffed for this.
//
// Sprint A layout change: the panel is now a 5-row CSS Grid (`.knowledge-
// inspector` in mindmap.css) — nav bar / recent-pinned / node header / ONE
// scrollable content row / AI Actions footer. Only the content row scrolls;
// header and footer never move, and long evidence can no longer push the
// footer off-screen (that was the exact bug Sprint A's audit flagged).
//
// Every card/clamp/fetch/collapse primitive here is imported from
// `knowledgeParts.jsx`, shared with EvidenceDrawer — nothing in this file
// duplicates that logic (Task 12).
import { useRef, useMemo, useState, useCallback } from "react";
import { Icon } from "../ui/Icon";
import MdSnippet from "../ui/Markdown";
import { toast } from "../ui/Toaster";
import {
  Clamp, MetaChip, EnrichmentCard, CollapsibleSection, EvidenceSkeleton,
  useChunkEvidence, semanticMeta, copyText, formatCitation,
} from "./knowledgeParts";

// Task 5 — every action reuses the SAME existing chat pipeline (`onAskAI`,
// wired by the caller to the app's existing `askDirect` composer-prefill —
// see docs/KNOWLEDGE_WORKSPACE.md §Learning Actions). No new AI endpoint.
const ACTIONS = [
  { key: "simpler", label: "Giải thích đơn giản hơn", icon: "MessageSquareText",
    build: (t) => `Hãy giải thích "${t}" đơn giản hơn, dễ hiểu hơn.` },
  { key: "deeper", label: "Giải thích sâu hơn", icon: "Sparkles",
    build: (t) => `Hãy giải thích "${t}" sâu hơn, chi tiết hơn, kèm ví dụ nếu có.` },
  { key: "flashcard", label: "Tạo flashcard", icon: "BookOpen",
    build: (t) => `Hãy tạo flashcard (câu hỏi - đáp án) để ôn tập nội dung "${t}".` },
  { key: "quiz", label: "Kiểm tra tôi", icon: "HelpCircle",
    build: (t) => `Hãy đặt vài câu hỏi kiểm tra kiến thức về "${t}" để tôi tự trả lời.` },
  { key: "examples", label: "Thêm ví dụ", icon: "Quote",
    build: (t) => `Hãy cho thêm ví dụ minh hoạ cho "${t}".` },
  { key: "ask", label: "Hỏi AI về khái niệm này", icon: "MessageCircleQuestion",
    build: (t) => `Về "${t}": ` },
];

const RelatedPill = ({ item, onNavigate, icon }) => !item ? null : (
  <button
    type="button"
    onClick={() => onNavigate(item.id)}
    className="inline-flex items-center gap-1 text-caption px-2 py-1 rounded-[6px] border border-border text-text-secondary hover:border-[var(--accent)] hover:text-text-primary transition-colors max-w-full"
  >
    {icon && <Icon name={icon} size={11} className="flex-shrink-0" />}
    {item.number && <span className="font-mono text-caption text-text-muted flex-shrink-0">{item.number}</span>}
    <span className="truncate">{item.title || "(không tên)"}</span>
  </button>
);

// Sprint A item 3 — Source/Heading chips moved OUT of this card (now rendered
// ONCE per section, above the list — see the "Bằng chứng" section below).
// Sprint A item 4 — Copy quote / Copy citation, clipboard-only.
// Sprint A item 5 — skeleton instead of spinner while `text` loads.
// Product Experience Redesign, Evidence stage — restructured Claim → Supporting
// evidence → Confidence, per the user's explicit target shape. `claim` and
// `confidencePct` are both real data already computed by the caller (node title,
// node-level average confidence) — no per-citation confidence exists in the
// pipeline yet, so this does not fabricate a number finer-grained than what was
// actually measured (Hallmark honest-copy rule).
function CitationCard({ chunkId, text, loading, error, index, sourceLabel, heading, claim, confidencePct, highlighted, onToggleHighlight }) {
  const copyQuote = async () => {
    const ok = await copyText(text);
    toast(ok ? "Đã sao chép trích đoạn" : "Không sao chép được", { type: ok ? "success" : "error" });
  };
  const copyCitation = async () => {
    const ok = await copyText(formatCitation({ text, sourceLabel, heading }));
    toast(ok ? "Đã sao chép trích dẫn" : "Không sao chép được", { type: ok ? "success" : "error" });
  };
  return (
    <div className={`evidence-frame p-3 ${highlighted ? "ring-1 ring-[var(--seal)]" : ""}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        {/* Citation index badge — provenance, stays --seal (Signature Contract §1),
            same reasoning as .cite-chip/.evidence-frame--active in index.css. */}
        <span
          className="w-5 h-5 rounded-[4px] inline-flex items-center justify-center text-caption font-mono font-semibold flex-shrink-0"
          style={{ color: "var(--seal)", border: "1px solid color-mix(in srgb, var(--seal) 35%, transparent)" }}
        >
          {index + 1}
        </span>
        <div className="flex-1" />
        {!loading && !error && (
          <>
            <button type="button" onClick={copyQuote} className="icon-btn w-6 h-6" title="Sao chép trích đoạn" aria-label="Sao chép trích đoạn">
              <Icon name="ScrollText" size={12} />
            </button>
            <button type="button" onClick={copyCitation} className="icon-btn w-6 h-6" title="Sao chép trích dẫn" aria-label="Sao chép trích dẫn">
              <Icon name="Quote" size={12} />
            </button>
          </>
        )}
        <button type="button" onClick={onToggleHighlight} aria-pressed={highlighted}
          className="icon-btn w-6 h-6" title="Đánh dấu trích đoạn này" aria-label="Đánh dấu trích đoạn này">
          <Icon name="Pin" size={12} />
        </button>
      </div>
      {claim && (
        <div className="text-caption font-mono uppercase text-text-muted mb-1">
          Hỗ trợ cho · <span className="normal-case font-sans">{claim}</span>
        </div>
      )}
      {loading ? (
        <EvidenceSkeleton />
      ) : error ? (
        <p className="text-small text-text-muted italic">Không tải được trích đoạn này.</p>
      ) : (
        <>
          <Clamp lines={7}>
            <MdSnippet text={text} className="font-display text-small text-text-secondary" />
          </Clamp>
          {confidencePct != null && (
            <div className="mt-1.5 pt-1.5 border-t border-border flex items-center gap-1.5 text-caption text-text-muted">
              <Icon name="BadgeCheck" size={11} className="text-forest flex-shrink-0" />
              Độ tin cậy trung bình của nhánh: {confidencePct}%
            </div>
          )}
        </>
      )}
    </div>
  );
}

const BUCKET_META = {
  definition: { title: "Định nghĩa", icon: "BookOpen" },
  keyIdeas: { title: "Ý chính", icon: "Sparkles" },
  example: { title: "Ví dụ", icon: "Quote" },
  note: { title: "Ghi chú", icon: "Pin" },
  warning: { title: "Lưu ý", icon: "TriangleAlert" },
  other: { title: "Nội dung khác", icon: "Tag" },
};

export default function KnowledgeInspector({
  node, relations, breadcrumb, documentTitle, sources, generating,
  onNavigate, onAskAI, onOpenSource, nav,
}) {
  const cacheRef = useRef(new Map()); // session-lifetime — Inspector no longer unmounts per click (Task 1)
  const [highlightedIds, setHighlightedIds] = useState(() => new Set());
  const toggleHighlight = useCallback((chunkId) => {
    setHighlightedIds((prev) => {
      const next = new Set(prev);
      next.has(chunkId) ? next.delete(chunkId) : next.add(chunkId);
      return next;
    });
  }, []);

  const evidence = useChunkEvidence(node?.chunkRefs, cacheRef);

  const enrichment = Array.isArray(node?.enrichment) ? node.enrichment : [];
  const buckets = useMemo(() => {
    const by = (types) => enrichment.filter((e) => types.includes(e.semantic_type));
    const keyIdeas = [...new Set(enrichment.map((e) => e.key_idea).filter(Boolean))];
    const known = new Set(["definition", "concept", "rule", "formula", "example", "note", "warning"]);
    return {
      definition: by(["definition", "concept", "rule", "formula"]),
      keyIdeas,
      example: by(["example"]),
      note: by(["note"]),
      warning: by(["warning"]),
      other: enrichment.filter((e) => !known.has(e.semantic_type)),
    };
  }, [enrichment]);

  // Feature epic M1 (Multi-Document Intelligence) — when a mindmap was
  // generated from a small number of sources, name them (real data, already
  // on the record's own `sources` array — no per-node attribution exists to
  // go further than this whole-mindmap level, see docs/MULTI_DOCUMENT_WORKSPACE.md).
  // A larger set falls back to the count, same as before — a title-length
  // list of 8 stems is noise, not provenance.
  const sourceLabel = useMemo(() => {
    const list = Array.isArray(sources) ? sources : [];
    if (list.length === 1) return list[0];
    if (list.length > 1 && list.length <= 4) return list.join(" · ");
    if (list.length > 4) return `${list.length} tài liệu`;
    return null;
  }, [sources]);
  const avgConfidencePct = useMemo(() => {
    const vals = enrichment.map((e) => e.confidence).filter((c) => Number.isFinite(c));
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100);
  }, [enrichment]);
  const dominantType = enrichment[0]?.semantic_type ? semanticMeta(enrichment[0].semantic_type) : null;

  // Row 1 — nav bar. Chrome, not per-node content: visible whether or not a
  // node is selected, so selection history is always legible.
  const navBar = (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-border">
      <button aria-label="Quay lại" disabled={!nav.canBack} onClick={nav.onBack}
        className="icon-btn w-7 h-7 disabled:opacity-30 disabled:pointer-events-none">
        <Icon name="ArrowLeft" size={14} />
      </button>
      <button aria-label="Đi tiếp" disabled={!nav.canForward} onClick={nav.onForward}
        className="icon-btn w-7 h-7 disabled:opacity-30 disabled:pointer-events-none">
        <Icon name="ArrowRight" size={14} />
      </button>
      <span className="text-metadata font-mono uppercase text-text-muted ml-1 truncate">
        Trình khám phá tri thức
      </span>
      <div className="flex-1" />
      {node && (
        <button aria-pressed={nav.isPinned} onClick={nav.onTogglePin}
          aria-label={nav.isPinned ? "Bỏ ghim nhánh này" : "Ghim nhánh này"}
          title={nav.isPinned ? "Bỏ ghim" : "Ghim"} className="icon-btn w-7 h-7">
          <Icon name="Pin" size={14} style={{ opacity: nav.isPinned ? 1 : 0.45 }} />
        </button>
      )}
    </div>
  );

  // Row 2 — recent/pinned chips. Empty content, still a real grid row (fixed
  // 5-row grid, see mindmap.css comment) so it never steals another row's slot.
  const recentPinnedRow = (nav.pinned.length > 0 || nav.recent.length > 0) ? (
    <div className="px-3 py-2 border-b border-border flex flex-col gap-1.5">
      {nav.pinned.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Icon name="Pin" size={10} className="text-text-muted flex-shrink-0" />
          {nav.pinned.map((p) => <RelatedPill key={p.id} item={p} onNavigate={onNavigate} />)}
        </div>
      )}
      {nav.recent.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Icon name="Clock" size={10} className="text-text-muted flex-shrink-0" />
          {nav.recent.map((r) => <RelatedPill key={r.id} item={r} onNavigate={onNavigate} />)}
        </div>
      )}
    </div>
  ) : null;

  // Row 3 — sticky node header (title/breadcrumb/chips). Task 2: separate
  // chips, never one text blob.
  const nodeHeader = node ? (
    <div className="px-4 py-3 border-b border-border">
      <h3 className="font-display font-semibold text-text-primary text-body-lg leading-snug mb-1.5">
        {node.title || "Nhánh"}
      </h3>
      {breadcrumb?.length > 0 && (
        <div className="text-caption text-text-muted mb-1.5 truncate">
          {documentTitle ? `${documentTitle} › ` : ""}
          {breadcrumb.map((b) => b.title).join(" › ")}
        </div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        {node.number && <MetaChip>{node.number}</MetaChip>}
        {node.level > 0 && <MetaChip icon="Network" title="Cấp tiêu đề">Cấp {node.level}</MetaChip>}
        {dominantType && <MetaChip icon={dominantType.icon}>{dominantType.label}</MetaChip>}
        {avgConfidencePct != null && <MetaChip icon="BadgeCheck" title="Độ tin cậy trung bình">{avgConfidencePct}%</MetaChip>}
        {node.chunkRefs?.length > 0 && <MetaChip icon="Quote" title="Số trích dẫn">{node.chunkRefs.length}</MetaChip>}
        {/* M2.5 — deterministic provenance (source_stems, BE/services/provenance.py).
            Renders ONCE for the selected node here, never repeated per Evidence
            card below (that would be the same claim restated N times for no
            reason). Absent means unresolved — render nothing, no "Unknown
            document" filler, no guess. */}
        {node.sourceStems?.length > 0 && (
          <MetaChip icon="FileStack" title="Nguồn xác định">
            Nguồn: {node.sourceStems.join(" · ")}
          </MetaChip>
        )}
      </div>
    </div>
  ) : null;

  const hasRelations = relations.parent || relations.children.length > 0 || relations.prev || relations.next || relations.siblings.length > 0;

  // Row 4 — the ONE scrolling region.
  const content = !node ? (
    <div className="h-full flex items-center justify-center text-center px-6">
      <div>
        <Icon name="Network" size={26} className="mx-auto mb-2.5 opacity-50 text-text-muted" />
        <p className="text-small text-text-secondary">Chọn một nhánh trên sơ đồ để xem chi tiết.</p>
      </div>
    </div>
  ) : (
    <div className="px-4 pb-3.5">
      {node.note && (
        <div className="pt-3">
          <MdSnippet text={node.note} className="font-display text-body text-text-secondary" />
        </div>
      )}

      {["definition", "keyIdeas", "example", "note", "warning", "other"].map((key) => {
        const items = buckets[key];
        if (!items.length) return null;
        const meta = BUCKET_META[key];
        return (
          <CollapsibleSection key={key} id={key} title={meta.title} icon={meta.icon} count={items.length}>
            {key === "keyIdeas" ? (
              <ul className="pl-4 list-disc text-small text-text-secondary space-y-1">
                {items.map((k, i) => <li key={i}>{k}</li>)}
              </ul>
            ) : (
              <div className="flex flex-col gap-2">
                {items.map((e) => <EnrichmentCard key={e.semantic_node_id} entry={e} />)}
              </div>
            )}
          </CollapsibleSection>
        );
      })}

      {/* Evidence (Task 3 / Sprint A item 3) — Source/Heading rendered ONCE
          here, not per card (that was the duplicated-metadata clutter). */}
      <CollapsibleSection id="evidence" title="Bằng chứng" icon="Quote" count={evidence.length || null}>
        {evidence.length === 0 ? (
          <p className="text-small text-text-muted italic">
            {generating ? "Chưa có bằng chứng — đang làm giàu" : "Nhánh này chưa gắn trích đoạn"}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              {sourceLabel && <MetaChip icon="FileStack" title="Tài liệu nguồn">{sourceLabel}</MetaChip>}
              <MetaChip icon="BookOpen" title="Mục">{node.title}</MetaChip>
              {/* M2.5 (Provenance Adoption, mục 7 — Cross Navigation) — a node's
                  OWN source_stems (real per-node provenance) is more precise
                  than the whole-mindmap `sources` fallback below it, and is
                  used first when the node has it. Multiple stems get one
                  button EACH (existing button primitive, just repeated) —
                  never auto-picks stems[0] and calls it "the" source. Falls
                  back to the pre-existing whole-mindmap single-source case
                  only when the node itself has no resolved provenance. */}
              {node.sourceStems?.length > 0 ? (
                node.sourceStems.map((stem) => (
                  <button key={stem} type="button" onClick={() => onOpenSource(stem)}
                    className="inline-flex items-center gap-1 text-caption font-mono text-forest hover:underline">
                    <Icon name="FolderOpen" size={10} /> Mở nguồn: {stem}
                  </button>
                ))
              ) : sources?.length === 1 && (
                <button type="button" onClick={() => onOpenSource(sources[0])}
                  className="inline-flex items-center gap-1 text-caption font-mono text-forest hover:underline">
                  <Icon name="FolderOpen" size={10} /> Mở nguồn
                </button>
              )}
            </div>
            <p className="text-caption text-text-muted mb-2">
              Vị trí trang/đoạn chính xác chưa khả dụng — độ tin cậy hiển thị là mức
              trung bình của cả nhánh, chưa tách theo từng trích đoạn.
            </p>
            <div className="flex flex-col gap-2">
              {evidence.map((entry, i) => (
                <CitationCard
                  key={`${entry.chunkId}-${i}`}
                  chunkId={entry.chunkId} text={entry.text} loading={entry.loading} error={entry.error}
                  index={i} sourceLabel={sourceLabel} heading={node.title}
                  claim={node.title} confidencePct={avgConfidencePct}
                  highlighted={highlightedIds.has(entry.chunkId)}
                  onToggleHighlight={() => toggleHighlight(entry.chunkId)}
                />
              ))}
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* Related concepts (Task 4) — pure graph traversal, no LLM. */}
      <CollapsibleSection id="related" title="Liên hệ" icon="Network">
        {!hasRelations ? (
          <p className="text-small text-text-muted italic">Nhánh này không có liên hệ nào khác.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {relations.parent && (
              <div>
                <div className="text-caption text-text-muted mb-1">Nhánh cha</div>
                <RelatedPill item={relations.parent} onNavigate={onNavigate} icon="ArrowLeft" />
              </div>
            )}
            {relations.children.length > 0 && (
              <div>
                <div className="text-caption text-text-muted mb-1">Nhánh con ({relations.children.length})</div>
                <div className="flex flex-wrap gap-1.5">
                  {relations.children.map((c) => <RelatedPill key={c.id} item={c} onNavigate={onNavigate} />)}
                </div>
              </div>
            )}
            {(relations.prev || relations.next) && (
              <div>
                <div className="text-caption text-text-muted mb-1">Liền kề</div>
                <div className="flex flex-wrap gap-1.5">
                  <RelatedPill item={relations.prev} onNavigate={onNavigate} icon="ArrowLeft" />
                  <RelatedPill item={relations.next} onNavigate={onNavigate} icon="ArrowRight" />
                </div>
              </div>
            )}
            {relations.siblings.length > 0 && (
              <div>
                <div className="text-caption text-text-muted mb-1">Cùng cấp ({relations.siblings.length})</div>
                <div className="flex flex-wrap gap-1.5">
                  {relations.siblings.map((s) => <RelatedPill key={s.id} item={s} onNavigate={onNavigate} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );

  // Row 5 — sticky AI Actions footer (Sprint A item 1). Not collapsible —
  // it's chrome the whole panel is oriented around, same reasoning as the
  // nav bar; hidden entirely (not just empty) when there's no node to act on.
  const footer = node ? (
    <div className="px-4 py-3 border-t border-border" style={{ background: "var(--surface-contrast)" }}>
      <div className="text-metadata font-mono uppercase text-text-muted mb-2">Hành động học tập</div>
      <div className="grid grid-cols-2 gap-1.5">
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => onAskAI(a.build(node.title || "nhánh này"))}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-[7px] border border-border text-small text-text-secondary hover:border-[var(--accent)] hover:text-text-primary transition-colors text-left"
          >
            <Icon name={a.icon} size={13} className="flex-shrink-0" />
            <span className="truncate">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <aside role="complementary" aria-label="Trình khám phá tri thức" className="knowledge-inspector border-l border-border flex-shrink-0" style={{ background: "var(--surface-contrast)" }}>
      {navBar}
      {recentPinnedRow}
      {nodeHeader}
      <div className="overflow-y-auto min-h-0">{content}</div>
      {footer}
    </aside>
  );
}
