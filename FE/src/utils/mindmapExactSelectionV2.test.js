import { describe, expect, it } from "vitest";
import { buildDocumentScopePayload } from "./mindmapDocumentScopePayload";
import { buildExportTree, resolveExportScope } from "./mindmapExportScope";

function fixture() {
  return {
    id: "root", topic: "Root", expanded: true, children: [
      {
        id: "left", topic: "Left", direction: 0, expanded: true, children: [
          {
            id: "p", topic: "P", expanded: true, children: [
              { id: "a", topic: "A", expanded: true, children: [] },
              { id: "b", topic: "B", expanded: true, children: [] },
              { id: "c", topic: "C", expanded: false, children: [{ id: "c1", topic: "C1", children: [] }] },
            ],
          },
          { id: "left-unused", topic: "Left unused", children: [] },
        ],
      },
      { id: "right", topic: "Right", direction: 1, children: [{ id: "r1", topic: "R1", children: [] }] },
    ],
  };
}

function exact(ids) {
  return resolveExportScope({
    nodeData: fixture(), scopeType: "selected_branches",
    selectedBranchRootIds: ids, includeDescendants: false,
  });
}

describe("exact checked-node selection V2", () => {
  it("A+B keeps only P as context and omits Root/C", () => {
    const result = exact(["a", "b"]);
    expect([...result.explicitSelectedIds]).toEqual(["a", "b"]);
    expect([...result.includedIds]).toEqual(["a", "b"]);
    expect([...result.contextIds]).toEqual(["p"]);
    expect(result.presentationRootId).toBe("p");
    expect([...result.renderIds].sort()).toEqual(["a", "b", "p"]);
  });

  it("parent+child preserves both explicit IDs and includes no unchecked children", () => {
    const result = exact(["p", "a"]);
    expect([...result.explicitSelectedIds]).toEqual(["p", "a"]);
    expect([...result.includedIds]).toEqual(["p", "a"]);
    expect([...result.contextIds]).toEqual([]);
    expect(result.presentationRootId).toBe("p");
  });

  it("one checked node is the presentation root with no ancestors or descendants", () => {
    const result = exact(["a"]);
    expect([...result.renderIds]).toEqual(["a"]);
    expect(result.presentationRootId).toBe("a");
  });

  it("keeps only explicit nodes when automatic parent inclusion is disabled", () => {
    const result = resolveExportScope({
      nodeData: fixture(), scopeType: "selected_branches",
      selectedBranchRootIds: ["a", "r1"], includeDescendants: false,
      contextMode: "none",
    });
    expect([...result.explicitSelectedIds]).toEqual(["a", "r1"]);
    expect([...result.contextIds]).toEqual([]);
    expect([...result.renderIds]).toEqual(["a", "r1"]);
    expect(result.presentationRootIds).toEqual(["a", "r1"]);
  });

  it("respects an explicitly suppressed auto-added parent without changing checked IDs", () => {
    const result = resolveExportScope({
      nodeData: fixture(), scopeType: "selected_branches",
      selectedBranchRootIds: ["a", "r1"], includeDescendants: false,
      suppressedContextIds: ["root"],
    });
    expect([...result.explicitSelectedIds]).toEqual(["a", "r1"]);
    expect([...result.contextIds].sort()).toEqual(["left", "p", "right"]);
    expect([...result.renderIds]).not.toContain("root");
    expect(result.presentationRootIds).toEqual(["left", "right"]);
  });

  it("left-only selection omits the global root and right side", () => {
    const result = exact(["p", "a", "b"]);
    expect(result.presentationRootId).toBe("p");
    expect([...result.renderIds].sort()).toEqual(["a", "b", "p"]);
  });

  it("cross-side selection uses global root and intermediate branches as context", () => {
    const result = exact(["a", "r1"]);
    expect(result.presentationRootId).toBe("root");
    expect([...result.contextIds].sort()).toEqual(["left", "p", "right", "root"]);
  });

  it("uses the deepest shared LCA and necessary intermediate nodes even below a collapsed parent", () => {
    const result = exact(["a", "c1"]);
    expect(result.presentationRootId).toBe("p");
    expect([...result.includedIds].sort()).toEqual(["a", "c1"]);
    expect([...result.contextIds].sort()).toEqual(["c", "p"]);
    expect([...result.renderIds].sort()).toEqual(["a", "c", "c1", "p"]);
  });

  it("builds one tree rooted at the LCA and filters dangling cross-relations", () => {
    const result = exact(["a", "b"]);
    const tree = buildExportTree({
      nodeData: fixture(), ...result, arrows: [
        { from: "a", to: "b", label: "kept" },
        { from: "a", to: "c", label: "dropped" },
      ],
    });
    expect(tree.roots.map((node) => node.node_id)).toEqual(["p"]);
    expect(tree.roots[0].children.map((node) => node.node_id)).toEqual(["a", "b"]);
    expect(tree.relations).toEqual([{ source: "a", target: "b", label: "kept" }]);
  });

  it("keeps explicit includeDescendants:true legacy subtree semantics", () => {
    const result = resolveExportScope({
      nodeData: fixture(), scopeType: "selected_branches",
      selectedBranchRootIds: ["p", "a"], includeDescendants: true,
    });
    expect(result.rootIds).toEqual(["p"]);
    expect([...result.includedIds].sort()).toEqual(["a", "b", "c", "c1", "p"]);
  });

  it("document checkbox payload opts into exact membership", () => {
    expect(buildDocumentScopePayload({
      mind: { nodeData: fixture() }, scopeType: "selected_branches",
      selectedBranchRootIds: ["a", "b"], visibleOnly: false,
    }).include_descendants).toBe(false);
  });
});
