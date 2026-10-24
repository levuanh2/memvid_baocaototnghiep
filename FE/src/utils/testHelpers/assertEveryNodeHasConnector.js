const finiteRect = (r) => r && [r.x, r.y, r.width, r.height].every(Number.isFinite)
  && r.width >= 0 && r.height >= 0;

const gap = (a, b) => Math.hypot(
  Math.max(a.x - b.x - b.width, b.x - a.x - a.width, 0),
  Math.max(a.y - b.y - b.height, b.y - a.y - a.height, 0),
);

// Test-only contract for extractGeometryManifest v1. Callers supply topology
// because the manifest has rectangle bounds but no parents or path endpoints.
export function assertEveryNodeHasConnector(
  manifest,
  { parentById, presentationRootId, presentationRootIds, tolerancePx = 4 } = {},
) {
  const roots = new Set(presentationRootIds || (presentationRootId ? [presentationRootId] : []));
  if (!parentById || roots.size === 0 || !Number.isFinite(tolerancePx) || tolerancePx < 0) {
    throw new Error("Supply parentById, presentationRootId(s) and a finite bitmap-pixel tolerance");
  }
  const nodes = new Map(manifest.nodes.map((node) => [node.id, node]));
  for (const rootId of roots) {
    if (!nodes.has(rootId)) throw new Error(`Missing presentation root ${rootId}`);
  }
  if (nodes.size !== manifest.nodes.length) throw new Error("Duplicate rendered node IDs");
  for (const node of nodes.values()) {
    if (!finiteRect(node) || node.width === 0 || node.height === 0) {
      throw new Error(`Invalid node box ${node.id}: ${JSON.stringify(node)}`);
    }
  }
  const paths = manifest.connectors;
  const invalid = paths.flatMap((path, index) => (
    !finiteRect(path) || (path.width === 0 && path.height === 0) ? [index] : []
  ));
  if (invalid.length) throw new Error(`Invalid/degenerate connector bounds at indices ${invalid.join(",")}`);
  const edges = [...nodes.values()].filter((node) => !roots.has(node.id)).map((node) => {
    const parentId = parentById instanceof Map ? parentById.get(node.id) : parentById[node.id];
    const parent = nodes.get(parentId);
    if (!parent) throw new Error(`Missing rendered parent for ${node.id}: ${parentId}`);
    const candidates = [];
    const distances = paths.map((path, index) => {
      const childGap = gap(path, node);
      const parentGap = gap(path, parent);
      const union = {
        left: Math.min(node.x, parent.x),
        top: Math.min(node.y, parent.y),
        right: Math.max(node.x + node.width, parent.x + parent.width),
        bottom: Math.max(node.y + node.height, parent.y + parent.height),
      };
      const overshoot = Math.max(
        union.left - path.x,
        union.top - path.y,
        path.x + path.width - union.right,
        path.y + path.height - union.bottom,
        0,
      );
      if (Math.max(childGap, parentGap, overshoot) <= tolerancePx) candidates.push(index);
      return { index, childGap, parentGap, overshoot };
    }).sort((a, b) => Math.max(a.childGap, a.parentGap, a.overshoot)
      - Math.max(b.childGap, b.parentGap, b.overshoot));
    return { nodeId: node.id, parentId, candidates, nearest: distances[0] ?? null };
  });
  const owner = new Map();
  function assign(edgeIndex, seen) {
    for (const pathIndex of edges[edgeIndex].candidates) {
      if (seen.has(pathIndex)) continue;
      seen.add(pathIndex);
      if (!owner.has(pathIndex) || assign(owner.get(pathIndex), seen)) {
        owner.set(pathIndex, edgeIndex);
        return true;
      }
    }
    return false;
  }
  for (let index = 0; index < edges.length; index += 1) {
    if (!assign(index, new Set())) {
      throw new Error(`No distinct plausible parent connector: ${JSON.stringify({
        ...edges[index], nodeCount: nodes.size, pathCount: paths.length, tolerancePx,
      })}`);
    }
  }
  return { nodeCount: nodes.size, pathCount: paths.length, matchedEdgeCount: owner.size };
}
