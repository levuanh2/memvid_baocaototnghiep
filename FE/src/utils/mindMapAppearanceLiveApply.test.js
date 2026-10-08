// @vitest-environment jsdom
// PR C2 — the live-apply engine must NEVER call layout()/linkDiv()/
// refresh()/scaleFit()/toCenter(), on either the live canvas or an export
// offscreen instance, and must roll back to an exact baseline.
import { describe, it, expect, vi } from "vitest";
import { applyLiveCanvasAppearance } from "./mindMapAppearanceLiveApply";
import { resolveCanvasAppearance } from "./mindMapAppearanceV2";

function makeMind() {
  const container = document.createElement("div");
  const map = document.createElement("div");
  container.appendChild(map);
  document.body.appendChild(container);
  const nodeData = {
    id: "root", topic: "Root", expanded: true,
    children: [
      { id: "a", topic: "A", expanded: true, children: [{ id: "a1", topic: "A1", expanded: true, children: [] }] },
      { id: "b", topic: "B", expanded: true, children: [] },
    ],
  };
  const els = new Map();
  const byId = (node) => { const el = document.createElement("me-tpc"); el.dataset.nodeid = node.id; map.appendChild(el); els.set(node.id, el); (node.children || []).forEach(byId); };
  byId(nodeData);
  // A couple of fake connector paths, same selectors the real canvas uses.
  const linesWrap = document.createElement("div"); linesWrap.className = "lines";
  const p1 = document.createElementNS("http://www.w3.org/2000/svg", "path"); p1.setAttribute("stroke", "#126CF2"); p1.setAttribute("d", "M0 0 L10 10");
  linesWrap.appendChild(p1);
  map.appendChild(linesWrap);
  return {
    container, map, nodeData,
    findEle: (id) => els.get(id) || null,
    layout: vi.fn(), linkDiv: vi.fn(), refresh: vi.fn(), scaleFit: vi.fn(), toCenter: vi.fn(),
  };
}

describe("default preset applies zero DOM changes (regression: shipping this must not restyle every existing map)", () => {
  it("touches no node element and no container style/backgroundImage, leaving every inline style exactly as found", () => {
    const mind = makeMind();
    const rootEl = mind.findEle("root");
    const branchEl = mind.findEle("a");
    const leafEl = mind.findEle("a1");
    const baseline = {
      root: rootEl.style.cssText, branch: branchEl.style.cssText, leaf: leafEl.style.cssText,
      containerCss: mind.container.style.cssText,
    };
    const resolved = resolveCanvasAppearance({ savedAppearance: undefined }); // "default" preset
    const restore = applyLiveCanvasAppearance({ mind, resolved });
    expect(rootEl.style.cssText).toBe(baseline.root);
    expect(branchEl.style.cssText).toBe(baseline.branch);
    expect(leafEl.style.cssText).toBe(baseline.leaf);
    expect(mind.container.style.cssText).toBe(baseline.containerCss);
    expect(mind.container.querySelector("style[data-mm-appearance-connector]")).toBeFalsy();
    restore(); // must be a no-op too, not an error
  });
});

describe("applyLiveCanvasAppearance — a collapsed/not-rendered node never crashes", () => {
  it("findEle throwing for one node (mind-elixir's real behavior for a collapsed branch, not a null return) is caught and that node is simply skipped", () => {
    const mind = makeMind();
    const originalFindEle = mind.findEle;
    mind.findEle = (id) => {
      if (id === "a1") throw new Error(`FindEle: Node ${id} not found, maybe it's collapsed.`);
      return originalFindEle(id);
    };
    const resolved = resolveCanvasAppearance({ savedAppearance: { version: 2, preset: "study", overrides: {} } });
    expect(() => applyLiveCanvasAppearance({ mind, resolved })).not.toThrow();
    // Siblings not affected by the thrown node still get styled normally.
    expect(mind.findEle("root").style.background).not.toBe("");
  });
});

describe("applyLiveCanvasAppearance", () => {
  it("never calls layout/linkDiv/refresh/scaleFit/toCenter", () => {
    const mind = makeMind();
    const resolved = resolveCanvasAppearance({ savedAppearance: { version: 2, preset: "study", overrides: {} } });
    const restore = applyLiveCanvasAppearance({ mind, resolved });
    expect(mind.layout).not.toHaveBeenCalled();
    expect(mind.linkDiv).not.toHaveBeenCalled();
    expect(mind.refresh).not.toHaveBeenCalled();
    expect(mind.scaleFit).not.toHaveBeenCalled();
    expect(mind.toCenter).not.toHaveBeenCalled();
    restore();
  });

  it("applies the resolved role style to each node's own element by depth-derived role", () => {
    const mind = makeMind();
    const resolved = resolveCanvasAppearance({ savedAppearance: { version: 2, preset: "highContrast", overrides: {} } });
    applyLiveCanvasAppearance({ mind, resolved });
    const rootEl = mind.findEle("root");
    const branchEl = mind.findEle("a");
    const leafEl = mind.findEle("a1");
    // jsdom normalizes a hex background to rgb(...) on readback — compare via
    // a throwaway probe element instead of the literal hex string.
    const hexToRgbStr = (hex) => { const probe = document.createElement("div"); probe.style.background = hex; return probe.style.background; };
    expect(rootEl.style.background).toBe(hexToRgbStr(resolved.node.root.fill));
    expect(branchEl.style.background).toBe(hexToRgbStr(resolved.node.branch.fill));
    expect(leafEl.style.background).toBe(hexToRgbStr(resolved.node.leaf.fill));
  });

  it("applies connector color/thickness/style via one scoped <style> tag on the container, not per-path mutation", () => {
    const mind = makeMind();
    const resolved = resolveCanvasAppearance({ savedAppearance: { version: 2, preset: "highContrast", overrides: {} } });
    applyLiveCanvasAppearance({ mind, resolved });
    const styleEl = mind.container.querySelector("style[data-mm-appearance-connector]");
    expect(styleEl).toBeTruthy();
    expect(styleEl.textContent).toContain("stroke:");
    expect(styleEl.textContent).toContain("stroke-width:");
  });

  it("rollback restores every touched node's inline style AND removes the connector <style> tag, leaving zero trace", () => {
    const mind = makeMind();
    const rootEl = mind.findEle("root");
    const baselineBg = rootEl.style.background;
    const resolved = resolveCanvasAppearance({ savedAppearance: { version: 2, preset: "pastel", overrides: {} } });
    const restore = applyLiveCanvasAppearance({ mind, resolved });
    expect(rootEl.style.background).not.toBe(baselineBg);
    restore();
    expect(rootEl.style.background).toBe(baselineBg);
    expect(mind.container.querySelector("style[data-mm-appearance-connector]")).toBeFalsy();
  });

  it("applying a second draft on top restores the first cleanly when its own restore() runs (no leaked style accumulation)", () => {
    const mind = makeMind();
    const restoreA = applyLiveCanvasAppearance({ mind, resolved: resolveCanvasAppearance({ savedAppearance: { version: 2, preset: "pastel", overrides: {} } }) });
    restoreA();
    const restoreB = applyLiveCanvasAppearance({ mind, resolved: resolveCanvasAppearance({ savedAppearance: { version: 2, preset: "study", overrides: {} } }) });
    expect(mind.container.querySelectorAll("style[data-mm-appearance-connector]").length).toBeLessThanOrEqual(1);
    restoreB();
    expect(mind.container.querySelectorAll("style[data-mm-appearance-connector]").length).toBe(0);
  });
});
