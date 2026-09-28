// "Mở đến cấp 2/3" (Round: Export Studio + expand/collapse redesign).
//
// mind-elixir has no native "expand to depth N" API — only per-node
// `expandNode` and whole-subtree `expandNodeAll`. This walks the live
// `nodeData` tree directly and sets each node's `expanded` property, the
// exact field mind-elixir itself reads on render (`NodeObj.expanded?:
// boolean` — node_modules/mind-elixir/dist/types/types/index.d.ts).
//
// Root is depth 0 and always expanded (mind-elixir never hides the root's
// own children this way — depth here means "how many generations of
// children are visible", so depth=2 means root + its children + their
// children are shown, matching "Mở đến cấp 2" meaning the map is visible
// two levels deep).
//
// Caller must re-render afterward via `mind.layout(); mind.linkDiv();` —
// the same side-effect-free re-render pair MindElixirView's `fitIfReady`
// already establishes: recomputes geometry from `nodeData`, touches neither
// zoom nor pan/center, so this stays within the "no viewport reset" bar.
export function setExpandedToDepth(nodeData, maxDepth) {
  const walk = (node, depth) => {
    if (!node || !Array.isArray(node.children) || node.children.length === 0) return;
    node.expanded = depth < maxDepth;
    node.children.forEach((child) => walk(child, depth + 1));
  };
  walk(nodeData, 0);
}
