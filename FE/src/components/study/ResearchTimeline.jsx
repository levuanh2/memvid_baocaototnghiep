// Feature Pack A — Research Timeline. Reads the bounded history[] log
// StudyContext already keeps (studySelection.js) — this component owns NO
// selection state of its own, only local UI state (search text, expanded/
// collapsed), per the reviewed plan. "Jump" reuses the SAME six select*
// actions the rest of the app already dispatches; a kind with no real jump
// target renders disabled with a reason, never a fake success.
import { useMemo, useState } from "react";
import { Icon } from "../ui/Icon";
import { useStudyContext } from "../../study/useStudyContext";
import { boDau } from "../../utils/thuVienTaiLieu";
import { formatRelativeTime } from "../../utils/relativeTime";
import { KIND_META, canJumpEntry } from "../../utils/knowledgeEvolution";
import { parseCiteKey } from "../../utils/evidence";

// Feature epic M1 (Multi-Document Intelligence, mục 7) — the Timeline already
// spans every document the session touched (`history` resets only on a
// SINGLE-document `selectDocument` call — a multi-source chat session, which
// never calls that, accumulates entries across every selected document
// already). What was missing: which document. "evidence" is the one kind
// whose `id` genuinely encodes it (a `citeKey`, `stem::chunkId`) — the other
// five kinds (topic/entity/summary/node/question) carry no document field at
// all in their `history` entry, so this stays evidence-only rather than
// inventing a source for kinds that don't have one.
function goiYNguon(entry) {
  if (entry.kind !== "evidence") return null;
  const { stem } = parseCiteKey(entry.id);
  return stem || null;
}

function MucDongThoiGian({ entry, now, kha_thi_jump, onJump }) {
  const meta = KIND_META[entry.kind] || { icon: "Tag", label: entry.kind };
  const nguon = goiYNguon(entry);
  return (
    <li className="flex items-start gap-2 py-2 px-2.5 rounded-[7px] hover:bg-surface-elevated">
      <Icon name={meta.icon} size={14} className="mt-0.5 shrink-0 text-text-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-caption text-text-muted">
          <span className="font-mono uppercase">{meta.label}</span>
          <span aria-hidden="true">·</span>
          <span>{formatRelativeTime(entry.at, now)}</span>
          {nguon && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate" title={`Nguồn: ${nguon}`}>{nguon}</span>
            </>
          )}
        </div>
        <p className="text-small text-text-primary truncate" title={entry.label}>{entry.label}</p>
      </div>
      <button
        type="button"
        disabled={!kha_thi_jump.kha_thi}
        title={kha_thi_jump.kha_thi ? "Quay lại mục này" : kha_thi_jump.ly_do}
        aria-label={kha_thi_jump.kha_thi ? `Quay lại: ${entry.label}` : `Không thể quay lại: ${kha_thi_jump.ly_do}`}
        onClick={() => onJump(entry)}
        className="icon-btn w-7 h-7 shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Icon name="ArrowRight" size={14} />
      </button>
    </li>
  );
}

