// @vitest-environment jsdom
//
// Uses the REAL mind-elixir package in jsdom (same pattern as
// MindElixirView.lifecycle.test.jsx) with a MOCKED snapdom capture function
// injected via the `snapdom` param — jsdom has no real canvas/rasterization
// pipeline, so the capture itself can't run for real here, but every other
// piece (which element gets targeted, expand/restore bookkeeping, viewport
// invariants) is real library behavior, not a hand-rolled mock of it.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import MindElixir from "mind-elixir";
import { exportMindmapImage } from "./mindmapImageExport";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

function makeMind() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const mind = new MindElixir({ el, direction: MindElixir.SIDE, compact: true, editable: true, toolBar: false });
  mind.init({
    nodeData: {
      id: "root", topic: "Root", expanded: true,
      children: [
        { id: "a", topic: "Alpha", expanded: false, children: [{ id: "a1", topic: "A1", expanded: true, children: [] }] },
        { id: "b", topic: "Beta", expanded: true, children: [] },
      ],
    },
  });
  return mind;
}

function fakeResult() {
  return { download: vi.fn().mockResolvedValue(undefined) };
}

let mind;
afterEach(() => { mind?.destroy?.(); mind = null; document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("exportMindmapImage", () => {
  it("'visible' scope captures mind.map directly and never touches expanded state", async () => {
    mind = makeMind();
    // nodeData has circular `.parent` back-refs (real mind-elixir shape) —
    // compare the specific expanded flags, not a JSON snapshot of the tree.
    const before = { a: mind.nodeData.children[0].expanded, b: mind.nodeData.children[1].expanded };
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    await exportMindmapImage({ mind, scopeType: "visible", format: "png", title: "T", snapdom, settleMs: 0 });
    expect(snapdom).toHaveBeenCalledWith(mind.map, expect.objectContaining({}));
    expect(mind.nodeData.children[0].expanded).toBe(before.a);
    expect(mind.nodeData.children[1].expanded).toBe(before.b);
  });

  it("'full' scope force-expands everything, captures mind.map, then restores the ORIGINAL expanded flags", async () => {
    mind = makeMind();
    const result = fakeResult();
    const snapdom = vi.fn(async (target) => {
      // Assert mid-capture: "a" (originally collapsed) must be force-expanded now.
      expect(mind.nodeData.children[0].expanded).toBe(true);
      expect(target).toBe(mind.map);
      return result;
    });
    await exportMindmapImage({ mind, scopeType: "full", format: "png", title: "T", snapdom, settleMs: 0 });
    // Restored to the ORIGINAL state after capture — "a" collapsed again.
    expect(mind.nodeData.children[0].expanded).toBe(false);
    expect(mind.nodeData.children[1].expanded).toBe(true); // "b" was already expanded — stays expanded
  });

  it("'current_branch' scope captures only that branch's own wrapper element, not the whole canvas", async () => {
    mind = makeMind();
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    await exportMindmapImage({ mind, scopeType: "current_branch", targetNodeId: "a", format: "png", title: "T", snapdom, settleMs: 0 });
    const target = snapdom.mock.calls[0][0];
    // NOT the whole canvas, and mind-elixir's own layout() call inside
    // exportMindmapImage rebuilds DOM nodes wholesale on force-expand, so
    // asserting identity against an element captured BEFORE the call would
    // compare against a now-stale reference — assert structure instead.
    expect(target).not.toBe(mind.map);
    expect(target.tagName).toBe("ME-WRAPPER");
    expect(target.querySelector("me-tpc")?.dataset.nodeid).toBe("mea");
  });

  it("'current_branch' force-expands and restores only within that branch's own subtree, leaving siblings untouched", async () => {
    mind = makeMind();
    const result = fakeResult();
    const snapdom = vi.fn(async () => {
      expect(mind.nodeData.children[0].expanded).toBe(true); // "a" force-expanded for capture
      return result;
    });
    await exportMindmapImage({ mind, scopeType: "current_branch", targetNodeId: "a", format: "png", title: "T", snapdom, settleMs: 0 });
    expect(mind.nodeData.children[0].expanded).toBe(false); // restored
    expect(mind.nodeData.children[1].expanded).toBe(true); // "b" (sibling, outside scope) never touched
  });

  it("'current_branch' with no targetNodeId throws instead of silently exporting the whole map", async () => {
    mind = makeMind();
    const snapdom = vi.fn();
    await expect(exportMindmapImage({ mind, scopeType: "current_branch", format: "png", title: "T", snapdom, settleMs: 0 }))
      .rejects.toThrow();
    expect(snapdom).not.toHaveBeenCalled();
  });

  it("downloads with a sanitized, dated filename matching the chosen format", async () => {
    mind = makeMind();
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    await exportMindmapImage({ mind, scopeType: "visible", format: "jpeg", title: "Bad:Title", snapdom, settleMs: 0 });
    expect(result.download).toHaveBeenCalledWith(expect.objectContaining({ format: "jpeg", filename: expect.stringMatching(/^Bad_Title-\d{8}\.jpg$/) }));
  });

  it("passes backgroundColor/scale/quality through to the capture call", async () => {
    mind = makeMind();
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    await exportMindmapImage({ mind, scopeType: "visible", format: "svg", title: "T", backgroundColor: "transparent", scale: 4, quality: 0.8, snapdom, settleMs: 0 });
    expect(snapdom).toHaveBeenCalledWith(mind.map, expect.objectContaining({ backgroundColor: "transparent", scale: 4, quality: 0.8 }));
  });

  it("never calls scaleFit or toCenter for any scope (viewport must not reset)", async () => {
    mind = makeMind();
    const fitSpy = vi.spyOn(mind, "scaleFit");
    const centerSpy = vi.spyOn(mind, "toCenter");
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    await exportMindmapImage({ mind, scopeType: "full", format: "png", title: "T", snapdom, settleMs: 0 });
    await exportMindmapImage({ mind, scopeType: "current_branch", targetNodeId: "a", format: "png", title: "T", snapdom, settleMs: 0 });
    await exportMindmapImage({ mind, scopeType: "visible", format: "png", title: "T", snapdom, settleMs: 0 });
    expect(fitSpy).not.toHaveBeenCalled();
    expect(centerSpy).not.toHaveBeenCalled();
  });

  it("restores expand state even when the capture itself throws", async () => {
    mind = makeMind();
    const snapdom = vi.fn().mockRejectedValue(new Error("capture failed"));
    await expect(exportMindmapImage({ mind, scopeType: "full", format: "png", title: "T", snapdom, settleMs: 0 })).rejects.toThrow("capture failed");
    expect(mind.nodeData.children[0].expanded).toBe(false); // still restored, not left force-expanded
  });
});

// Multi-branch fixture: c1 (left) has children c1a, c1b; c2 (right) has
// child c2a; c3 (right) has child c3a which is COLLAPSED and hides c3a1.
// Doc order is c1, c2, c3 — selection-order tests deliberately pass ids in
// a different order to prove output order is document order, not click
// order (mindmapExportScope.js's own contract).
function makeMultiBranchMind() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const mind = new MindElixir({ el, direction: MindElixir.SIDE, compact: true, editable: true, toolBar: false });
  mind.init({
    nodeData: {
      id: "r", topic: "Root", expanded: true,
      children: [
        { id: "c1", topic: "C1", direction: 0, expanded: true, children: [
          { id: "c1a", topic: "C1a", expanded: true, children: [] },
          { id: "c1b", topic: "C1b", expanded: true, children: [] },
        ] },
        { id: "c2", topic: "C2", direction: 1, expanded: true, children: [
          { id: "c2a", topic: "C2a", expanded: true, children: [] },
        ] },
        { id: "c3", topic: "C3", direction: 1, expanded: true, children: [
          { id: "c3a", topic: "C3a", expanded: false, children: [
            { id: "c3a1", topic: "C3a1", expanded: true, children: [] },
          ] },
        ] },
      ],
    },
  });
  return mind;
}

function spyCtor(RealCtor) {
  const spy = vi.fn(function ctor(...args) { return new RealCtor(...args); });
  spy.SIDE = RealCtor.SIDE;
  return spy;
}

/** node ids present in a captured target, as mind-elixir's own "me"+id dataset convention (see the existing 'current_branch' test above). */
function capturedNodeIds(target) {
  return [...target.querySelectorAll("me-tpc[data-nodeid]")].map((el) => el.dataset.nodeid);
}

describe("exportMindmapImage — scopeType: selected_branches (multi-branch)", () => {
  it("two sibling branches: builds an offscreen instance and captures both subtrees, not the live map", async () => {
    mind = makeMultiBranchMind();
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    const MindElixirCtor = spyCtor(MindElixir);
    await exportMindmapImage({
      mind, scopeType: "selected_branches", branchRootIds: ["c1", "c2"],
      format: "png", title: "T", snapdom, settleMs: 0, MindElixirCtor,
    });
    expect(MindElixirCtor).toHaveBeenCalledTimes(1);
    const target = snapdom.mock.calls[0][0];
    expect(target).not.toBe(mind.map);
    const ids = capturedNodeIds(target);
    expect(ids).toEqual(expect.arrayContaining(["mec1", "mec1a", "mec1b", "mec2", "mec2a"]));
    expect(ids).not.toContain("mec3");
  });

  it("branches from opposite sides (direction 0 and 1) both preserved in the clone", async () => {
    mind = makeMultiBranchMind();
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    const MindElixirCtor = spyCtor(MindElixir);
    await exportMindmapImage({
      mind, scopeType: "selected_branches", branchRootIds: ["c1", "c2"],
      format: "png", title: "T", snapdom, settleMs: 0, MindElixirCtor,
    });
    const target = snapdom.mock.calls[0][0];
    const ids = capturedNodeIds(target);
    expect(ids).toContain("mec1");
    expect(ids).toContain("mec2");
  });

  it("parent+child selection dedupes to the parent and falls back to the single-branch path (no offscreen instance)", async () => {
    mind = makeMultiBranchMind();
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    const MindElixirCtor = spyCtor(MindElixir);
    await exportMindmapImage({
      mind, scopeType: "selected_branches", branchRootIds: ["c1a", "c1"],
      format: "png", title: "T", snapdom, settleMs: 0, MindElixirCtor,
    });
    expect(MindElixirCtor).not.toHaveBeenCalled();
    const target = snapdom.mock.calls[0][0];
    expect(target.tagName).toBe("ME-WRAPPER");
    expect(target.querySelector("me-tpc")?.dataset.nodeid).toBe("mec1");
  });

  it("three selected branches all appear in the composed capture", async () => {
    mind = makeMultiBranchMind();
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    const MindElixirCtor = spyCtor(MindElixir);
    await exportMindmapImage({
      mind, scopeType: "selected_branches", branchRootIds: ["c1", "c2", "c3"],
      format: "png", title: "T", snapdom, settleMs: 0, MindElixirCtor,
    });
    const ids = capturedNodeIds(snapdom.mock.calls[0][0]);
    expect(ids).toEqual(expect.arrayContaining(["mec1", "mec2", "mec3"]));
  });

  it("a single selected branch falls back to ordinary single-branch export behavior", async () => {
    mind = makeMultiBranchMind();
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    const MindElixirCtor = spyCtor(MindElixir);
    await exportMindmapImage({
      mind, scopeType: "selected_branches", branchRootIds: ["c2"],
      format: "png", title: "T", snapdom, settleMs: 0, MindElixirCtor,
    });
    expect(MindElixirCtor).not.toHaveBeenCalled();
    const target = snapdom.mock.calls[0][0];
    expect(target.querySelector("me-tpc")?.dataset.nodeid).toBe("mec2");
  });

  it("invalid/cross-map node ids reject instead of silently exporting a partial selection", async () => {
    mind = makeMultiBranchMind();
    const snapdom = vi.fn();
    await expect(exportMindmapImage({
      mind, scopeType: "selected_branches", branchRootIds: ["c1", "does-not-exist"],
      format: "png", title: "T", snapdom, settleMs: 0,
    })).rejects.toThrow();
    expect(snapdom).not.toHaveBeenCalled();
  });

  it("selection order different from document order still composes in document order", async () => {
    mind = makeMultiBranchMind();
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    const MindElixirCtor = spyCtor(MindElixir);
    // clicked c3 first, then c1 — document order is c1, c2... c3 last.
    await exportMindmapImage({
      mind, scopeType: "selected_branches", branchRootIds: ["c3", "c1"],
      format: "png", title: "T", snapdom, settleMs: 0, MindElixirCtor,
    });
    const ctorCall = MindElixirCtor.mock.calls[0][0];
    // The offscreen instance is init'd separately from construction — assert
    // via the captured target's DOM order instead, which reflects render
    // order of virtualRoot.children (built directly from the resolver's
    // ordered rootIds, not the caller's array order).
    expect(ctorCall).toBeTruthy();
    const target = snapdom.mock.calls[0][0];
    const order = capturedNodeIds(target);
    expect(order.indexOf("mec1")).toBeLessThan(order.indexOf("mec3"));
  });

  it("collapsed descendants are included by default (image export ignores current collapse state)", async () => {
    mind = makeMultiBranchMind();
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    const MindElixirCtor = spyCtor(MindElixir);
    await exportMindmapImage({
      mind, scopeType: "selected_branches", branchRootIds: ["c3", "c1"],
      format: "png", title: "T", snapdom, settleMs: 0, MindElixirCtor,
    });
    const ids = capturedNodeIds(snapdom.mock.calls[0][0]);
    expect(ids).toContain("mec3a1"); // c3a is collapsed but its child is exported anyway
  });

  it("visibleOnly excludes descendants hidden by a collapsed ancestor", async () => {
    mind = makeMultiBranchMind();
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    const MindElixirCtor = spyCtor(MindElixir);
    await exportMindmapImage({
      mind, scopeType: "selected_branches", branchRootIds: ["c3", "c1"],
      visibleOnly: true,
      format: "png", title: "T", snapdom, settleMs: 0, MindElixirCtor,
    });
    const ids = capturedNodeIds(snapdom.mock.calls[0][0]);
    expect(ids).toContain("mec3a"); // c3a itself still visible
    expect(ids).not.toContain("mec3a1"); // hidden by c3a's own collapse
  });

  it("appearance: font/spacing changes on 'current_branch' scope resolve target AFTER relayout (no stale/detached element)", async () => {
    mind = makeMultiBranchMind();
    const result = fakeResult();
    let capturedTarget = null;
    const snapdom = vi.fn(async (target) => { capturedTarget = target; return result; });
    await exportMindmapImage({
      mind, scopeType: "current_branch", targetNodeId: "c1",
      appearance: { font: "serif", branchColorMode: "keep", spacing: "compact", connectorThickness: "normal", content: { relations: true, citations: true, legend: false, branding: false } },
      format: "png", title: "T", snapdom, settleMs: 0,
    });
    // Same structural-correctness assertion the pre-existing 'current_branch'
    // capture test uses (see this file's other test on why: layout() can
    // swap DOM node identity, so identity/attachment isn't the meaningful
    // check here — real attachment end-to-end is covered by the Playwright
    // fixture-harness suite, e2e-fixture/export-studio.spec.js).
    expect(capturedTarget.tagName).toBe("ME-WRAPPER");
    expect(capturedTarget.querySelector("me-tpc")?.dataset.nodeid).toBe("mec1");
  });

  it("appearance: monochrome branch color is restored on the live tree after a 'full' scope export", async () => {
    mind = makeMultiBranchMind();
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    const before = mind.nodeData.children.map((c) => c.branchColor);
    await exportMindmapImage({
      mind, scopeType: "full",
      appearance: { font: "canvas", branchColorMode: "monochrome", spacing: "normal", connectorThickness: "normal", content: { relations: true, citations: true, legend: false, branding: false } },
      format: "png", title: "T", snapdom, settleMs: 0,
    });
    expect(mind.nodeData.children.map((c) => c.branchColor)).toEqual(before);
  });

  it("appearance: legend content option adds an overlay to the captured multi-branch target", async () => {
    mind = makeMultiBranchMind();
    const result = fakeResult();
    let capturedTarget = null;
    const snapdom = vi.fn(async (target) => { capturedTarget = target; return result; });
    const MindElixirCtor = spyCtor(MindElixir);
    await exportMindmapImage({
      mind, scopeType: "selected_branches", branchRootIds: ["c1", "c2"],
      appearance: { font: "canvas", branchColorMode: "keep", spacing: "normal", connectorThickness: "normal", content: { relations: true, citations: true, legend: true, branding: false } },
      format: "png", title: "T", snapdom, settleMs: 0, MindElixirCtor,
    });
    expect(capturedTarget.querySelector(".mm-export-overlay")).toBeTruthy();
  });

  it("live map is never mutated and the offscreen container is removed after export", async () => {
    mind = makeMultiBranchMind();
    const result = fakeResult();
    const snapdom = vi.fn().mockResolvedValue(result);
    const MindElixirCtor = spyCtor(MindElixir);
    const bodyChildrenBefore = document.body.childElementCount;
    const liveExpandedBefore = mind.nodeData.children[2].children[0].expanded; // c3a
    await exportMindmapImage({
      mind, scopeType: "selected_branches", branchRootIds: ["c1", "c3"],
      format: "png", title: "T", snapdom, settleMs: 0, MindElixirCtor,
    });
    expect(document.body.childElementCount).toBe(bodyChildrenBefore);
    expect(mind.nodeData.children[2].children[0].expanded).toBe(liveExpandedBefore);
  });
});
