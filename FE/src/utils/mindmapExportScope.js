// Canonical export tree + scope resolver (Export Studio, round 1: client
// foundation). Pure — takes plain data (mind-elixir's live `nodeData` tree,
// the sidecar Map of {note, chunkRefs, ...} MindElixirView already builds,
// and the `arrows` relation list), never touches the DOM or a rendered HTML
// surface. This is deliberate: serializing the currently-displayed HTML
// (what an earlier PNG-only export did, out of necessity — an image has no
// other source) would tie DOCX/PDF/XLSX generation to whatever happens to
// be collapsed/visible/styled on screen at click time, when the whole point
// of scope + "include descendants regardless of collapse" is that export
// content is independent of current view state.
//
// mind-elixir's own `expandNodeAll`/`expandNode` toggle `node.expanded` on
// the SAME live objects this reads (verified in mindElixirExpandDepth.js's
// and mindElixirExpandDecorator.js's own comments) — this module never
// mutates that tree, only reads it.

export const SCOPE_TYPES = /** @type {const} */ (["full", "current_branch", "selected_branches", "visible"]);

class ExportScopeError extends Error {}
export class UnknownNodeIdError extends ExportScopeError {}
export class NoSelectionError extends ExportScopeError {}

/** id -> node, id -> parentId, over the WHOLE live tree (used for validation, ancestor walks, and node_id/parent_id output). */
function indexTree(nodeData) {
  const byId = new Map();
  const parentOf = new Map();
  const walk = (node, parentId, depth) => {
    byId.set(node.id, { node, depth, parentId });
    parentOf.set(node.id, parentId);
    (node.children || []).forEach((c) => walk(c, node.id, depth + 1));
  };
  walk(nodeData, null, 0);
  return { byId, parentOf };
}

function isAncestorOf(parentOf, maybeAncestorId, id) {
  let cur = parentOf.get(id);
  while (cur != null) {
    if (cur === maybeAncestorId) return true;
    cur = parentOf.get(cur);
  }
  return false;
}

/**
 * "3 nhánh được chọn, một là con của nhánh khác" -> drop the descendant from
 * the ROOT list (its subtree is already covered by its ancestor's). Order
 * preserved as document/tree order, not click order — callers pass ids in
 * whatever order the user clicked them; this re-sorts by each id's position
 * in a depth-first walk of the tree so output order is always stable and
 * document-shaped, never selection-order-dependent.
 */
function dedupeAndOrderRoots(ids, index, nodeData) {
  const { parentOf } = index;
  const kept = ids.filter((id) => !ids.some((other) => other !== id && isAncestorOf(parentOf, other, id)));
  const order = [];
  const walk = (node) => { order.push(node.id); (node.children || []).forEach(walk); };
  walk(nodeData);
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...new Set(kept)].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
}

/** Every node currently on-screen given the live expanded-chain — a node is visible iff every ancestor down to (not including) itself is expanded. The node itself may be collapsed and still visible (its children just aren't). */
function computeVisibleIds(nodeData) {
  const visible = new Set();
  const walk = (node) => {
    visible.add(node.id);
    if (node.expanded === false) return; // children not on-screen
    (node.children || []).forEach(walk);
  };
  walk(nodeData);
  return visible;
}

/**
 * Resolves a scope request against the live tree into an ordered, deduped,
 * validated list of export-root ids plus the full set of node ids that
 * scope includes. Throws UnknownNodeIdError for any id not present in THIS
 * map's tree (the cross-map-selection guard — a node id from a different
 * map is simply not in `nodeData`, so it's caught the same way a typo'd id
 * would be, with no separate "which map is this" bookkeeping needed) and
 * NoSelectionError when a branch scope has nothing to root on.
 */
