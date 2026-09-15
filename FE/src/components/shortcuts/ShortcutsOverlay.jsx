// Feature Pack C — Discoverability (mục 7). Renders straight from
// SHORTCUT_REGISTRY (utils/keyboardShortcuts.js) so this list can never drift
// out of sync with what actually dispatches — one source of truth, not a
// second hand-written table. Reuses ui/Modal.jsx wholesale (Escape/backdrop/
// focus-trap/portal already built and tested there — no new dialog chrome).
import { useMemo } from "react";
import Modal from "../ui/Modal";
import { SHORTCUT_REGISTRY } from "../../utils/keyboardShortcuts";

export default function ShortcutsOverlay({ open, onClose }) {
  const groups = useMemo(() => {
    const by = new Map();
    for (const s of SHORTCUT_REGISTRY) {
      if (!by.has(s.category)) by.set(s.category, []);
      by.get(s.category).push(s);
    }
    return [...by.entries()];
  }, []);

  return (
    <Modal open={open} onClose={onClose} title="Phím tắt" subtitle="Toàn bộ phím tắt hiện có trong MemVidX" maxWidth={560}>
      <div className="px-5 py-4 flex flex-col gap-5">
        {groups.map(([category, items]) => (
          <div key={category}>
            <div className="text-metadata font-mono uppercase text-text-muted mb-2">{category}</div>
            <div className="flex flex-col gap-1.5">
              {items.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3">
                  <span className="text-small text-text-secondary">
                    {s.label}
                    {s.isNew && (
                      <span className="ml-1.5 text-caption font-mono uppercase text-accent">Mới</span>
                    )}
                  </span>
                  <kbd className="font-mono text-caption text-text-muted border border-border rounded px-1.5 py-0.5 whitespace-nowrap flex-shrink-0">
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
