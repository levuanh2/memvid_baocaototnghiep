// Root-only presentation for a live Mind Elixir 5.13 instance.
//
// Why this exists: mind-elixir's full render (`layout()` → `Tt`) always draws
// the root's direct children, and only consults a node's `expanded` flag for
// that node's OWN children (`_t`). So `expandNodeAll(root, false)` collapses
// grandchildren but leaves every first-level branch visible — the "root plus
// level-one nodes" defect. There is no library-level root-only mode.
//
// Mechanism: the root's `children` array is emptied for the duration of one
// synchronous `refresh()` and restored before returning. The root object is the
// same object the library and the app read, so `getData()`, export scope and
// edits on the root all keep seeing the full tree. Per-node `expanded` flags are
// never written, so expanding back restores exactly the pre-collapse state.
//
// Viewport: only `refresh()` is called — never `toCenter()`, `scaleFit()` or
// `move()`. The instance is not recreated.
//
// Re-apply: any later `refresh()` (theme change, data reload, a node's own
// caret) re-renders the full tree. Callers must invoke `reapplyRootOnly(mind)`
// after such a refresh while root-only is active.

const STATE = new WeakMap();

export function isRootOnly(mind) {
  return STATE.has(mind);
}

export function hiddenBranchCount(mind) {
  return STATE.get(mind)?.hidden.length ?? 0;
}

function renderWithoutBranches(mind) {
  const root = mind.nodeData;
  const hidden = root.children;
  root.children = [];
  try {
    mind.refresh();
  } finally {
    root.children = hidden;
  }
  const anchor = STATE.get(mind)?.anchor;
  const topic = mind.findEle?.(root.id);
  const rootElement = topic?.closest?.("me-root");
  if (anchor && topic && rootElement) {
    const rect = topic.getBoundingClientRect();
    const dx = anchor.x - (rect.left + rect.width / 2);
    const dy = anchor.y - (rect.top + rect.height / 2);
    const scale = Number(mind.scaleVal) || 1;
    // Keep the topic at the same screen coordinate without touching the
    // map-canvas transform (pan/zoom). There are no tree connectors in this
    // presentation, so a root-local offset cannot desynchronise paths.
    rootElement.style.transform = `translate(${dx / scale}px, ${dy / scale}px)`;
  }
  return hidden;
}

export function setRootOnly(mind, active) {
  if (!mind?.nodeData) return false;
  if (active) {
    if (STATE.has(mind)) return false;
    if (!mind.nodeData.children?.length) return false;
    const topic = mind.findEle?.(mind.nodeData.id);
    const rect = topic?.getBoundingClientRect?.();
    const anchor = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
    mind.clearSelection?.();
    STATE.set(mind, { hidden: mind.nodeData.children, anchor });
    const hidden = renderWithoutBranches(mind);
    STATE.set(mind, { hidden, anchor });
    return true;
  }
  if (!STATE.has(mind)) return false;
  STATE.delete(mind);
  mind.refresh();
  return true;
}

export function reapplyRootOnly(mind) {
  const state = STATE.get(mind);
  if (!state || !mind?.nodeData) return false;
  renderWithoutBranches(mind);
  return true;
}
