import { describe, expect, it } from "vitest";
import { buildExportTree, resolveExportScope } from "./mindmapExportScope";

const TREE = {
  id: "F", topic: "F", children: [
    {
      id: "E", topic: "E", children: [
        { id: "A", topic: "A", children: [] },
        { id: "B", topic: "B", children: [] },
        { id: "C", topic: "C", children: [] },
        { id: "D", topic: "D", children: [] },
      ],
    },
    { id: "J", topic: "J", children: [] },
  ],
};

function exact(explicit, options = {}) {
  return resolveExportScope({
    nodeData: TREE,
    scopeType: "selected_branches",
    selectedBranchRootIds: explicit,
    includeDescendants: false,
    ...options,
  });
}

describe("Exact Node Export V3 hierarchical auto-parent projection", () => {
  it.each([
    [["A"], [], ["A"]],
    [["A", "B"], ["E"], ["A", "B", "E"]],
    [["A", "B", "C"], ["E"], ["A", "B", "C", "E"]],
    [["E", "J"], ["F"], ["E", "F", "J"]],
    [["A", "J"], ["E", "F"], ["A", "E", "F", "J"]],
    [["A", "B", "J"], ["E", "F"], ["A", "B", "E", "F", "J"]],
    [["A", "B", "C", "D"], ["E"], ["A", "B", "C", "D", "E"]],
    [["E"], [], ["E"]],
    [["F"], [], ["F"]],
  ])("explicit %j adds only minimal parents", (explicit, context, rendered) => {
    const result = exact(explicit);
    expect(result.explicitSelectedIds).toEqual(explicit);
    expect([...result.contextIds].sort()).toEqual(context);
    expect([...result.renderIds].sort()).toEqual(rendered);
  });

  it("keeps explicit, automatic and suppressed identities separate", () => {
    const result = exact(["A", "J"], { suppressedContextIds: ["E"] });
    expect(result.explicitSelectedIds).toEqual(["A", "J"]);
    expect([...result.minimalContextIds].sort()).toEqual(["E", "F"]);
    expect([...result.contextIds]).toEqual(["F"]);
    expect([...result.suppressedContextIds]).toEqual(["E"]);
    expect([...result.renderIds].sort()).toEqual(["A", "F", "J"]);
    expect(result.presentationRootIds).toEqual(["F", "A"]);
  });

  it("builds a canonical forest with no synthetic visible root when context is disabled", () => {
    const result = exact(["A", "B"], { contextMode: "none" });
    const tree = buildExportTree({
      nodeData: TREE,
      ...result,
      mapId: "v3",
      schemaVersion: 3,
    });
    expect(tree.roots.map((root) => root.node_id)).toEqual(["A", "B"]);
    expect(tree.roots.map((root) => root.parent_id)).toEqual([null, null]);
    expect(tree.roots.flatMap((root) => root.children)).toEqual([]);
  });

  it("works recursively on a twenty-level chain without adding a global ancestor", () => {
    let node = { id: "N20", topic: "N20", children: [] };
    for (let depth = 19; depth >= 1; depth -= 1) {
      node = { id: `N${depth}`, topic: `N${depth}`, children: [node] };
    }
    node.children[0].children.push({ id: "S2", topic: "S2", children: [] });
    const result = resolveExportScope({
      nodeData: node,
      scopeType: "selected_branches",
      selectedBranchRootIds: ["N20", "S2"],
      includeDescendants: false,
    });
    const expectedContext = new Set(Array.from({ length: 18 }, (_, index) => `N${index + 2}`));
    expect(result.contextIds).toEqual(expectedContext);
    expect(result.renderIds).toEqual(new Set([...expectedContext, "N20", "S2"]));
    expect(result.renderIds.has("N1")).toBe(false);
  });
});
