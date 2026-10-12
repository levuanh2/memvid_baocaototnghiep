import { describe, it, expect } from "vitest";
import { setExpandedToDepth } from "./mindElixirExpandDepth";

function tree() {
  return {
    id: "root", expanded: false,
    children: [
      {
        id: "a", expanded: false,
        children: [
          { id: "a1", expanded: false, children: [{ id: "a1x", expanded: false, children: [] }] },
        ],
      },
      { id: "b", expanded: false, children: [{ id: "b1", expanded: false, children: [] }] },
      { id: "leaf", expanded: false, children: [] },
    ],
  };
}

describe("setExpandedToDepth", () => {
  it("depth=2 expands root and its children, collapses grandchildren", () => {
    const t = tree();
    setExpandedToDepth(t, 2);
    expect(t.expanded).toBe(true);
    expect(t.children[0].expanded).toBe(true);   // "a" — depth 1 < 2
    expect(t.children[0].children[0].expanded).toBe(false); // "a1" — depth 2, not < 2
  });

  it("depth=3 expands one level deeper than depth=2", () => {
    const t = tree();
    setExpandedToDepth(t, 3);
    expect(t.children[0].children[0].expanded).toBe(true); // "a1" — depth 2 < 3
    expect(t.children[0].children[0].children[0].expanded).toBe(false); // "a1x" — depth 3, not < 3
  });

  it("leaves without children are untouched (no expanded flag forced on a leaf)", () => {
    const t = tree();
    setExpandedToDepth(t, 2);
    const leaf = t.children[2];
    expect(leaf.expanded).toBe(false); // unchanged from initial value — leaves are skipped entirely
  });

  it("depth=1 collapses everything below root", () => {
    const t = tree();
    setExpandedToDepth(t, 1);
    expect(t.expanded).toBe(true);
    expect(t.children[0].expanded).toBe(false);
    expect(t.children[1].expanded).toBe(false);
  });

  it("is a no-op on a null/undefined tree", () => {
    expect(() => setExpandedToDepth(null, 2)).not.toThrow();
    expect(() => setExpandedToDepth(undefined, 2)).not.toThrow();
  });
});

// Phase 2 (PR D — Mind Map 5-level expand UX) addition. GUARD suite, not
// red-by-design: Phase 1 audit proved this math is already correct. Deeper,
// unbalanced fixture (5 distinct depths, 0..4) so depth 1/2/3 produce
// genuinely different node sets, per the brief's "không dùng map nông rồi
// kết luận logic depth bị lỗi".
function deepUnbalancedTree() {
  const d = { id: "d", topic: "D" };
  const c = { id: "c", topic: "C", children: [d] };
  const b = { id: "b", topic: "B", children: [c] };
  const a = { id: "a", topic: "A", children: [b] };
  const f = { id: "f", topic: "F" };
  const h = { id: "h", topic: "H" };
  const g = { id: "g", topic: "G", children: [h] };
  return { id: "root", topic: "Root", root: true, children: [a, f, g] };
}

function visibleIds(nodeData) {
  const out = [];
  const walk = (node) => {
    out.push(node.id);
    if (node.expanded === false) return;
    (node.children || []).forEach(walk);
  };
  walk(nodeData);
  return out.sort();
}

describe("setExpandedToDepth — depth<=N on a deep unbalanced fixture (guard, 5 distinct depths)", () => {
  it("depth=0 shows only the root", () => {
    const t = deepUnbalancedTree();
    setExpandedToDepth(t, 0);
    expect(visibleIds(t)).toEqual(["root"]);
  });

  it("depth=1 shows root + its direct children only (a, f, g — not b/h)", () => {
    const t = deepUnbalancedTree();
    setExpandedToDepth(t, 1);
    expect(visibleIds(t)).toEqual(["a", "f", "g", "root"]);
  });

  it("depth=2 adds b and h, still not c/d", () => {
    const t = deepUnbalancedTree();
    setExpandedToDepth(t, 2);
    expect(visibleIds(t)).toEqual(["a", "b", "f", "g", "h", "root"]);
  });

  it("depth=3 adds c, d still hidden", () => {
    const t = deepUnbalancedTree();
    setExpandedToDepth(t, 3);
    expect(visibleIds(t)).toEqual(["a", "b", "c", "f", "g", "h", "root"]);
  });

  it("depth=4 (>= max depth) reveals everything, same as 'full'", () => {
    const t = deepUnbalancedTree();
    setExpandedToDepth(t, 4);
    expect(visibleIds(t)).toEqual(["a", "b", "c", "d", "f", "g", "h", "root"]);
  });

  it("a tree shallower than the requested depth never errors and shows everything", () => {
    const shallow = { id: "root", topic: "Root", root: true, children: [{ id: "x", topic: "X" }] };
    expect(() => setExpandedToDepth(shallow, 10)).not.toThrow();
    expect(visibleIds(shallow)).toEqual(["root", "x"]);
  });

  it("is deterministic regardless of prior manual collapse state", () => {
    const t = deepUnbalancedTree();
    t.children[0].expanded = false; // manually collapse "a" first
    setExpandedToDepth(t, 2);
    expect(visibleIds(t)).toEqual(["a", "b", "f", "g", "h", "root"]);
  });

  it("re-applying the same depth twice is idempotent", () => {
    const t = deepUnbalancedTree();
    setExpandedToDepth(t, 2);
    const first = visibleIds(t);
    setExpandedToDepth(t, 2);
    expect(visibleIds(t)).toEqual(first);
  });
});
