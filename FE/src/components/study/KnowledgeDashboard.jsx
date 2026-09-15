// Feature Pack D (Personal Knowledge Graph & Knowledge Evolution) — the
// Knowledge Dashboard (mục 7). Reads StudyContext's existing `history[]`
// (Feature Pack A) and the current mindmap's `allNodes` (added this pack to
// useMindMapController.js) — owns no state of its own beyond local UI toggles
// (which section is expanded). Every number on this panel is a real count
// over real entries; every "Jump" reuses the SAME select* actions and
// jumpTo/canJumpTo ResearchTimeline.jsx already established the discipline
// for (Feature Pack A/B) — a kind with no real jump target renders disabled
// with a reason, never a fake success.
import { useMemo, useState } from "react";
import { Icon } from "../ui/Icon";
import { useStudyContext } from "../../study/useStudyContext";
import { formatRelativeTime } from "../../utils/relativeTime";
import {
  KIND_META, canJumpEntry, evolutionGroups, sessionSummary,
  reviewSuggestions, partitionNodesByVisit, nodeHeatmap,
} from "../../utils/knowledgeEvolution";

function Stat({ value, label }) {
  return (
    <div className="flex flex-col items-center px-2 py-1.5 min-w-0">
      <span className="font-display font-semibold text-body-lg text-text-primary tabular-nums">{value}</span>
      <span className="text-caption text-text-muted truncate">{label}</span>
    </div>
  );
}

