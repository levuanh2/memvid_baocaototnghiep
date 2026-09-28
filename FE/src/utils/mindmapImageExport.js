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
import RealMindElixir from "mind-elixir";
import { THEME } from "../components/mindmap/mindElixirTheme";
import { resolveExportScope } from "./mindmapExportScope";
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
  mind, scopeType, targetNodeId, branchRootIds, includeDescendants = true, visibleOnly = false,
  format, backgroundColor, scale = 2, quality = 1, title,
  snapdom = realSnapdom, settleMs = 30, MindElixirCtor = RealMindElixir,
}) {
  if (!mind?.map) throw new Error("Mind Elixir chưa sẵn sàng.");

  if (scopeType === "selected_branches") {
    return exportMindmapImageMultiBranch({
      mind, rootIds: branchRootIds, includeDescendants, visibleOnly,
      format, backgroundColor, scale, quality, title, snapdom, settleMs, MindElixirCtor,
    });
  }

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

/** Prunes a live nodeObj subtree to a plain, parent-ref-free clone containing only ids in `includedIds` — safe to hand to an OFFSCREEN mind-elixir instance without risking any mutation reaching the live tree (no shared object identity at all). Export ignores current collapse state (same contract as full/current-branch scope), so every clone is forced `expanded: true`. */
function pruneClone(liveNode, includedIds) {
  return {
    id: liveNode.id, topic: liveNode.topic,
    ...(liveNode.direction != null ? { direction: liveNode.direction } : {}),
    ...(liveNode.branchColor ? { branchColor: liveNode.branchColor } : {}),
    ...(liveNode.tags ? { tags: liveNode.tags } : {}),
    ...(liveNode.style ? { style: liveNode.style } : {}),
    expanded: true,
    children: (liveNode.children || [])
      .filter((c) => includedIds.has(c.id))
      .map((c) => pruneClone(c, includedIds)),
  };
}

function indexById(nodeData) {
  const byId = new Map();
  (function walk(n) { byId.set(n.id, n); (n.children || []).forEach(walk); })(nodeData);
  return byId;
}

/**
 * Multi-branch image export (Round 2, section 4). Several disjoint selected
 * roots can't be captured with one `snapdom(target)` call the way a single
 * subtree can — there's no single existing DOM element that bounds exactly
 * "these N branches and nothing else". Composing them means an OFFSCREEN,
 * throwaway mind-elixir instance rendering DEEP CLONES of the selected
 * subtrees under one synthetic parent (never the live objects — the clones
 * share no object identity with `mind.nodeData` at all, so nothing this
 * function does — layout, scaleFit, force-expand — can reach the live map),
 * mounted in a real-sized (never zero/display:none — see the "NaN connector"
 * note below) container positioned off-screen so the user never sees it,
 * then destroyed immediately after capture.
 *
 * The virtual root exists only to give mind-elixir something to lay the
 * branches out FROM (its layout algorithm always roots at one node) — an
 * empty topic plus a CSS rule scoped to this instance's own throwaway
 * container hides its box/text from the exported image, satisfying "must
 * not appear in the exported result unless explicitly required for
 * layout": it's required for layout, so it exists, but it isn't visible.
 *
 * Falls back to the existing single-branch path when only one root
 * survives scope resolution (parent+child dedupe can turn a 2-selection
 * into 1) — no virtual root or offscreen instance needed for that case.
 */
async function exportMindmapImageMultiBranch({
  mind, rootIds, includeDescendants, visibleOnly,
  format, backgroundColor, scale, quality, title, snapdom, settleMs, MindElixirCtor,
}) {
  if (!rootIds?.length) throw new Error("Chưa chọn nhánh để xuất.");

  const { rootIds: orderedRootIds, includedIds } = resolveExportScope({
    nodeData: mind.nodeData, scopeType: "selected_branches",
    selectedBranchRootIds: rootIds, includeDescendants, visibleOnly,
  });

  if (orderedRootIds.length === 1) {
    return exportMindmapImage({
      mind, scopeType: "current_branch", targetNodeId: orderedRootIds[0],
      format, backgroundColor, scale, quality, title, snapdom, settleMs, MindElixirCtor,
    });
  }

  const liveById = indexById(mind.nodeData);
  const branchClones = orderedRootIds.map((id) => pruneClone(liveById.get(id), includedIds));
  const virtualRoot = { id: "__export_virtual_root__", topic: "", children: branchClones };

  // Real, positioned, REAL-SIZED container: mind-elixir's layout() computes
  // geometry from real offsetWidth/offsetHeight, and a zero-sized or
  // display:none container reproduces the exact "NaN connector path" bug
  // this codebase already root-caused once for the LIVE canvas (see
  // MindElixirView.jsx's sanitizeHiddenNaNPaths). `position:fixed;
  // left:-99999px` keeps real box dimensions while being definitionally
  // outside the viewport the user is looking at — nothing visibly moves or
  // flickers on the live page.
  const offscreen = document.createElement("div");
  offscreen.className = "mm-export-offscreen";
  offscreen.style.cssText = "position:fixed; left:-99999px; top:0; width:2400px; height:1600px; pointer-events:none;";
  const style = document.createElement("style");
  style.textContent = ".mm-export-offscreen me-root { opacity: 0 !important; }";
  offscreen.appendChild(style);
  const mountEl = document.createElement("div");
  mountEl.style.cssText = "width:100%; height:100%;";
  offscreen.appendChild(mountEl);
  document.body.appendChild(offscreen);

  let offscreenMind = null;
  try {
    offscreenMind = new MindElixirCtor({
      el: mountEl, direction: MindElixirCtor.SIDE, compact: true,
      editable: false, contextMenu: false, toolBar: false, theme: THEME,
    });
    offscreenMind.init({ nodeData: virtualRoot, arrows: [] });
    offscreenMind.scaleFit?.(); // this THROWAWAY instance's own viewport — never the live one
    if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));

    const result = await snapdom(offscreenMind.map, { backgroundColor, scale, quality });
    const filename = exportFilenameFor(title, format === "jpeg" ? "jpg" : format);
    await result.download({ format, filename, quality });
    return { filename };
  } finally {
    offscreenMind?.destroy?.();
    offscreen.remove();
  }
}
