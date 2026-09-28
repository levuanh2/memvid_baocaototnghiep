import { describe, it, expect } from "vitest";
import {
  resolveExportScope, buildExportTree, flattenExportTree,
  countIncluded, countHiddenIncluded, UnknownNodeIdError, NoSelectionError,
} from "./mindmapExportScope";

// root
// ├── a (expanded, direction 0)
// │   ├── a1 (COLLAPSED — expanded:false)
// │   │   └── a1x
// │   └── a2 (leaf)
// └── b (expanded, direction 1)
//     └── b1 (leaf)
function tree() {
  return {
    id: "root", topic: "Root", expanded: true,
    children: [
      {
        id: "a", topic: "Alpha", expanded: true, direction: 0, branchColor: "#126CF2",
        children: [
          { id: "a1", topic: "A1", expanded: false, children: [{ id: "a1x", topic: "A1X", expanded: true, children: [] }] },
          { id: "a2", topic: "A2", expanded: true, children: [] },
        ],
      },
      {
        id: "b", topic: "Beta", expanded: true, direction: 1, branchColor: "#FF9800",
        children: [{ id: "b1", topic: "B1", expanded: true, children: [] }],
      },
    ],
  };
}

const sidecar = new Map([
  ["a1x", { note: "hidden note", chunkRefs: ["c0"] }],
  ["b1", { note: "b1 note", chunkRefs: [] }],
]);
const arrows = [
  { from: "a1x", to: "b1", label: "liên quan" },
  { from: "a2", to: "ghost-outside-scope", label: "dẫn tới" },
];

describe("resolveExportScope", () => {
  it("full scope includes every node, ignoring collapsed state", () => {
    const { includedIds } = resolveExportScope({ nodeData: tree(), scopeType: "full" });
    expect([...includedIds].sort()).toEqual(["a", "a1", "a1x", "a2", "b", "b1", "root"].sort());
  });

  it("current_branch scope roots on the selected node and includes its full subtree", () => {
    const { rootIds, includedIds } = resolveExportScope({ nodeData: tree(), scopeType: "current_branch", selectedNodeId: "a" });
    expect(rootIds).toEqual(["a"]);
    expect([...includedIds].sort()).toEqual(["a", "a1", "a1x", "a2"].sort());
    expect(includedIds.has("root")).toBe(false);
    expect(includedIds.has("b")).toBe(false);
  });

  it("current_branch with no selection throws NoSelectionError", () => {
    expect(() => resolveExportScope({ nodeData: tree(), scopeType: "current_branch" })).toThrow(NoSelectionError);
  });

  it("selected_branches includes the union of multiple roots' subtrees", () => {
    const { rootIds, includedIds } = resolveExportScope({
      nodeData: tree(), scopeType: "selected_branches", selectedBranchRootIds: ["a1", "b"],
    });
    expect(rootIds.sort()).toEqual(["a1", "b"].sort());
    expect([...includedIds].sort()).toEqual(["a1", "a1x", "b", "b1"].sort());
  });

  it("selected_branches drops a selected node that is a descendant of another selected node (parent+child dedupe)", () => {
    const { rootIds, includedIds } = resolveExportScope({
      nodeData: tree(), scopeType: "selected_branches", selectedBranchRootIds: ["a", "a2"],
    });
    expect(rootIds).toEqual(["a"]); // "a2" dropped — already covered by its ancestor "a"
    expect([...includedIds].sort()).toEqual(["a", "a1", "a1x", "a2"].sort());
  });

  it("selected_branches with empty selection throws NoSelectionError", () => {
    expect(() => resolveExportScope({ nodeData: tree(), scopeType: "selected_branches", selectedBranchRootIds: [] }))
      .toThrow(NoSelectionError);
  });

  it("rejects an unknown/cross-map node id for current_branch", () => {
    expect(() => resolveExportScope({ nodeData: tree(), scopeType: "current_branch", selectedNodeId: "not-in-this-map" }))
      .toThrow(UnknownNodeIdError);
  });

  it("rejects an unknown/cross-map node id inside selected_branches", () => {
    expect(() => resolveExportScope({
      nodeData: tree(), scopeType: "selected_branches", selectedBranchRootIds: ["a", "node-from-map-b"],
    })).toThrow(UnknownNodeIdError);
  });

  it("root order is stable document order, not the order ids were selected in", () => {
    const { rootIds } = resolveExportScope({
      nodeData: tree(), scopeType: "selected_branches", selectedBranchRootIds: ["b", "a1"], // clicked b first, then a1
    });
    expect(rootIds).toEqual(["a1", "b"]); // "a1" (under "a") comes before "b" in document order
  });

  it("collapsed descendants ARE included by default (includeDescendants defaults true, ignores collapse state)", () => {
    const { includedIds } = resolveExportScope({ nodeData: tree(), scopeType: "current_branch", selectedNodeId: "a" });
    // "a1" is collapsed (expanded:false) but its child "a1x" is still included.
    expect(includedIds.has("a1x")).toBe(true);
  });

  it("includeDescendants:false includes only the root node itself", () => {
    const { includedIds } = resolveExportScope({
      nodeData: tree(), scopeType: "current_branch", selectedNodeId: "a", includeDescendants: false,
    });
    expect([...includedIds]).toEqual(["a"]);
  });

  it("visibleOnly prunes nodes hidden by the current collapse state, even though includeDescendants is on", () => {
    const { includedIds } = resolveExportScope({ nodeData: tree(), scopeType: "full", visibleOnly: true });
    // "a1x" is a child of collapsed "a1" -- not on screen -- excluded under visible-only.
    expect(includedIds.has("a1x")).toBe(false);
    // "a1" itself IS visible (it's the collapsed node itself, just its children aren't).
    expect(includedIds.has("a1")).toBe(true);
    expect(includedIds.has("b1")).toBe(true);
  });

  it("scopeType 'visible' is equivalent to full + visibleOnly", () => {
    const a = resolveExportScope({ nodeData: tree(), scopeType: "visible" });
    const b = resolveExportScope({ nodeData: tree(), scopeType: "full", visibleOnly: true });
    expect([...a.includedIds].sort()).toEqual([...b.includedIds].sort());
  });

  it("countIncluded and countHiddenIncluded match the summary-line contract", () => {
    const { includedIds } = resolveExportScope({ nodeData: tree(), scopeType: "full" });
    expect(countIncluded(includedIds)).toBe(7);
    // "a1x" is the only included node hidden by current collapse state.
    expect(countHiddenIncluded(tree(), includedIds)).toBe(1);
  });
});