function Section({ title, count, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border">
      <button type="button" onClick={() => setOpen((v) => !v)}
              className="w-full flex items-center gap-1.5 px-3 py-2.5 text-left">
        <span className="text-metadata font-mono uppercase text-text-muted flex-1">{title}</span>
        {count != null && <span className="text-caption text-text-muted">{count}</span>}
        <Icon name="ChevronDown" size={13} className="text-text-muted"
              style={{ transform: open ? undefined : "rotate(-90deg)" }} />
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

/** Một mục có thể Jump — cùng hình dạng ResearchTimeline.jsx dùng, tái dùng
 * `canJumpEntry` chung thay vì viết lại luật đó lần thứ ba. */
function JumpRow({ entry, meta, trailing, onJump, canJumpNode }) {
  const kha_thi = canJumpEntry(entry, { canJumpNode });
  const m = meta || KIND_META[entry.kind] || { icon: "Tag", label: entry.kind };
  return (
    <li className="flex items-center gap-2 py-1.5">
      <Icon name={m.icon} size={13} className="shrink-0 text-text-muted" />
      <span className="text-small text-text-primary truncate flex-1" title={entry.label}>{entry.label}</span>
      {trailing && <span className="text-caption text-text-muted shrink-0">{trailing}</span>}
      <button type="button" disabled={!kha_thi.kha_thi}
              title={kha_thi.kha_thi ? "Đi tới" : kha_thi.ly_do}
              aria-label={kha_thi.kha_thi ? `Đi tới: ${entry.label}` : `Không thể đi tới: ${kha_thi.ly_do}`}
              onClick={() => onJump(entry)}
              className="icon-btn w-6 h-6 shrink-0 disabled:opacity-30 disabled:cursor-not-allowed">
        <Icon name="ArrowRight" size={12} />
      </button>
    </li>
  );
}

const EMPTY = <p className="text-small text-text-muted italic py-1">Chưa có gì để hiện.</p>;

export default function KnowledgeDashboard({ mindMapController, onJumpQuestion, onJumpEvidence, onJumpNode, onOpenTimeline }) {
  const {
    history, selectTopic, selectEntity, selectSummary, selectNode, selectQuestion, selectEvidence,
  } = useStudyContext();
  const [now] = useState(() => Date.now()); // đọc một lần khi mở panel — cùng lý do ResearchTimeline.jsx đã có

  const canJumpNode = mindMapController?.canJumpTo || (() => false);
  const allNodes = useMemo(() => mindMapController?.allNodes || [], [mindMapController]);
  const hasMindmap = allNodes.length > 0;

  const jump = (entry) => {
    if (entry.kind === "question") { selectQuestion(entry.id, { source: "chat", label: entry.label }); onJumpQuestion?.(entry.label); return; }
    if (entry.kind === "evidence") {
      const i = entry.id.lastIndexOf("::");
      const stem = i === -1 ? entry.id : entry.id.slice(0, i);
      const chunkId = i === -1 ? "" : entry.id.slice(i + 2);
      selectEvidence(entry.id, { source: "chat", label: entry.label });
      onJumpEvidence?.({ stem, chunkId });
      return;
    }
    if (entry.kind === "node") {
      if (!canJumpNode(entry.id)) return;
      selectNode(entry.id, { source: "mindmap", label: entry.label });
      onJumpNode?.(entry.id);
      return;
    }
    if (entry.kind === "topic") return selectTopic(entry.id, { source: "knowledge", label: entry.label });
    if (entry.kind === "entity") return selectEntity(entry.id, { source: "knowledge", label: entry.label });
    if (entry.kind === "summary") return selectSummary(entry.id, { source: "summary", label: entry.label });
  };
  // Node "chưa từng mở" của Heatmap chưa hề vào `history`, nên `jump` ở trên
  // (nhánh "node") vẫn đúng — nó chỉ cần `canJumpNode(id)` true, không cần đã
  // từng được ghi lại.
  const jumpNodeDirect = (id, label) => jump({ kind: "node", id, label });

  const summary = useMemo(() => sessionSummary(history), [history]);
  const evolution = useMemo(() => evolutionGroups(history, now), [history, now]);
  const suggestions = useMemo(() => reviewSuggestions(history, now, 5), [history, now]);
  const { visited, unvisited } = useMemo(() => partitionNodesByVisit(allNodes, history), [allNodes, history]);
  const heatmap = useMemo(() => nodeHeatmap(allNodes, history), [allNodes, history]);

  const recentToday = useMemo(() => [...history].reverse().slice(0, 5), [history]);

  const hasAnything = history.length > 0;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
      <div className="px-3 py-2.5 border-b border-border flex-shrink-0">
        <span className="text-metadata font-mono uppercase text-text-muted">Kiến thức của bạn</span>
      </div>

      {!hasAnything ? (
        <div className="text-center px-5 pt-10 text-text-muted">
          <Icon name="Network" size={24} className="mx-auto mb-2.5 opacity-60" />
          <p className="text-small text-text-secondary">
            Chưa có hoạt động nào trong phiên này. Đặt câu hỏi, mở một trích dẫn, hoặc xem
            một nhánh sơ đồ — bảng này sẽ tự lấp đầy bằng đúng những gì bạn vừa làm.
          </p>
        </div>
      ) : (
        <>
          {/* Session Summary — mục 6 */}
          <Section title="Tóm tắt phiên" defaultOpen>
            <div className="flex flex-wrap divide-x divide-border -mx-1">
              <Stat value={summary.questions} label="Câu hỏi" />
              <Stat value={summary.evidence} label="Trích dẫn" />
              <Stat value={summary.concepts} label="Khái niệm" />
              <Stat value={summary.nodes} label="Nhánh sơ đồ" />
            </div>
          </Section>

          {/* Learning Journey — mục 3. "Hôm nay" là nhãn CHÍNH XÁC: history
              không lưu qua lần tải lại trang nên chưa từng thực sự cũ hơn một
              phiên — không dựng thêm mục "Tuần này" vì sẽ luôn rỗng, một mục
              rỗng-vĩnh-viễn trông như hỏng chứ không trung thực. */}
          <Section title="Hôm nay" count={recentToday.length}>
            {recentToday.length === 0 ? EMPTY : (
              <ul className="flex flex-col">
                {recentToday.map((e, i) => (
                  <JumpRow key={`${e.kind}-${e.id}-${e.at}-${i}`} entry={e}
                           trailing={formatRelativeTime(e.at, now)} onJump={jump} canJumpNode={canJumpNode} />
                ))}
              </ul>
            )}
            {onOpenTimeline && (
              <button type="button" onClick={onOpenTimeline}
                      className="mt-1.5 text-caption font-mono text-forest hover:underline">
                Xem toàn bộ dòng thời gian →
              </button>
            )}
          </Section>

          {/* Knowledge Evolution — mục 1 */}
          <Section title="Tri thức đang thay đổi"
                    count={evolution.discovered.length + evolution.frequent.length + evolution.needsReview.length}>
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-caption text-text-muted mb-1">Mới khám phá</div>
                {evolution.discovered.length === 0 ? EMPTY : (
                  <ul className="flex flex-col">
                    {evolution.discovered.map((e) => (
                      <JumpRow key={`d-${e.kind}-${e.id}`} entry={e} onJump={jump} canJumpNode={canJumpNode} />
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="text-caption text-text-muted mb-1">Ôn đi ôn lại</div>
                {evolution.frequent.length === 0 ? EMPTY : (
                  <ul className="flex flex-col">
                    {evolution.frequent.map((e) => (
                      <JumpRow key={`f-${e.kind}-${e.id}`} entry={e} trailing={`×${e.count}`} onJump={jump} canJumpNode={canJumpNode} />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Section>

          {/* Review Suggestions — mục 5 */}
          <Section title="Nên xem lại gì?" count={suggestions.length}>
            {suggestions.length === 0 ? (
              <p className="text-small text-text-muted italic py-1">
                Chưa có mục nào cần xem lại — quay lại đây sau khi phiên trôi qua một lúc.
              </p>
            ) : (
              <ul className="flex flex-col">
                {suggestions.map((e) => (
                  <JumpRow key={`r-${e.kind}-${e.id}`} entry={e}
                           trailing={formatRelativeTime(e.lastAt, now)} onJump={jump} canJumpNode={canJumpNode} />
                ))}
              </ul>
            )}
          </Section>

          {/* Knowledge Graph Overlay + Heatmap — mục 2 + 4. Chỉ có ý nghĩa khi
              một sơ đồ tư duy đang mở — không sơ đồ thì không có "toàn bộ node"
              để so, nói rõ thay vì hiện rỗng khó hiểu. */}
          <Section title="Sơ đồ tri thức" count={hasMindmap ? allNodes.length : null}>
            {!hasMindmap ? (
              <p className="text-small text-text-muted italic py-1">
                Chưa có sơ đồ tư duy nào để đối chiếu — mở "Sơ đồ tư duy" trước.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 text-caption text-text-muted">
                  <span><span className="text-text-primary font-semibold tabular-nums">{visited.length}</span> đã xem</span>
                  <span><span className="text-text-primary font-semibold tabular-nums">{unvisited.length}</span> chưa xem</span>
                </div>
                {mindMapController?.relations && (mindMapController.relations.parent
                  || mindMapController.relations.children.length > 0
                  || mindMapController.relations.siblings.length > 0) && (
                  <div>
                    <div className="text-caption text-text-muted mb-1">Liên quan đến nhánh đang chọn</div>
                    <div className="flex flex-wrap gap-1.5">
                      {mindMapController.relations.parent && (
                        <button type="button" onClick={() => jumpNodeDirect(mindMapController.relations.parent.id, mindMapController.relations.parent.title)}
                                className="pill-action !text-caption !py-0.5">{mindMapController.relations.parent.title}</button>
                      )}
                      {mindMapController.relations.children.slice(0, 4).map((c) => (
                        <button key={c.id} type="button" onClick={() => jumpNodeDirect(c.id, c.title)}
                                className="pill-action !text-caption !py-0.5">{c.title}</button>
                      ))}
                    </div>
                  </div>
                )}
                {mindMapController?.breadcrumb?.length > 0 && (
                  <div>
                    <div className="text-caption text-text-muted mb-1">Đường học từ gốc</div>
                    <div className="text-small text-text-secondary truncate">
                      {mindMapController.breadcrumb.map((b) => b.title).join(" › ")}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-caption text-text-muted mb-1">Chưa xem ({unvisited.length})</div>
                  {unvisited.length === 0 ? (
                    <p className="text-small text-text-muted italic">Đã xem hết mọi nhánh của sơ đồ này.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {unvisited.slice(0, 8).map((n) => (
                        <button key={n.id} type="button" onClick={() => jumpNodeDirect(n.id, n.title)}
                                className="pill-action !text-caption !py-0.5" title="Chưa từng mở nhánh này">
                          <Icon name="Network" size={10} /> {n.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Section>

          {hasMindmap && (
            <Section title="Nhánh hay dùng / hiếm dùng" defaultOpen={false}>
              <div className="flex flex-col gap-3">
                <div>
                  <div className="text-caption text-text-muted mb-1">Hay dùng ({heatmap.frequent.length})</div>
                  {heatmap.frequent.length === 0 ? EMPTY : (
                    <ul className="flex flex-col">
                      {heatmap.frequent.map((n) => (
                        <JumpRow key={n.id} entry={{ kind: "node", id: n.id, label: n.title }}
                                 meta={{ icon: "Network", label: "" }} trailing={`×${n.visitCount}`}
                                 onJump={jump} canJumpNode={canJumpNode} />
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="text-caption text-text-muted mb-1">Chưa từng mở ({heatmap.never.length})</div>
                  {heatmap.never.length === 0 ? EMPTY : (
                    <p className="text-caption text-text-muted">
                      Xem danh sách ở mục "Sơ đồ tri thức" phía trên.
                    </p>
                  )}
                </div>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
