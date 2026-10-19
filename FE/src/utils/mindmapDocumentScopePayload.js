// PR E — builds the `scope` object sent to POST /mindmaps/<id>/exports
// (document formats only; image export has its own path in
// mindmapImageExport.js and never calls this). Pure function of the live
// mind-elixir instance + the dialog's own scope state — callers MUST invoke
// this at the moment of the actual export click (never memoized earlier,
// e.g. at preview-step-open time), so a "visible" snapshot always reflects
// whatever is on screen right then, not whatever it was when the user
// opened the review step.
//
// Only "visible" ever carries visible_node_ids. Exact checkbox selection
// (`selected_branches`) and visible scope send include_descendants:false;
// current-branch/full retain their existing subtree behavior. The BE independently re-validates and
// re-resolves everything this computes; this module's job is only to
// decide WHICH node ids the user currently sees, never to decide their
// content — no title/note/text of any node is read or sent here.
import { resolveExportScope } from "./mindmapExportScope";
import { isRootOnly } from "./mindElixirRootOnly";

export function buildDocumentScopePayload({ mind, scopeType, selectedNodeId, selectedBranchRootIds, visibleOnly }) {
  const effectiveScope = visibleOnly && scopeType === "full" ? "visible" : scopeType;
  const base = {
    scope_type: effectiveScope,
    selected_node_id: selectedNodeId,
    selected_branch_root_ids: selectedBranchRootIds || [],
    include_descendants: effectiveScope !== "selected_branches",
  };
  if (effectiveScope !== "visible") return base;

  const resolved = resolveExportScope({
    nodeData: mind.nodeData,
    scopeType: "visible",
    selectedNodeId,
    selectedBranchRootIds,
    visibleIdsOverride: isRootOnly(mind) ? new Set([mind.nodeData.id]) : null,
  });
  return {
    scope_type: "visible",
    selected_node_id: selectedNodeId,
    selected_branch_root_ids: selectedBranchRootIds || [],
    include_descendants: false,
    visible_node_ids: [...resolved.includedIds],
  };
}