describe("buildExportTree", () => {
  it("builds a nested tree carrying note/citations/direction/branch_color per node", () => {
    const t = tree();
    const { rootIds, includedIds } = resolveExportScope({ nodeData: t, scopeType: "current_branch", selectedNodeId: "a" });
    const exportTree = buildExportTree({
      nodeData: t, rootIds, includedIds, sidecar, arrows, mapId: "map-1", schemaVersion: 2,
    });
    expect(exportTree.map_id).toBe("map-1");
    const root = exportTree.roots[0];
    expect(root.node_id).toBe("a");
    expect(root.direction).toBe(0);
    expect(root.branch_color).toBe("#126CF2");
    const a1 = root.children.find((c) => c.node_id === "a1");
    expect(a1.expanded).toBe(false);
    const a1x = a1.children[0];
    expect(a1x.note).toBe("hidden note");
    expect(a1x.citations).toEqual(["c0"]);
    expect(a1x.visible).toBe(false); // parent a1 is collapsed
  });

  it("filters relations to only those whose BOTH endpoints survived scope", () => {
    const t = tree();
    const { rootIds, includedIds } = resolveExportScope({ nodeData: t, scopeType: "current_branch", selectedNodeId: "a" });
    const exportTree = buildExportTree({ nodeData: t, rootIds, includedIds, sidecar, arrows, mapId: "map-1", schemaVersion: 2 });
    // "a1x -> b1" has b1 outside this scope (b1 is under root "b", not included) -- dropped.
    // "a2 -> ghost-outside-scope" -- ghost not in the tree at all -- dropped.
    expect(exportTree.relations).toEqual([]);
  });

  it("keeps a relation when both endpoints are inside scope", () => {
    const t = tree();
    const { rootIds, includedIds } = resolveExportScope({ nodeData: t, scopeType: "full" });
    const exportTree = buildExportTree({ nodeData: t, rootIds, includedIds, sidecar, arrows, mapId: "map-1", schemaVersion: 2 });
    expect(exportTree.relations).toEqual([{ source: "a1x", target: "b1", label: "liên quan" }]);
  });

  it("multi-root scope produces multiple top-level tree roots", () => {
    const t = tree();
    const { rootIds, includedIds } = resolveExportScope({
      nodeData: t, scopeType: "selected_branches", selectedBranchRootIds: ["a1", "b"],
    });
    const exportTree = buildExportTree({ nodeData: t, rootIds, includedIds, sidecar, arrows, mapId: "map-1", schemaVersion: 2 });
    expect(exportTree.roots.map((r) => r.node_id)).toEqual(["a1", "b"]);
  });
});

describe("flattenExportTree", () => {
  it("produces stable-ordered rows with branch_path and node identity by node_id, not title", () => {
    const t = tree();
    const { rootIds, includedIds } = resolveExportScope({ nodeData: t, scopeType: "current_branch", selectedNodeId: "a" });
    const exportTree = buildExportTree({ nodeData: t, rootIds, includedIds, sidecar, arrows, mapId: "map-1", schemaVersion: 2 });
    const rows = flattenExportTree(exportTree);
    expect(rows.map((r) => r.node_id)).toEqual(["a", "a1", "a1x", "a2"]);
    const a1x = rows.find((r) => r.node_id === "a1x");
    expect(a1x.branch_path).toBe("Alpha / A1 / A1X");
    expect(a1x.parent_id).toBe("a1");
    expect(a1x.order).toBe(2);
  });
});
