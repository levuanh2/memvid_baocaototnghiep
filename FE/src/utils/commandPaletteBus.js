// Tiny event bus for opening the global CommandPalette from anywhere — a
// plain module (no React, no heavy deps) so callers can import it WITHOUT
// pulling in CommandPalette.jsx's own chunk (App.jsx lazy-loads that
// component; a static import of it elsewhere would defeat that split).
export const OPEN_EVENT = "memvidx:open-search";

export function openCommandPalette() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}
