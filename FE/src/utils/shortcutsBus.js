// Feature Pack C — tiny event bus for opening ShortcutsOverlay from anywhere,
// same shape as utils/commandPaletteBus.js (that file's own comment explains
// why: a plain module so callers — here, CommandPalette.jsx's new "Phím tắt"
// command — don't have to statically import MainLayout.jsx just to open an
// overlay MainLayout owns the state for).
export const OPEN_SHORTCUTS_EVENT = "memvidx:open-shortcuts";

export function openShortcutsOverlay() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS_EVENT));
}
