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
