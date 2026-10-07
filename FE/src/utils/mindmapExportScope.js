// Canonical export tree + scope resolver (Export Studio). Pure — takes plain data
// (a nested tree shaped like mind-elixir's live `nodeData`, or a flat node list
// shaped like a saved record's `nodes`), never touches the DOM or a rendered HTML
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
//
// One tree shape, two sources: the live canvas (`resolveExportScope`, nested
// `nodeData`) and a saved/live-merged record (`resolveExportScopeFromRecord`,
// flat `nodes` list — see mindmapImageExport.js's `liveRecordForExport`). Both
// call the same `_resolveCore` so FE preview, FE image export and the BE
// document resolver (services/mindmap/export/scope.py) share one algorithm —
// never three separately-maintained copies.

export const SCOPE_TYPES = /** @type {const} */ (["full", "current_branch", "selected_branches", "visible"]);

class ExportScopeError extends Error {}
export class UnknownNodeIdError extends ExportScopeError {}
export class NoSelectionError extends ExportScopeError {}

function ancestorsOf(parentOf, id) {
  const out = [];
  let cur = parentOf.get(id);
  while (cur != null) { out.push(cur); cur = parentOf.get(cur); }
  return out;
}

function isAncestorOf(parentOf, maybeAncestorId, id) {
  return ancestorsOf(parentOf, id).includes(maybeAncestorId);
}

/**
 * "3 nhánh được chọn, một là con của nhánh khác" -> drop the descendant from
 * the ROOT list (its subtree is already covered by its ancestor's). Order
 * preserved as document/tree order, not click order — callers pass ids in
 * whatever order the user clicked them; this re-sorts by each id's position
 * in `order` (a precomputed id -> document-order-rank map) so output order
 * is always stable and document-shaped, never selection-order-dependent.
 */
