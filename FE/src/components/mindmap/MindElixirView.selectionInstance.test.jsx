// @vitest-environment jsdom
//
// Viewport/instance gate at component level, against the real Mind Elixir class:
// the selection-mode round trip must not create a new instance, must not remount
// the root, must not call scaleFit / toCenter / refresh / layout, and must leave the
// canvas transform alone. Pan is simulated by changing the transform the way mind-elixir
// does (a style change on .map-canvas), and the marker side must follow the topic.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixir from "mind-elixir";
import MindElixirView from "./MindElixirView";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

const DATA = {
  id: "map-selection-instance", title: "Selection instance", schema_version: 3,
  nodes: [
    { id: "root", kind: "root", title: "Root", parent: null },
    { id: "left", kind: "section", title: "Nhánh trái", parent: "root" },
    { id: "right", kind: "section", title: "Nhánh phải", parent: "root" },
  ],
  relations: [], sources: [],
};
const CONTROLLER = { registerMindInstance: vi.fn(), onNodeSelected: vi.fn(), selected: null, sidecarRef: { current: new Map() } };
let container;
let root;

afterEach(async () => {
  if (root) { await act(async () => { root.unmount(); }); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
});

const counter = () => container.querySelector(".mm-selection-bar > span")?.textContent.trim() || null;
const markers = () => [...container.querySelectorAll("me-export-check")];

async function startSelection() {
  await act(async () => { container.querySelector(".mm-export-trigger").click(); });
  const scope = document.querySelector('input[name="mm-export-scope"][value="selected_branches"]');
  await act(async () => { scope.click(); });
  const inline = [...document.querySelectorAll("button.export-inline-action")][0];
  await act(async () => { inline.click(); });
}

describe("Branch selection: instance, root and transform are untouched", () => {
  it("round trip keeps the same instance and root, calls no fit or refresh, and leaves the transform alone", async () => {
    const spies = {
      scaleFit: vi.spyOn(MindElixir.prototype, "scaleFit"),
      toCenter: vi.spyOn(MindElixir.prototype, "toCenter"),
      refresh: vi.spyOn(MindElixir.prototype, "refresh"),
      layout: vi.spyOn(MindElixir.prototype, "layout"),
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<MindElixirView data={DATA} onRegenerate={vi.fn()} regenerating={false} controller={CONTROLLER} />);
    });
    const meRoot = container.querySelector("me-root");
    const canvas = container.querySelector(".map-canvas");
    expect(meRoot).toBeTruthy();
    expect(canvas).toBeTruthy();
    // Simulated pan/zoom: mind-elixir writes the transform as a style change on the canvas.
    canvas.style.transform = "translate3d(40px, 20px, 0px) scale(0.5)";
    const before = { transform: canvas.style.transform, fit: spies.scaleFit.mock.calls.length, center: spies.toCenter.mock.calls.length, refresh: spies.refresh.mock.calls.length, layout: spies.layout.mock.calls.length };

    await startSelection();
    expect(container.querySelector(".mm-selection-bar")).toBeTruthy();
    expect(counter()).toBe("Chọn các nhánh muốn xuất");
    expect(markers().length).toBeGreaterThan(0);

    const byDecorator = (side) => markers().find((m) => m.dataset.side === side);
    const leftMarker = byDecorator("left");
    const rightMarker = byDecorator("right");
    expect(leftMarker).toBeTruthy();
    expect(rightMarker).toBeTruthy();
    const dispatchKey = (el, key) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    await act(async () => { dispatchKey(leftMarker, " "); });
    expect(counter()).toBe("1 nhánh đã chọn");
    await act(async () => { dispatchKey(rightMarker, "Enter"); });
    expect(counter()).toBe("2 nhánh đã chọn");
    await act(async () => { dispatchKey(leftMarker, " "); });
    expect(counter()).toBe("1 nhánh đã chọn");
    await act(async () => { dispatchKey(rightMarker, " "); });
    expect(counter()).toBe("Chọn các nhánh muốn xuất");

    // Pan again while in selection mode, then cancel.
    canvas.style.transform = "translate3d(90px, 60px, 0px) scale(0.5)";
    const cancel = [...container.querySelectorAll(".mm-selection-bar button")].find((b) => b.textContent.trim() === "Hủy");
    await act(async () => { cancel.click(); });
    expect(markers().length).toBe(0);
    expect(container.querySelector(".mm-selection-bar")).toBeNull();

    // Reopen: starts at zero and no stale checked marker exists.
    await startSelection();
    expect(counter()).toBe("Chọn các nhánh muốn xuất");
    expect(markers().filter((m) => m.getAttribute("aria-checked") === "true")).toHaveLength(0);

    // Identity: same root element, transform changed only by the simulated pan.
    expect(container.querySelector("me-root")).toBe(meRoot);
    expect(canvas.style.transform).toBe("translate3d(90px, 60px, 0px) scale(0.5)");
    // Calls: nothing in the selection round trip fitted, centred, refreshed or laid out.
    expect(spies.scaleFit.mock.calls.length).toBe(before.fit);
    expect(spies.toCenter.mock.calls.length).toBe(before.center);
    expect(spies.refresh.mock.calls.length).toBe(before.refresh);
    expect(spies.layout.mock.calls.length).toBe(before.layout);
    // Connector geometry stays valid.
    const bad = [...container.querySelectorAll(".lines path, .subLines path")].filter((p) => /NaN|undefined|Infinity/.test(p.getAttribute("d") || "")).length;
    expect(bad).toBe(0);
  });
});
