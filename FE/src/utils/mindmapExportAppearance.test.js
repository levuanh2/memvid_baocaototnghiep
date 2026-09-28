// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import MindElixir from "mind-elixir";
import {
  applyContainerAppearance, applyTargetAppearance, needsRelayout,
  DEFAULT_APPEARANCE, PRESETS, MONOCHROME_COLOR, CUSTOM_PALETTE, STROKE_WIDTH,
} from "./mindmapExportAppearance";

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
        { id: "a", topic: "Alpha", expanded: true, children: [] },
        { id: "b", topic: "Beta", expanded: true, children: [] },
      ],
    },
  });
  return mind;
}

let mind;
afterEach(() => { mind?.destroy?.(); mind = null; document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("needsRelayout", () => {
  it("is false for the default appearance", () => {
    expect(needsRelayout(DEFAULT_APPEARANCE)).toBe(false);
  });
  it("is true when font or spacing changes", () => {
    expect(needsRelayout({ ...DEFAULT_APPEARANCE, font: "serif" })).toBe(true);
    expect(needsRelayout({ ...DEFAULT_APPEARANCE, spacing: "compact" })).toBe(true);
  });
  it("is false for branch-color-only or content-only changes", () => {
    expect(needsRelayout({ ...DEFAULT_APPEARANCE, branchColorMode: "monochrome" })).toBe(false);
    expect(needsRelayout({ ...DEFAULT_APPEARANCE, content: { ...DEFAULT_APPEARANCE.content, legend: true } })).toBe(false);
  });
});

describe("applyContainerAppearance", () => {
  it("default appearance is a true no-op — restore leaves everything byte-identical", () => {
    mind = makeMind();
    const before = mind.container.getAttribute("style");
    const restore = applyContainerAppearance({ mind, appearance: DEFAULT_APPEARANCE });
    expect(mind.container.getAttribute("style")).toBe(before);
    restore();
    expect(mind.container.getAttribute("style")).toBe(before);
  });

  it("sets and restores font-family on mind.container", () => {
    mind = makeMind();
    const restore = applyContainerAppearance({ mind, appearance: { ...DEFAULT_APPEARANCE, font: "serif" } });
    // jsdom normalizes the quote style of the CSS string it stores (single
    // quotes -> double), so compare content, not exact string identity.
    expect(mind.container.style.fontFamily).toContain("Spectral");
    restore();
    expect(mind.container.style.fontFamily).toBe("");
  });

  it("sets and restores spacing cssVars on mind.container", () => {
    mind = makeMind();
    const before = mind.container.style.getPropertyValue("--main-gap-x");
    const restore = applyContainerAppearance({ mind, appearance: { ...DEFAULT_APPEARANCE, spacing: "compact" } });
    expect(mind.container.style.getPropertyValue("--main-gap-x")).toBe("40px");
    restore();
    expect(mind.container.style.getPropertyValue("--main-gap-x")).toBe(before);
  });

  it("monochrome sets every top-level child's branchColor to the same ink color and restores originals", () => {
    mind = makeMind();
    const [before1, before2] = mind.nodeData.children.map((c) => c.branchColor);
    const restore = applyContainerAppearance({ mind, appearance: { ...DEFAULT_APPEARANCE, branchColorMode: "monochrome" } });
    expect(mind.nodeData.children[0].branchColor).toBe(MONOCHROME_COLOR);
    expect(mind.nodeData.children[1].branchColor).toBe(MONOCHROME_COLOR);
    restore();
    expect(mind.nodeData.children[0].branchColor).toBe(before1);
    expect(mind.nodeData.children[1].branchColor).toBe(before2);
  });

  it("customPalette cycles distinct colors per top-level branch", () => {
    mind = makeMind();
    const restore = applyContainerAppearance({ mind, appearance: { ...DEFAULT_APPEARANCE, branchColorMode: "customPalette" } });
    expect(mind.nodeData.children[0].branchColor).toBe(CUSTOM_PALETTE[0]);
    expect(mind.nodeData.children[1].branchColor).toBe(CUSTOM_PALETTE[1]);
    restore();
  });

  it("branchColorMode 'keep' never touches branchColor at all", () => {
    mind = makeMind();
    const restore = applyContainerAppearance({ mind, appearance: DEFAULT_APPEARANCE });
    expect(mind.nodeData.children[0].branchColor).toBeUndefined();
    restore();
  });
});

describe("applyTargetAppearance", () => {
  it("default appearance leaves target's DOM untouched", () => {
    mind = makeMind();
    const before = mind.map.innerHTML;
    const restore = applyTargetAppearance({ mind, target: mind.map, appearance: DEFAULT_APPEARANCE });
    expect(mind.map.className).not.toContain("mm-export-appearance");
    restore();
    expect(mind.map.innerHTML).toBe(before);
  });

  it("connectorThickness !== normal injects a stroke-width override scoped to target, removed on restore", () => {
    mind = makeMind();
    const restore = applyTargetAppearance({ mind, target: mind.map, appearance: { ...DEFAULT_APPEARANCE, connectorThickness: "thick" } });
    expect(mind.map.classList.contains("mm-export-appearance")).toBe(true);
    const style = mind.map.querySelector("style");
    expect(style.textContent).toContain(`stroke-width: ${STROKE_WIDTH.thick}`);
    restore();
    expect(mind.map.classList.contains("mm-export-appearance")).toBe(false);
    expect(mind.map.querySelector("style")).toBeNull();
  });

  it("content.citations === false injects a rule hiding citation tags, removed on restore", () => {
    mind = makeMind();
    const restore = applyTargetAppearance({
      mind, target: mind.map,
      appearance: { ...DEFAULT_APPEARANCE, content: { ...DEFAULT_APPEARANCE.content, citations: false } },
    });
    const style = mind.map.querySelector("style");
    expect(style.textContent).toContain(".mm-tag-citations { display: none");
    restore();
    expect(mind.map.querySelector("style")).toBeNull();
  });

  it("content.relations === false adds me-hide-arrows to target and removes it on restore", () => {
    mind = makeMind();
    expect(mind.map.classList.contains("me-hide-arrows")).toBe(false);
    const restore = applyTargetAppearance({
      mind, target: mind.map,
      appearance: { ...DEFAULT_APPEARANCE, content: { ...DEFAULT_APPEARANCE.content, relations: false } },
    });
    expect(mind.map.classList.contains("me-hide-arrows")).toBe(true);
    restore();
    expect(mind.map.classList.contains("me-hide-arrows")).toBe(false);
  });

  it("legend overlay lists each top-level branch's topic, removed on restore", () => {
    mind = makeMind();
    const restore = applyTargetAppearance({
      mind, target: mind.map,
      appearance: { ...DEFAULT_APPEARANCE, content: { ...DEFAULT_APPEARANCE.content, legend: true } },
    });
    const overlay = mind.map.querySelector(".mm-export-overlay");
    expect(overlay.textContent).toContain("Alpha");
    expect(overlay.textContent).toContain("Beta");
    restore();
    expect(mind.map.querySelector(".mm-export-overlay")).toBeNull();
  });

  it("branding overlay renders the StudyMap label, removed on restore", () => {
    mind = makeMind();
    const restore = applyTargetAppearance({
      mind, target: mind.map,
      appearance: { ...DEFAULT_APPEARANCE, content: { ...DEFAULT_APPEARANCE.content, branding: true } },
    });
    expect(mind.map.querySelector(".mm-export-overlay").textContent).toContain("StudyMap");
    restore();
    expect(mind.map.querySelector(".mm-export-overlay")).toBeNull();
  });
});

describe("PRESETS", () => {
  it("every preset has all required fields and a distinct identity from the defaults where intended", () => {
    Object.entries(PRESETS).forEach(([name, preset]) => {
      expect(preset).toHaveProperty("font");
      expect(preset).toHaveProperty("branchColorMode");
      expect(preset).toHaveProperty("spacing");
      expect(preset).toHaveProperty("connectorThickness");
      expect(preset.content).toHaveProperty("relations");
      expect(preset.content).toHaveProperty("citations");
      expect(preset.content).toHaveProperty("legend");
      expect(preset.content).toHaveProperty("branding");
      void name;
    });
    expect(PRESETS.minimal.branchColorMode).toBe("monochrome");
    expect(PRESETS.presentation.content.branding).toBe(true);
  });
});
