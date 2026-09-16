// Compact workspace shell (Learning Canvas IA pass, round 5). Replaces the
// old two-row stack (a title/action row + a separate WorkspaceTabs row)
// with ONE toolbar: title/meta on the left, the Chat | Mind Map | Summary
// mode switch in the center — the ONLY persistent navigation for those
// three modes anywhere in the app (nav-ownership requirement — see
// docs/VISUAL_IDENTITY_WORKSPACE_REDESIGN.md). No per-mode "create"
// buttons here anymore; those live as ONE contextual next-action inside
// each pane's own empty state (ChatArea's next-action strip / MindMap's
// own empty state), never duplicated as a second set of buttons here.
import { Icon } from "../ui/Icon";

const TABS = [
  { key: "chat", label: "Trò chuyện", icon: "MessageSquareText" },
  { key: "mindmap", label: "Sơ đồ tư duy", icon: "Network" },
  { key: "summary", label: "Tóm tắt", icon: "ScrollText" },
];

export default function LessonHeader({
  title, selectedCount, readyCount,
  mode, onModeChange,
}) {
  const hasSelection = selectedCount > 0;
  const progressPct = hasSelection ? Math.round((readyCount / selectedCount) * 100) : 0;

  return (
    <div className="flex items-center gap-3 px-4 sm:px-5 h-12 sm:h-[52px] border-b flex-shrink-0 min-w-0"
      style={{ borderColor: "var(--border-color)", background: "var(--bg-sidebar)" }}>
      <div className="min-w-0 flex-1 flex items-center gap-3 overflow-hidden">
        <span className="font-display text-small font-semibold text-text-primary truncate flex-shrink" title={title}>
          {title}
        </span>
        {hasSelection && (
          <>
            {/* Viewport-width breakpoints under-estimate this column's real
                width (it's the center of a 3-column layout, not the full
                viewport — found overlapping at 1024px viewport with both
                side panels open, ~446px real width there), so this stays
                hidden until xl: and clips via overflow-hidden above rather
                than risk overlapping the tabs again. */}
            <span className="hidden xl:inline text-caption font-mono text-text-muted flex-shrink-0 whitespace-nowrap">
              {selectedCount} tài liệu · Bước {readyCount}/{selectedCount}
            </span>
            <div className="hidden xl:flex items-center gap-1.5 flex-shrink-0" title={`${readyCount}/${selectedCount} tài liệu sẵn sàng`}>
              <div className="progress-track w-14"><div className="progress-fill" style={{ width: `${progressPct}%` }} /></div>
            </div>
          </>
        )}
      </div>

      {/* Mode switch — the ONLY persistent Chat/Mind Map/Summary navigation
          anywhere (nav-ownership requirement). Always enabled: switching
          into an empty Mind Map/Summary pane shows that pane's own empty
          state with one contextual CTA, not a disabled tab — a disabled
          tab hides the feature instead of explaining it. */}
      <nav role="tablist" aria-label="Chế độ Workspace" className="flex items-center gap-1 flex-shrink-0">
        {TABS.map((t) => {
          const active = mode === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onModeChange(t.key)}
              title={t.label}
              className="flex items-center gap-1.5 px-3 py-1.5 text-small rounded-control border-b-2 -mb-px transition-colors"
              style={{
                borderColor: active ? "var(--accent)" : "transparent",
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                fontWeight: active ? 600 : 500,
              }}
            >
              <Icon name={t.icon} size={14} />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Balances the tab group so it reads as visually centered against
          the title on the left; chat-specific actions (New chat / kebab)
          stay owned by ChatArea's own slim action row below this one —
          lifting that state up here would risk the chat session/history
          logic for a purely cosmetic gain, not attempted this pass. */}
      <div className="flex-1 min-w-0" aria-hidden="true" />
    </div>
  );
}