export function resolveExportScope({
  nodeData, scopeType, selectedNodeId, selectedBranchRootIds,
  includeDescendants = true, visibleOnly = false,
}) {
  if (!nodeData) throw new ExportScopeError("resolveExportScope: nodeData is required");
  const index = indexTree(nodeData);

  const assertKnown = (id) => {
    if (!index.byId.has(id)) throw new UnknownNodeIdError(`node_id not in this map: ${id}`);
  };

  let rootIds;
  if (scopeType === "full" || scopeType === "visible") {
    rootIds = [nodeData.id];
  } else if (scopeType === "current_branch") {
    if (!selectedNodeId) throw new NoSelectionError("current_branch scope requires a selected node");
    assertKnown(selectedNodeId);
    rootIds = [selectedNodeId];
  } else if (scopeType === "selected_branches") {
    const ids = selectedBranchRootIds || [];
    if (!ids.length) throw new NoSelectionError("selected_branches scope requires at least one selected root");
    ids.forEach(assertKnown);
    rootIds = dedupeAndOrderRoots(ids, index, nodeData);
  } else {
    throw new ExportScopeError(`unknown scopeType: ${scopeType}`);
  }

  const effectiveVisibleOnly = visibleOnly || scopeType === "visible";
  const visibleIds = effectiveVisibleOnly ? computeVisibleIds(nodeData) : null;

  const includedIds = new Set();
  const collect = (id) => {
    if (visibleIds && !visibleIds.has(id)) return;
    includedIds.add(id);
    if (!includeDescendants) return;
    const entry = index.byId.get(id);
    (entry?.node.children || []).forEach((c) => {
      if (visibleIds && !visibleIds.has(c.id)) return;
      collect(c.id);
    });
  };
  rootIds.forEach(collect);

  return { rootIds, includedIds, index };
}

/** Total descendant+self count for a node currently included (used by the UI summary line — "3 nhánh · 28 node · gồm 19 node đang thu gọn"). */
export function countIncluded(includedIds) {
  return includedIds.size;
}

/** How many of the included nodes are currently collapsed-and-hidden by the CURRENT view (i.e. would be invisible in the live canvas, but ARE included because includeDescendants ignored collapse state). */
export function countHiddenIncluded(nodeData, includedIds) {
  const visibleIds = computeVisibleIds(nodeData);
  let n = 0;
  for (const id of includedIds) if (!visibleIds.has(id)) n += 1;
  return n;
}

/**
 * Builds the canonical ExportTree (section 8's contract) for one root,
 * restricted to `includedIds`. `sidecar` is MindElixirView's own note/
 * citation Map (id -> {note, chunkRefs, ...}); `arrows` is mind-elixir's
 * live relation list, filtered to only relations whose BOTH endpoints
 * survived the scope (a relation pointing outside the exported set can't be
 * rendered meaningfully).
 */
export function buildExportTree({ nodeData, rootIds, includedIds, sidecar, arrows, mapId, schemaVersion }) {
  const index = indexTree(nodeData);
  const toNode = (id, depth) => {
    const entry = index.byId.get(id);
    const node = entry.node;
    const side = sidecar?.get(id);
    const children = (node.children || [])
      .filter((c) => includedIds.has(c.id))
      .map((c) => toNode(c.id, depth + 1));
    return {
      node_id: id,
      parent_id: index.parentOf.get(id),
      topic: node.topic || "",
      note: side?.note || "",
      depth,
      direction: node.direction,
      branch_color: node.branchColor,
      expanded: node.expanded !== false,
      visible: computeVisibleIds(nodeData).has(id),
      citations: side?.chunkRefs || [],
      children,
    };
  };
  const roots = rootIds.map((id) => toNode(id, 0));
  const relations = (arrows || [])
    .filter((a) => includedIds.has(a.from) && includedIds.has(a.to))
    .map((a) => ({ source: a.from, target: a.to, label: a.label || "" }));
  return { map_id: mapId, schema_version: schemaVersion, roots, relations };
}

/** Flattens an ExportTree into ordered rows — the shape XLSX's Nodes sheet (section 7.4) needs directly: one row per node, stable document order, node identity by node_id never by title. */
export function flattenExportTree(tree) {
  const rows = [];
  let order = 0;
  const walk = (node, branchPath) => {
    const path = [...branchPath, node.topic];
    rows.push({
      map_id: tree.map_id, node_id: node.node_id, parent_id: node.parent_id,
      branch_path: path.join(" / "), depth: node.depth, order: order++,
      topic: node.topic, note: node.note,
      collapsed: !node.expanded, visible: node.visible,
      source_references: node.citations,
    });
    node.children.forEach((c) => walk(c, path));
  };
  tree.roots.forEach((r) => walk(r, []));
  return rows;
}
