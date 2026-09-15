// Pure graph-relations reader for the Knowledge Inspector (Phase 5, Task 4).
// Zero LLM, zero backend call — everything here is derived from the SAME
// normalized node list (id/parent/order) `mindElixirAdapter.js` already
// builds a tree from. No new data source, no duplicate parser.
import { normalizeMindmapRecord } from "./mindmapNormalize";

// Built ONCE per mindmap load (see MindElixirView's init effect) — O(n) over
// the node list, never recomputed on node selection (Task 10).
export function buildGraphIndex(record) {
  const norm = normalizeMindmapRecord(record);
  const byId = new Map(norm.nodes.map((n) => [n.id, n]));
  const childrenOf = new Map();
  for (const n of norm.nodes) {
    if (n.parent == null || !byId.has(n.parent)) continue;
    if (!childrenOf.has(n.parent)) childrenOf.set(n.parent, []);
    childrenOf.get(n.parent).push(n);
  }
  for (const kids of childrenOf.values()) kids.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { byId, childrenOf };
}

const summarize = (n) => (n ? { id: n.id, title: n.title, number: n.number, kind: n.kind } : null);

// Task 4 — parent / children / siblings / prev / next, all from the tree
// shape alone. "Horizontal neighbours" and "previous/next" are the same
// relation (adjacent siblings, ordered) — kept as one pair, not duplicated
// under two names in the returned shape.
export function relationsFor(index, nodeId) {
  const { byId, childrenOf } = index;
  const node = byId.get(nodeId);
  if (!node) return { parent: null, children: [], siblings: [], prev: null, next: null };

  const parent = node.parent != null ? byId.get(node.parent) : null;
  const children = (childrenOf.get(nodeId) || []).map(summarize);
  const siblingList = parent ? (childrenOf.get(parent.id) || []) : [];
  const myIndex = siblingList.findIndex((s) => s.id === nodeId);
  const siblings = siblingList.filter((s) => s.id !== nodeId).map(summarize);
  const prev = myIndex > 0 ? summarize(siblingList[myIndex - 1]) : null;
  const next = myIndex >= 0 && myIndex < siblingList.length - 1 ? summarize(siblingList[myIndex + 1]) : null;

  return { parent: summarize(parent), children, siblings, prev, next };
}

// Feature Pack B (Cross Navigation) — Chat -> MindMap node. Reads the SAME
// per-node `chunkRefs` `normalizeMindmapRecord` already attaches (see
// mindmapNormalize.js) — no second data source, no sidecar dependency, one
// more pure reader over the exact index `relationsFor`/`headingPath` already
// use. Several nodes citing the same chunk is real and possible; returns the
// FIRST match in `byId`'s own iteration order — deterministic (Maps preserve
// insertion order, `byId` is built from `norm.nodes` in that same order
// every load), not "whichever happens to match."
export function findNodeByChunk(index, chunkId) {
  const target = String(chunkId ?? "");
  if (!target) return null;
  for (const [id, node] of index.byId) {
    if ((node.chunkRefs || []).some((c) => String(c) === target)) return id;
  }
  return null;
}

// Feature Pack D (Personal Knowledge Graph) — every non-root node in the
// currently loaded mindmap, as the same `summarize()` shape `relationsFor`
// already returns for parent/children/siblings. Used by
// `knowledgeEvolution.js`'s `partitionNodesByVisit`/`nodeHeatmap` to know the
// FULL set a session's `history[]` node visits are a subset of — without
// this, "unvisited"/"never opened" would have nothing to be relative to.
export function allNodeSummaries(index) {
  const out = [];
  for (const n of index.byId.values()) {
    if (n.kind === "root") continue;
    out.push(summarize(n));
  }
  return out;
}

// Task 6 — "current heading": ancestor chain from root down to (excluding)
// this node, for a breadcrumb. Root itself excluded (it's the document, not
// a heading).
export function headingPath(index, nodeId) {
  const { byId } = index;
  const chain = [];
  let cur = byId.get(nodeId);
  const guard = new Set(); // cycle safety — a malformed record must not hang this
  while (cur?.parent != null && byId.has(cur.parent) && !guard.has(cur.parent)) {
    guard.add(cur.parent);
    const p = byId.get(cur.parent);
    if (p.kind !== "root") chain.unshift(summarize(p));
    cur = p;
  }
  return chain;
}
