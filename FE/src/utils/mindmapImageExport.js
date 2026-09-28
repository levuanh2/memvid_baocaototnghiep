// PNG/JPEG/SVG capture for Export Studio — extends the prior PNG-only
// export (MindElixirView's old handleExportPng) into scope-aware capture,
// reusing the exact same @zumer/snapdom call shape rather than adding a
// second image-export library (per the round's "audit existing deps first"
// instruction — snapdom already covers png/jpeg/svg via one `download()`
// call, see node_modules/@zumer/snapdom/types/snapdom.d.ts's BlobType).
//
// Scope handling for a RASTER/VECTOR snapshot (not a data export — there is
// no "include collapsed descendants" for a picture of what's on screen):
// - "visible": today's existing behavior exactly — whatever's currently
//   rendered IS what's visible, so this is a direct capture of `mind.map`,
//   no state mutation at all.
// - "full" / "current_branch": per the brief, image export must NOT depend
//   on current collapse state ("Không phụ thuộc nhánh hiện đang collapsed").
//   Since an image is a snapshot of rendered DOM, satisfying that means
//   temporarily force-expanding the relevant subtree, capturing, and
//   restoring the ORIGINAL expanded flags afterward — never leaving the
//   live map in a different state than the user had it in. The modal sits
//   on top of the canvas the whole time this runs, so the brief flicker is
//   never visible to the user.
import { snapdom as realSnapdom } from "@zumer/snapdom";
import { exportFilenameFor } from "./mindmapExportFilename";

function snapshotExpanded(nodeObj, into) {
  into.set(nodeObj.id, nodeObj.expanded);
  (nodeObj.children || []).forEach((c) => snapshotExpanded(c, into));
}
function forceExpandAll(nodeObj) {
  if (nodeObj.children?.length) nodeObj.expanded = true;
  (nodeObj.children || []).forEach(forceExpandAll);
}
function restoreExpanded(nodeObj, snapshot) {
  if (snapshot.has(nodeObj.id)) nodeObj.expanded = snapshot.get(nodeObj.id);
  (nodeObj.children || []).forEach((c) => restoreExpanded(c, snapshot));
}

/** The DOM element bounding a node's own rendered subtree (topic + all descendant wrappers). Root's subtree is the whole canvas; any other node's is its `<me-wrapper>` ancestor. */
function subtreeElementFor(mind, nodeId) {
  if (nodeId === mind.nodeData?.id) return mind.map;
  const topic = mind.findEle?.(nodeId);
  return topic?.closest("me-wrapper") || mind.map;
}

export async function exportMindmapImage({
  mind, scopeType, targetNodeId, format, backgroundColor, scale = 2, quality = 1, title,
  snapdom = realSnapdom, settleMs = 30,
}) {
  if (!mind?.map) throw new Error("Mind Elixir chưa sẵn sàng.");
  const rootId = mind.nodeData?.id;
  const effectiveTargetId = scopeType === "current_branch" ? targetNodeId : rootId;
  if (scopeType === "current_branch" && !effectiveTargetId) throw new Error("Chưa chọn nhánh để xuất.");

  const needsForceExpand = scopeType === "full" || scopeType === "current_branch";
  const subtreeRoot = needsForceExpand
    ? (scopeType === "full" ? mind.nodeData : mind.findEle?.(effectiveTargetId)?.nodeObj)
    : null;

  const snapshot = new Map();
  if (needsForceExpand && subtreeRoot) {
    snapshotExpanded(subtreeRoot, snapshot);
    forceExpandAll(subtreeRoot);
    mind.layout?.();
    mind.linkDiv?.();
    if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
  }

  try {
    const target = scopeType === "current_branch" ? subtreeElementFor(mind, effectiveTargetId) : mind.map;
    const result = await snapdom(target, { backgroundColor, scale, quality });
    const filename = exportFilenameFor(title, format === "jpeg" ? "jpg" : format);
    await result.download({ format, filename, quality });
    return { filename };
  } finally {
    if (needsForceExpand && subtreeRoot) {
      restoreExpanded(subtreeRoot, snapshot);
      mind.layout?.();
      mind.linkDiv?.();
    }
  }
}
