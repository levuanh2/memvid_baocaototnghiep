// Root-only presentation for a live Mind Elixir 5.13 instance.
//
// Why this exists: mind-elixir's full render (`layout()` → `Tt`) always draws
// the root's direct children, and only consults a node's `expanded` flag for
// that node's OWN children (`_t`). So `expandNodeAll(root, false)` collapses
// grandchildren but leaves every first-level branch visible — the "root plus
// level-one nodes" defect. There is no library-level root-only mode.
//
// Mechanism: the root's `children` array is emptied for the duration of one
// synchronous `refresh()` and restored in `finally`. The root object is the
// same object the library and the app read, so `getData()`, export scope and
// edits on the root keep seeing the full tree. Per-node `expanded` flags are
// never written, so expanding back restores exactly the pre-collapse state.
//
// Atomicity: `isRootOnly` flips only after the root-only render succeeds. If a
// render throws, the adapter tries to restore the full tree and reports the
// failure by returning false; the state is left as it was before the call.
//
// Viewport: only `refresh()` is called — never `toCenter()`, `scaleFit()` or
// `move()`. The root's screen position is preserved by an offset on the root
// element itself, not by touching the map-canvas transform.
//
// Re-apply: any later `refresh()` (theme change, data reload, a node's own
// caret) re-renders the full tree. Callers must invoke `reapplyRootOnly(mind)`
// after such a refresh while root-only is active, and `clearRootOnly(mind)`
// before loading a different map.

const STATE = new WeakMap();

export function isRootOnly(mind) {
  return STATE.has(mind);
}

export function hiddenBranchCount(mind) {
  return STATE.get(mind)?.hidden.length ?? 0;
}

function captureAnchor(mind) {
  const topic = mind.findEle?.(mind.nodeData.id);
  const rect = topic?.getBoundingClientRect?.();
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
}

function keepAnchored(mind, anchor) {
  const topic = mind.findEle?.(mind.nodeData.id);
  const rootElement = topic?.closest?.("me-root");
  if (!anchor || !topic || !rootElement) return;
  const rect = topic.getBoundingClientRect();
  const dx = anchor.x - (rect.left + rect.width / 2);
  const dy = anchor.y - (rect.top + rect.height / 2);
  // Screen px per layout px for this element, including every ancestor
  // transform (the map-canvas zoom is not the same number as `mind.scaleVal`).
  const scale = topic.offsetWidth ? rect.width / topic.offsetWidth : 1;
  rootElement.style.transform = `translate(${dx / scale}px, ${dy / scale}px)`;
}

function renderRootOnly(mind, anchor) {
  const root = mind.nodeData;
  const branches = root.children;
  root.children = [];
  try {
    mind.refresh();
  } finally {
    root.children = branches;
  }
  keepAnchored(mind, anchor);
  return branches;
}

function renderFullTree(mind) {
  mind.refresh();
}

export function setRootOnly(mind, active) {
  if (!mind?.nodeData) return false;
  if (active) {
    if (STATE.has(mind)) return false;
    if (!mind.nodeData.children?.length) return false;
    const anchor = captureAnchor(mind);
    mind.clearSelection?.();
    let branches;
    try {
      branches = renderRootOnly(mind, anchor);
    } catch {
      try { renderFullTree(mind); } catch { /* DOM restore failed; state is unchanged */ }
      return false;
    }
    STATE.set(mind, { hidden: branches, anchor });
    return true;
  }
  const state = STATE.get(mind);
  if (!state) return false;
  try {
    renderFullTree(mind);
  } catch {
    try { renderRootOnly(mind, state.anchor); } catch { /* keep the DOM we can */ }
    return false;
  }
  STATE.delete(mind);
  return true;
}

export function reapplyRootOnly(mind) {
  const state = STATE.get(mind);
  if (!state || !mind?.nodeData) return false;
  try {
    state.hidden = renderRootOnly(mind, state.anchor);
  } catch {
    return false;
  }
  return true;
}

export function clearRootOnly(mind) {
  STATE.delete(mind);
}
