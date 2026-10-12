import { describe, it, expect } from "vitest";
import { buildDocumentScopePayload } from "./mindmapDocumentScopePayload";

// Mirrors the nested mind-elixir nodeData shape resolveExportScope reads
// (see mindmapExportScope.js) -- not the flat BE record shape. A plain
// object here is never registered with mindElixirRootOnly.js's own
// WeakMap, so isRootOnly(mind) correctly reads false for all of these.
function mindFor(tree) {
  return { nodeData: tree };
}

const TREE = {
  id: "root", expanded: true, children: [
    { id: "a", expanded: true, children: [
      { id: "b", expanded: true, children: [{ id: "c", expanded: true, children: [] }] },
    ] },
    { id: "e", expanded: true, children: [{ id: "f", expanded: true, children: [] }] },
  ],
};

describe("buildDocumentScopePayload", () => {
  it("non-visible scope: include_descendants stays true, no visible_node_ids field", () => {
    const payload = buildDocumentScopePayload({ mind: mindFor(TREE), scopeType: "full", selectedNodeId: null, selectedBranchRootIds: [], visibleOnly: false });
    expect(payload).toEqual({ scope_type: "full", selected_node_id: null, selected_branch_root_ids: [], include_descendants: true });
  });

  it("current_branch scope: unaffected by visibleOnly off", () => {
    const payload = buildDocumentScopePayload({ mind: mindFor(TREE), scopeType: "current_branch", selectedNodeId: "a", selectedBranchRootIds: [], visibleOnly: false });
    expect(payload.scope_type).toBe("current_branch");
    expect(payload).not.toHaveProperty("visible_node_ids");
  });

  it("visible scope (full tree expanded): include_descendants false, visible_node_ids = every node", () => {
    const payload = buildDocumentScopePayload({ mind: mindFor(TREE), scopeType: "full", selectedNodeId: null, selectedBranchRootIds: [], visibleOnly: true });
    expect(payload.scope_type).toBe("visible");
    expect(payload.include_descendants).toBe(false);
    expect(new Set(payload.visible_node_ids)).toEqual(new Set(["root", "a", "b", "c", "e", "f"]));
  });

  it("visible scope, a branch collapsed: visible_node_ids excludes its descendants", () => {
    const collapsed = {
      id: "root", expanded: true, children: [
        { id: "a", expanded: false, children: [
          { id: "b", expanded: true, children: [{ id: "c", expanded: true, children: [] }] },
        ] },
        { id: "e", expanded: true, children: [{ id: "f", expanded: true, children: [] }] },
      ],
    };
    const payload = buildDocumentScopePayload({ mind: mindFor(collapsed), scopeType: "full", selectedNodeId: null, selectedBranchRootIds: [], visibleOnly: true });
    expect(new Set(payload.visible_node_ids)).toEqual(new Set(["root", "a", "e", "f"]));
  });

  it("never includes node title/text in the payload", () => {
    const titled = { id: "root", title: "Secret Title", expanded: true, children: [{ id: "a", title: "Secret Child", expanded: true, children: [] }] };
    const payload = buildDocumentScopePayload({ mind: mindFor(titled), scopeType: "full", selectedNodeId: null, selectedBranchRootIds: [], visibleOnly: true });
    expect(JSON.stringify(payload)).not.toContain("Secret");
  });
});
