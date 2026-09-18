// Deterministic layout contract for the Mind Elixir renderer.
// This module is intentionally DOM- and library-free so the balancing rules
// can be tested without creating a canvas instance.

export const LEFT = 0;
export const RIGHT = 1;
export const MAX_TOPIC_LENGTH = 100;

// A restrained, high-contrast branch palette. Colors are assigned from the
// source order of a top-level branch, never from the result of side balancing,
// so the same record keeps the same visual identity across renders.
export const BRANCH_COLORS = [
  "#126CF2", "#1F4033", "#B5821F", "#4A5A8A", "#8A4A3E", "#6B4F3A", "#2C6777", "#6A4C93",
];

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

export function compactTopic(value, maxLength = MAX_TOPIC_LENGTH) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const limit = Math.max(12, maxLength - 1);
  const boundary = text.slice(0, limit + 1).lastIndexOf(" ");
  const cut = boundary >= 12 ? boundary : limit;
  return `${text.slice(0, cut).trim()}…`;
}

function buildChildren(nodes) {
  const children = new Map();
  for (const node of nodes) {
    if (node.parent == null) continue;
    if (!children.has(node.parent)) children.set(node.parent, []);
    children.get(node.parent).push(node);
  }
  for (const list of children.values()) list.sort(byOrder);
  return children;
}

/**
 * Assigns only the root's direct branches to LEFT/RIGHT. Descendants inherit
 * the branch's direction from Mind Elixir's SIDE layout.
 *
 * Weight is the complete descendant count including the branch root. Branches
 * are sorted by descending weight for assignment only; output order remains
 * semantic/document order. Ties are resolved by the original order and id.
 */
export function assignBranchDirections(nodes, { left = LEFT, right = RIGHT } = {}) {
  const list = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
  const children = buildChildren(list);
  const weights = new Map();
  const visiting = new Set();

  const weightOf = (node) => {
    const id = String(node.id);
    if (weights.has(id)) return weights.get(id);
    if (visiting.has(id)) return 1; // malformed cycle: stay finite and stable
    visiting.add(id);
    const weight = 1 + (children.get(id) || []).reduce((sum, child) => sum + weightOf(child), 0);
    visiting.delete(id);
    weights.set(id, weight);
    return weight;
  };
  for (const node of list) weightOf(node);

  const root = list.find((node) => node.kind === "root" || node.parent == null);
  const branches = root ? (children.get(String(root.id)) || []).slice().sort(byOrder) : [];
  const assignment = new Map();
  let leftWeight = 0;
  let rightWeight = 0;
  const sortedForAssignment = branches.slice().sort((a, b) => (
    (weights.get(String(b.id)) - weights.get(String(a.id))) || byOrder(a, b) || String(a.id).localeCompare(String(b.id))
  ));

  for (const branch of sortedForAssignment) {
    const id = String(branch.id);
    if (leftWeight <= rightWeight) {
      assignment.set(id, left);
      leftWeight += weights.get(id);
    } else {
      assignment.set(id, right);
      rightWeight += weights.get(id);
    }
  }

  const colors = new Map();
  branches.forEach((branch, index) => colors.set(String(branch.id), BRANCH_COLORS[index % BRANCH_COLORS.length]));
  return { rootId: root ? String(root.id) : null, directions: assignment, weights, colors, branches };
}

export function layoutVersionFor(record) {
  return record?.layout_version || record?.layoutVersion || record?.generator?.layout_version || "";
}

export function generationProfileFor(record) {
  return record?.generation_profile || record?.generationProfile || record?.generator?.generation_profile || "";
}
