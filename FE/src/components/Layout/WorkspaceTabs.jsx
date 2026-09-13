// Workspace mode switch — Chat / MindMap / Summary share ONE central region
// now (Workspace architecture, approved audit). Switching tabs is pure client
// state (`workspaceMode` in MainLayout): no navigation, no remount of any of
// the three panes — see WorkspaceContainer.
import { Icon } from "../ui/Icon";

const TABS = [
  { key: "chat", label: "Trò chuyện", icon: "MessageSquareText" },
  { key: "mindmap", label: "Sơ đồ tư duy", icon: "Network" },
  { key: "summary", label: "Tóm tắt", icon: "ScrollText" },
];

export default function WorkspaceTabs({ mode, onChange, hasMindmap, hasSummary }) {
  const enabled = { chat: true, mindmap: hasMindmap, summary: hasSummary };
  return (
    <div role="tablist" aria-label="Chế độ Workspace" className="flex items-center gap-1 px-2 border-b border-border flex-shrink-0" style={{ background: "var(--bg-sidebar)" }}>
      {TABS.map((t) => {
        const active = mode === t.key;
        const disabled = !enabled[t.key];
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={() => !disabled && onChange(t.key)}
            title={disabled ? `${t.label} — chưa có nội dung` : t.label}
            className="flex items-center gap-1.5 px-3 py-2 text-small border-b-2 -mb-px transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
            style={{
              borderColor: active ? "var(--accent)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-secondary)",
              fontWeight: active ? 600 : 500,
            }}
          >
            <Icon name={t.icon} size={13} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