export default function ResearchTimeline({ mindMapController, onJumpQuestion, onJumpEvidence, onJumpNode }) {
  const {
    history, selectTopic, selectEntity, selectSummary, selectNode, selectQuestion,
    selectEvidence, clearHistory,
  } = useStudyContext();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(true);
  // Đồng hồ hiển thị: đọc một lần khi panel mở, KHÔNG tự chạy (không setInterval) —
  // đây là nhãn tương đối cho một phiên đang xem, không phải đồng hồ sống; làm
  // sống thêm một bộ đếm chỉ để "5 phút trước" tự nhảy thành "6 phút trước" là
  // phức tạp hoá cho một lợi ích không ai yêu cầu.
  const [now] = useState(() => Date.now());

  const canJumpNode = mindMapController?.canJumpTo || (() => false);

  const daLoc = useMemo(() => {
    const q = boDau(query);
    const list = [...history].reverse(); // mới nhất trước
    if (!q) return list;
    return list.filter((e) => boDau(`${e.label} ${KIND_META[e.kind]?.label || e.kind}`).includes(q));
  }, [history, query]);

  const ganNhat = history.length > 0 ? history[history.length - 1] : null;

  const nhay = (entry) => {
    if (entry.kind === "question") {
      selectQuestion(entry.id, { source: "chat", label: entry.label });
      onJumpQuestion?.(entry.label);
      return;
    }
    if (entry.kind === "evidence") {
      const { stem, chunkId } = parseCiteKey(entry.id);
      selectEvidence(entry.id, { source: "chat", label: entry.label });
      onJumpEvidence?.({ stem, chunkId });
      return;
    }
    if (entry.kind === "node") {
      if (!canJumpNode(entry.id)) return;   // nút đã disabled; chặn lại ở tầng logic phòng gọi tắt qua bàn phím lỗi thời
      selectNode(entry.id, { source: "mindmap", label: entry.label });
      onJumpNode?.(entry.id);
      return;
    }
    if (entry.kind === "topic") return selectTopic(entry.id, { source: "knowledge", label: entry.label });
    if (entry.kind === "entity") return selectEntity(entry.id, { source: "knowledge", label: entry.label });
    if (entry.kind === "summary") return selectSummary(entry.id, { source: "summary", label: entry.label });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2.5 border-b border-border flex items-center gap-1.5 flex-shrink-0">
        <span className="text-metadata font-mono uppercase text-text-muted flex-1">
          Dòng thời gian
        </span>
        {history.length > 0 && (
          <button type="button" onClick={clearHistory} className="icon-btn w-7 h-7"
                  title="Xoá dòng thời gian phiên này" aria-label="Xoá dòng thời gian phiên này">
            <Icon name="Trash2" size={13} />
          </button>
        )}
        <button type="button" onClick={() => setExpanded((v) => !v)} className="icon-btn w-7 h-7"
                aria-expanded={expanded}
                title={expanded ? "Thu gọn" : "Mở rộng"}
                aria-label={expanded ? "Thu gọn dòng thời gian" : "Mở rộng dòng thời gian"}>
          <Icon name="ChevronDown" size={14} style={{ transform: expanded ? undefined : "rotate(-90deg)" }} />
        </button>
      </div>

      {ganNhat && (
        <div className="px-3 py-2.5 border-b border-border flex-shrink-0">
          <div className="text-caption font-mono uppercase text-text-muted mb-1.5">
            Tiếp tục từ chỗ đang dở
          </div>
          <MucDongThoiGian
            entry={ganNhat} now={now}
            kha_thi_jump={canJumpEntry(ganNhat, { canJumpNode })}
            onJump={nhay}
          />
        </div>
      )}

      {expanded && (
        <>
          {history.length > 0 && (
            <div className="px-3 py-2 border-b border-border flex-shrink-0">
              <div className="header-search !rounded-control !min-w-0 !px-2.5 !py-1.5">
                <Icon name="Search" size={13} className="text-text-muted flex-shrink-0" />
                <input
                  type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tìm trong dòng thời gian…"
                  aria-label="Tìm trong dòng thời gian"
                  className="bg-transparent outline-none text-small text-text-primary placeholder:text-text-muted w-full"
                />
              </div>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto px-1.5 py-1">
            {history.length === 0 ? (
              <div className="text-center px-5 pt-10 text-text-muted">
                <Icon name="Clock" size={24} className="mx-auto mb-2.5 opacity-60" />
                <p className="text-small text-text-secondary">
                  Chưa có gì trong phiên này. Đặt một câu hỏi, mở một trích dẫn, hoặc bấm
                  vào một nhánh sơ đồ — mỗi việc đó sẽ hiện ở đây, để quay lại đúng chỗ
                  vừa xem chỉ bằng một cú bấm.
                </p>
              </div>
            ) : daLoc.length === 0 ? (
              <p className="text-small text-text-muted text-center pt-6">
                Không khớp “{query}”.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {daLoc.map((entry, i) => (
                  <MucDongThoiGian
                    key={`${entry.kind}-${entry.id}-${entry.at}-${i}`}
                    entry={entry} now={now}
                    kha_thi_jump={canJumpEntry(entry, { canJumpNode })}
                    onJump={nhay}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
