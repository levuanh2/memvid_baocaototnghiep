// Learning Canvas Option 2 structural piece: the lesson header row above the
// workspace tabs (docs/VISUAL_IDENTITY_WORKSPACE_REDESIGN.md, structural
// refactor pass). Real data only, no invented per-user "goal" or "step"
// concept — title/count/readiness are derived from the same
// sources/selectedSources state SidebarLeft already renders from, and the
// two action buttons call the SAME generate/switch handlers the Inspector's
// own "Tạo sơ đồ"/"Tạo tóm tắt" buttons and WorkspaceTabs already use
// (MainLayout wires onMindmapAction/onSummaryAction once, shared with
// ChatArea's next-action strip below the fold — see that file).
import { Icon } from "../ui/Icon";

export default function LessonHeader({
  title, selectedCount, readyCount,
  hasMindmap, hasSummary, onMindmapAction, onSummaryAction,
}) {
  const hasSelection = selectedCount > 0;
  const progressPct = hasSelection ? Math.round((readyCount / selectedCount) * 100) : 0;

  return (
    <div className="flex items-center gap-3 px-4 sm:px-5 h-11 border-b flex-shrink-0 min-w-0"
      style={{ borderColor: "var(--border-color)", background: "var(--bg-sidebar)" }}>
      <div className="min-w-0 flex-1 flex items-center gap-3 overflow-hidden">
        <span className="font-display text-small font-semibold text-text-primary truncate flex-shrink" title={title}>
          {title}
        </span>
        {hasSelection && (
          <>
            {/* This header sits inside a variable-width CENTER column of a
                3-column layout (left sidebar + this + right Inspector), not
                the full viewport — Tailwind's breakpoints are viewport-width-
                based, so `md:`/`lg:` alone under-estimate how cramped this
                column actually is at e.g. 1024px viewport with both side
                panels open (~446px real width there, found via screenshot:
                the progress bar was overlapping the action buttons at
                exactly that viewport). Pushed to `xl:` so it only appears
                once there's very likely real room, and wrapped the whole
                secondary-info group in its own min-w-0/overflow-hidden so
                if a breakpoint guess is ever still wrong, content clips
                instead of overlapping the buttons. */}
            <span className="hidden xl:inline text-caption font-mono text-text-muted flex-shrink-0 whitespace-nowrap">
              {selectedCount} tài liệu đang chọn
            </span>
            {/* Readiness — real, derived from source status, not a fabricated
                multi-step flow (the prototype's "Bước 2/4" has no equivalent
                concept in this app's data model). */}
            <div className="hidden xl:flex items-center gap-1.5 flex-shrink-0" title={`${readyCount}/${selectedCount} tài liệu sẵn sàng`}>
              <div className="progress-track w-16"><div className="progress-fill" style={{ width: `${progressPct}%` }} /></div>
              <span className="text-caption font-mono text-text-muted whitespace-nowrap">{readyCount}/{selectedCount}</span>
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button type="button" onClick={onMindmapAction} className="pill-action !text-small"
          title={hasMindmap ? "Xem sơ đồ tư duy" : "Tạo sơ đồ tư duy từ tài liệu đã chọn"}>
          <Icon name="Network" size={14} /> <span className="hidden sm:inline">Sơ đồ tư duy</span>
        </button>
        <button type="button" onClick={onSummaryAction} className="pill-action !text-small"
          title={hasSummary ? "Xem tóm tắt" : "Tạo tóm tắt từ tài liệu đã chọn"}>
          <Icon name="ScrollText" size={14} /> <span className="hidden sm:inline">Tóm tắt</span>
        </button>
      </div>
    </div>
  );
}
