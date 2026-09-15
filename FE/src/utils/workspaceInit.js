// Feature Pack B (Cross Navigation) — pure resolvers for Workspace.jsx's
// `?tab=`/`?right=` initializers (StudyMap's "Về nguồn" link uses both).
// Extracted out of the component so the fallback rules are unit-testable
// without mounting React — same reasoning `?source=`/`?prompt=` already had
// no need to be pure (they're a single trim-or-empty each), but `tab`/
// `right` each have a real allow-list + fallback worth locking down: an
// unknown or malicious value must degrade to the exact same default as no
// value at all, never leave the app in a state that never existed before.

const VALID_TABS = new Set(["chat", "mindmap", "summary"]);
const DEFAULT_TAB = "chat";

const VALID_RIGHT_VIEWS = new Set(["evidence", "tutor", "timeline", "insights"]);
const DEFAULT_RIGHT_VIEW = "evidence";

export function resolveInitialTab(raw) {
  const v = String(raw || "").trim();
  return VALID_TABS.has(v) ? v : DEFAULT_TAB;
}

export function resolveInitialRightView(raw) {
  const v = String(raw || "").trim();
  return VALID_RIGHT_VIEWS.has(v) ? v : DEFAULT_RIGHT_VIEW;
}