function dedupeAndOrderRoots(ids, parentOf, order) {
  const kept = ids.filter((id) => !ids.some((other) => other !== id && isAncestorOf(parentOf, other, id)));
  return [...new Set(kept)].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/**
 * Shape-agnostic core: given id -> { parentId, childrenIds, isVisible? } and a
 * document-order rank map, resolves rootIds/includedIds/contextIds for a scope
 * request. `childrenOf(id)` returns child ids in document order already.
 */
function _resolveCore({
  rootNodeId, hasId, childrenOf, parentOf, order,
  scopeType, selectedNodeId, selectedBranchRootIds, includeDescendants, visibleOnly, isVisible,
}) {
  const assertKnown = (id) => {
    if (!hasId(id)) throw new UnknownNodeIdError(`node_id not in this map: ${id}`);
  };

  let rootIds;
  if (scopeType === "full" || scopeType === "visible") {
    rootIds = [rootNodeId];
  } else if (scopeType === "current_branch") {
    if (!selectedNodeId) throw new NoSelectionError("current_branch scope requires a selected node");
    assertKnown(selectedNodeId);
    rootIds = [selectedNodeId];
  } else if (scopeType === "selected_branches") {
    const ids = selectedBranchRootIds || [];
    if (!ids.length) throw new NoSelectionError("selected_branches scope requires at least one selected root");
    ids.forEach(assertKnown);
    rootIds = dedupeAndOrderRoots(ids, parentOf, order);
  } else {
    throw new ExportScopeError(`unknown scopeType: ${scopeType}`);
  }

  const effectiveVisibleOnly = visibleOnly || scopeType === "visible";

  const includedIds = new Set();
  const collect = (id) => {
    if (effectiveVisibleOnly && !isVisible(id)) return;
    includedIds.add(id);
    if (!includeDescendants) return;
    childrenOf(id).forEach((cid) => {
      if (effectiveVisibleOnly && !isVisible(cid)) return;
      collect(cid);
    });
  };
  rootIds.forEach(collect);

  // contextNodes = union(ancestors(root) for root in rootIds) - effectiveNodes. Never a
  // sibling, never a descendant of an ancestor — only the direct path up to the map root,
  // so a branch's siblings and a sibling's own subtree never leak into the render set.
  const contextIds = new Set();
  rootIds.forEach((id) => {
    ancestorsOf(parentOf, id).forEach((aid) => { if (!includedIds.has(aid)) contextIds.add(aid); });
  });

  return { rootIds, includedIds, contextIds };
}

/** id -> node, id -> parentId, over the WHOLE live tree (used for validation, ancestor walks, and node_id/parent_id output), plus a document-order rank for every id. */
function indexTree(nodeData) {
  const byId = new Map();
  const parentOf = new Map();
  const order = new Map();
  let rank = 0;
  const walk = (node, parentId, depth) => {
    byId.set(node.id, { node, depth, parentId });
    parentOf.set(node.id, parentId);
    order.set(node.id, rank++);
    (node.children || []).forEach((c) => walk(c, node.id, depth + 1));
  };
  walk(nodeData, null, 0);
  return { byId, parentOf, order };
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
 * Resolves a scope request against the LIVE canvas tree (mind-elixir's nested
 * `nodeData`) into rootIds (explicit roots, deduped/ordered), includedIds
 * (effectiveNodes — rootIds + their descendants) and contextIds (the minimal
 * ancestor path from the map root down to each root's parent — never a
 * sibling, never a sibling's subtree). Throws UnknownNodeIdError for any id
 * not present in THIS map's tree and NoSelectionError when a branch scope has
 * nothing to root on.
 */
export function resolveExportScope({
  nodeData, scopeType, selectedNodeId, selectedBranchRootIds,
  includeDescendants = true, visibleOnly = false,
}) {
  if (!nodeData) throw new ExportScopeError("resolveExportScope: nodeData is required");
  const index = indexTree(nodeData);
  const visibleIds = visibleOnly || scopeType === "visible" ? computeVisibleIds(nodeData) : null;
  const result = _resolveCore({
    rootNodeId: nodeData.id,
    hasId: (id) => index.byId.has(id),
    childrenOf: (id) => (index.byId.get(id)?.node.children || []).map((c) => c.id),
    parentOf: index.parentOf,
    order: index.order,
    scopeType, selectedNodeId, selectedBranchRootIds, includeDescendants, visibleOnly,
    isVisible: (id) => (visibleIds ? visibleIds.has(id) : true),
  });
  return { ...result, index };
}

/**
 * Same contract, for a FLAT node list (a saved record's `nodes`, or the
 * live-merged record `liveRecordForExport` builds — see mindmapImageExport.js).
 * No `visibleOnly`/`visible` scope: a record has no notion of canvas collapse.
 */
export function resolveExportScopeFromRecord(nodes, { scopeType, selectedNodeId, selectedBranchRootIds, includeDescendants = true }) {
  if (!nodes?.length) throw new ExportScopeError("resolveExportScopeFromRecord: nodes is required");
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parentOf = new Map(nodes.map((n) => [n.id, n.parent ?? null]));
  const childrenOf = new Map();
  nodes.forEach((n) => {
    if (n.parent != null) {
      if (!childrenOf.has(n.parent)) childrenOf.set(n.parent, []);
      childrenOf.get(n.parent).push(n.id);
    }
  });
  const order = new Map(nodes.map((n, i) => [n.id, n.order ?? i]));
  const rootNode = nodes.find((n) => n.parent == null || n.kind === "root");
  if (!rootNode) throw new ExportScopeError("resolveExportScopeFromRecord: no root node found");
  const result = _resolveCore({
    rootNodeId: rootNode.id,
    hasId: (id) => byId.has(id),
    childrenOf: (id) => [...(childrenOf.get(id) || [])].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
    parentOf,
    order,
    scopeType, selectedNodeId, selectedBranchRootIds, includeDescendants, visibleOnly: false,
    isVisible: () => true,
  });
  return { ...result, byId };
}

/** Total descendant+self count for a node currently included (used by the UI summary line — "3 nhánh · 28 node · gồm 19 node đang thu gọn"). This is the EXPLICIT selection's own weight — context ancestors are never counted here, so the counter always reflects what the user ticked, not the full render set. */
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
 * Builds the canonical ExportTree (section 8's contract), rooted at the map's
 * TRUE root and pruned to includedIds ∪ contextIds — never at rootIds
 * directly, so an ancestor-context node naturally keeps only the child that
 * leads to a selected branch, never a sibling or a sibling's subtree (the
 * tree-walk prune IS the "minimal ancestor path" rule, not a separate step).
 * Each node carries `is_context` (true for an ancestor-only node, false for
 * anything the selection actually includes) so a consumer can style context
 * nodes differently without a second pass. `sidecar` is MindElixirView's own
 * note/citation Map (id -> {note, chunkRefs, ...}); `arrows` is mind-elixir's
 * live relation list, filtered to only relations whose BOTH endpoints survived
 * the render set (a relation pointing outside it can't be rendered meaningfully).
 */
export function buildExportTree({ nodeData, includedIds, contextIds, sidecar, arrows, mapId, schemaVersion }) {
  const index = indexTree(nodeData);
  const renderSet = new Set([...includedIds, ...(contextIds || [])]);
  const visibleIds = computeVisibleIds(nodeData);
  const toNode = (id, depth) => {
    const entry = index.byId.get(id);
    const node = entry.node;
    const side = sidecar?.get(id);
    const children = (node.children || [])
      .filter((c) => renderSet.has(c.id))
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
      visible: visibleIds.has(id),
      is_context: !includedIds.has(id),
      citations: side?.chunkRefs || [],
      children,
    };
  };
  const roots = [toNode(nodeData.id, 0)];
  const relations = (arrows || [])
    .filter((a) => renderSet.has(a.from) && renderSet.has(a.to))
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
      collapsed: !node.expanded, visible: node.visible, is_context: node.is_context,
      source_references: node.citations,
    });
    node.children.forEach((c) => walk(c, path));
  };
  tree.roots.forEach((r) => walk(r, []));
  return rows;
}
