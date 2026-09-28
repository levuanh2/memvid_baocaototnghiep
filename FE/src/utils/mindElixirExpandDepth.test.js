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
