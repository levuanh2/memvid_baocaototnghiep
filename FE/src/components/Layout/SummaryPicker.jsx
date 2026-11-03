// Summary mode's library: pick a saved summary or start a new one.
// Replaces what ModeLibraryMenu did for summaries before 99258df removed it
// from the header (the mind map got its own selector then; Summary got none).
// A native <select> on purpose: keyboard, screen-reader and touch behaviour
// come from the platform. Data and actions are SidebarRight's existing
// `summaryActions` (select/create/creating), passed through MainLayout.
import { Icon } from "../ui/Icon";
import Spinner from "../ui/Spinner";

// `compact`: inside the fixed-height (48px) summary toolbar it must stay on one
// row at 320px, so the select shrinks and the button keeps only its icon there.
export default function SummaryPicker({ items = [], selectedId = null, onSelect, onCreate, creating = false, canCreate = true, createLabel = "Tạo tóm tắt mới", compact = false }) {
  return (
    <div className={compact ? "flex flex-nowrap items-center gap-1.5 min-w-0" : "flex flex-wrap items-center justify-center gap-2"}>
      {items.length > 0 && (
        <select aria-label="Chọn tóm tắt" className={`input-surface !py-1 !text-small ${compact ? "min-w-0 w-[9.5rem] sm:w-auto sm:max-w-[220px]" : "max-w-[260px]"}`}
          value={selectedId ?? ""}
          onChange={(e) => {
            const item = items.find((s) => String(s.id) === e.target.value);
            if (item) onSelect?.(item);
          }}>
          {selectedId == null && <option value="" disabled>Mở tóm tắt đã có…</option>}
          {items.map((s) => <option key={s.id} value={s.id}>{s.title || "Tóm tắt tài liệu"}</option>)}
        </select>
      )}
      {onCreate && (
        <button type="button" className="pill-action !text-small inline-flex flex-shrink-0 items-center gap-1.5"
          onClick={onCreate} disabled={creating || !canCreate} aria-busy={creating || undefined}
          aria-label={compact ? createLabel : undefined} title={compact ? createLabel : undefined}>
          {creating ? <Spinner size={13} /> : <Icon name="Plus" size={13} />}
          <span className={compact ? "hidden sm:inline" : undefined}>{createLabel}</span>
        </button>
      )}
    </div>
  );
}
