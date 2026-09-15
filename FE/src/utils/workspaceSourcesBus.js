// Feature epic M1 (Multi-Document Intelligence, mục 9 — Workspace search).
// `selectedSources` (the checked-document array, SidebarLeft/Workspace.jsx)
// is local component state, and CommandPalette.jsx is mounted as a SIBLING
// of <Routes> in App.jsx — outside Workspace's subtree entirely (the exact
// same cross-tree boundary Feature Pack C/D each hit and documented). Lifting
// `selectedSources` into StudyContext to fix this would mean Workspace.jsx
// stops owning its own top-level state — a real, invasive rewrite of
// already-working code for a small search-scope filter, not justified here.
//
// Instead: a plain module-level mirror of the CURRENT value, written by
// Workspace.jsx whenever `selectedSources` changes, read on-demand by
// CommandPalette.jsx when the user picks the "workspace" search scope. This
// is the SAME cross-tree-signal shape `commandPaletteBus.js`/`shortcutsBus.js`
// already establish (a plain module, no React, no new state management) —
// those expose a fire-once EVENT; this exposes a readable SNAPSHOT, because
// scope-filtering needs the current value, not a one-time notification.
// There is still exactly ONE source of truth (Workspace.jsx's state); this
// is a read-only mirror of it, not a second copy anything else writes to.
let current = [];

export function setWorkspaceSources(stems) {
  current = Array.isArray(stems) ? stems : [];
}

export function getWorkspaceSources() {
  return current;
}
