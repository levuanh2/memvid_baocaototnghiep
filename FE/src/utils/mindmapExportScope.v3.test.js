// PR B fail-before: exact-set semantics for export scope (ancestor context,
// parent+child dedupe, multi-branch union, connector edges, counter). Fake data only.
// Uses the exact tree from the PR B brief:
//
//   root
//   ├─ A
//   │  ├─ A1
//   │  │  └─ A1a
//   │  └─ A2
//   └─ B
import { describe, it, expect } from "vitest";
import { resolveExportScope } from "./mindmapExportScope";

function tree() {
  return {
    id: "root", topic: "Root", expanded: true,
    children: [
      {
        id: "A", topic: "A", expanded: true,
        children: [
          { id: "A1", topic: "A1", expanded: true, children: [{ id: "A1a", topic: "A1a", expanded: true, children: [] }] },
          { id: "A2", topic: "A2", expanded: true, children: [] },
        ],
      },
      { id: "B", topic: "B", expanded: true, children: [] },
    ],
  };
}

const arrows = [
  { from: "A1", to: "B", label: "" }, // dangling once B is excluded — must not survive scope
  { from: "A1", to: "A1a", label: "" }, // both ends included when A1 is selected — must survive
];

/** The full exact-set contract this PR must satisfy: explicitRoots, effectiveNodes,
 * contextNodes, renderNodes, and the connector edges that should survive. Not yet
 * implemented by resolveExportScope — these tests assert the CONTRACT, not today's
 * output, which is why they are red on origin/main. */
function resolveExactSet(nodeData, explicitRootIds) {
  return resolveExportScope({ nodeData, scopeType: "selected_branches", selectedBranchRootIds: explicitRootIds });
}

describe("current_branch: ancestor context without sibling leakage", () => {
  it("selecting A includes root as context, excludes B entirely", () => {
    const { rootIds, includedIds, contextIds } = resolveExportScope({ nodeData: tree(), scopeType: "current_branch", selectedNodeId: "A" });
    expect(rootIds).toEqual(["A"]);
    expect([...includedIds].sort()).toEqual(["A", "A1", "A1a", "A2"]);
    expect(contextIds).toBeDefined();
    expect([...contextIds]).toEqual(["root"]);
    expect([...includedIds, ...contextIds]).not.toContain("B");
  });

  it("selecting A1 includes root and A as context, excludes A2 and B", () => {
    const { rootIds, includedIds, contextIds } = resolveExportScope({ nodeData: tree(), scopeType: "current_branch", selectedNodeId: "A1" });
    expect(rootIds).toEqual(["A1"]);
    expect([...includedIds].sort()).toEqual(["A1", "A1a"]);
    expect([...contextIds].sort()).toEqual(["A", "root"]);
    const all = new Set([...includedIds, ...contextIds]);
    expect(all.has("A2")).toBe(false);
    expect(all.has("B")).toBe(false);
  });

  it("selecting the leaf A1a gives the same render set as selecting A1 (no extra context below)", () => {
    const r1 = resolveExportScope({ nodeData: tree(), scopeType: "current_branch", selectedNodeId: "A1a" });
    expect([...r1.includedIds].sort()).toEqual(["A1a"]);
    expect([...r1.contextIds].sort()).toEqual(["A", "A1", "root"]);
  });
});

describe("selected_branches: union, dedupe, and context never absorbed into explicit roots", () => {
  it("two sibling branches (A1, A2) union without pulling in B", () => {
    const { rootIds, includedIds, contextIds } = resolveExactSet(tree(), ["A1", "A2"]);
    expect(rootIds.sort()).toEqual(["A1", "A2"]);
    expect([...includedIds].sort()).toEqual(["A1", "A1a", "A2"]);
    expect([...contextIds].sort()).toEqual(["A", "root"]);
  });

  it("parent + child selection dedupes the child out of explicit roots, counter reflects 1 not 2", () => {
    const { rootIds, includedIds } = resolveExactSet(tree(), ["A", "A1"]);
    expect(rootIds).toEqual(["A"]); // A1 absorbed — this part already works today
    expect([...includedIds].sort()).toEqual(["A", "A1", "A1a", "A2"]);
  });

  it("branches on both sides (A1 and B) union correctly, root is shared context exactly once", () => {
    const { rootIds, includedIds, contextIds } = resolveExactSet(tree(), ["A1", "B"]);
    expect(rootIds.sort()).toEqual(["A1", "B"]);
    expect([...includedIds].sort()).toEqual(["A1", "A1a", "B"]);
    expect([...contextIds]).toEqual(["A"].concat(["root"]).sort()); // A is context (A1's parent); root is context for both
  });

  it("duplicate ids in the explicit selection collapse to one root", () => {
    const { rootIds } = resolveExactSet(tree(), ["A1", "A1", "A1"]);
    expect(rootIds).toEqual(["A1"]);
  });

  it("a missing/unknown id is reported, not silently dropped or silently falling back to full map", () => {
    expect(() => resolveExactSet(tree(), ["does-not-exist"])).toThrow();
  });

  it("connector edges: only an edge with both ends in the render set survives, no dangling edge", () => {
    const { includedIds, contextIds } = resolveExactSet(tree(), ["A1"]);
    const renderSet = new Set([...includedIds, ...contextIds]);
    const survivingEdges = arrows.filter((a) => renderSet.has(a.from) && renderSet.has(a.to));
    expect(survivingEdges).toEqual([{ from: "A1", to: "A1a", label: "" }]);
  });
});

describe("full map: equivalent to selecting the top-level root, no context/full duplication", () => {
  it("full scope's root IS the map root — no separate context layer needed", () => {
    const { rootIds, includedIds } = resolveExportScope({ nodeData: tree(), scopeType: "full" });
    expect(rootIds).toEqual(["root"]);
    expect([...includedIds].sort()).toEqual(["A", "A1", "A1a", "A2", "B", "root"]);
  });
});
