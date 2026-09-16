// Mind Map / Summary workspace-mode empty state (IA pass, round 5). Shown
// when the mode switch is on "mindmap"/"summary" but no map/summary exists
// yet — the mode tab is now ALWAYS enabled (nav-ownership requirement: one
// visible entry point, not a disabled tab that hides the feature), so this
// is what a click lands on instead of a blank pane. The CTA reuses the
// existing onMindmapAction/onSummaryAction dispatcher (MainLayout) — same
// generator the Inspector's own "Tạo sơ đồ"/"Tạo tóm tắt" button already
// triggers, no new generation logic.
import { Icon } from "../ui/Icon";

const COPY = {
  mindmap: {
    icon: "Network",
    title: "Chưa có sơ đồ tư duy",
    body: "Sơ đồ tư duy tổng hợp cấu trúc và mối quan hệ giữa các ý chính trong tài liệu đã chọn.",
    cta: "Tạo sơ đồ tư duy",
  },
  summary: {
    icon: "ScrollText",
    title: "Chưa có tóm tắt",
    body: "Tóm tắt rút gọn nội dung tài liệu đã chọn thành các ý chính, kèm trích dẫn.",
    cta: "Tạo tóm tắt",
  },
};

export default function WorkspaceEmptyState({ kind, selectedCount, onCreate }) {
  const copy = COPY[kind];
  const hasSelection = selectedCount > 0;
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-3" style={{ background: "var(--bg-base)" }}>
      <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "var(--accent-subtle)" }}>
        <Icon name={copy.icon} size={22} className="text-accent" />
      </div>
      <h2 className="font-display text-[19px] font-semibold text-text-primary">{copy.title}</h2>
      <p className="text-small text-text-secondary max-w-[380px]">{copy.body}</p>
      <p className="text-caption font-mono text-text-muted uppercase">
        {hasSelection ? `${selectedCount} tài liệu đã chọn` : "Chưa chọn tài liệu nào"}
      </p>
      <button type="button" onClick={onCreate} disabled={!hasSelection} className="btn-primary !text-small mt-1 disabled:opacity-40 disabled:cursor-not-allowed">
        <Icon name={copy.icon} size={14} /> {copy.cta}
      </button>
      {!hasSelection && (
        <p className="text-caption text-text-muted">Chọn tài liệu bên trái trước.</p>
      )}
    </div>
  );
}
