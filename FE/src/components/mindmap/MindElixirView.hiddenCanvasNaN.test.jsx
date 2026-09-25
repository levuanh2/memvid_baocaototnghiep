// @vitest-environment jsdom
//
// Regression test for a real bug found and root-caused on production, not
// this branch's own change: on `/app` reload with Chat as the active tab,
// the Mind Map pane's `mind.init(mindData)` (or `mind.refresh(mindData)` on
// a saved-map switch) runs while the pane is still CSS-hidden (WorkspaceContainer
// keeps every pane mounted, toggling only a `hidden` class -- see that
// file's own comment). Both `init()` and `refresh()` call mind-elixir's own
// internal `layout()` -> `linkDiv()` synchronously and unconditionally, with
// no container-size check. Against a 0x0 hidden container that computes
// connector geometry from zero-sized node boxes, producing literal "NaN" in
// every `.lines path`'s `d` attribute.
//
// Reproduced live (production, QA account): reload -> Chat active -> hidden
// Mind Map pane has 60 real nodes / 7 total connector paths, all 7 "NaN",
// canvas 0x0. Opening the tab once triggers the EXISTING `startFitPoll`
// repair (untouched by this fix -- it already works, confirmed live,
// NaN->0 within ~0.18-1.6s, no visible broken frame since the pane stays
// `display:none` throughout). The gap this closes: invalid `NaN` markup
// sitting in the live DOM for however long the user stays on another tab,
// rather than being neutralized in the same tick it's created.
//
// jsdom's `clientWidth`/`clientHeight` default to 0 for every element (no
// real layout engine) -- exactly the "hidden" condition this bug needs, so
// a completely ordinary mount reproduces it with no extra mocking.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixirView from "./MindElixirView";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
});

// A parent + child pair is the minimum shape that makes mind-elixir draw a
// real `.lines path` connector -- a root-only map has nothing to connect.
const DATA = {
  id: "map-1", title: "Test Map",
  nodes: [
    { id: "root", kind: "root", title: "Root", parent: null },
    { id: "child-1", kind: "topic", title: "Child", parent: "root" },
  ],
  relations: [], sources: [], schema_version: 2,
  mindMaps: [{ id: "map-1", title: "Test Map", sources: [] }],
};
const CONTROLLER = { registerMindInstance: vi.fn(), onNodeSelected: vi.fn(), selected: null, sidecarRef: { current: new Map() } };
let container;
let root;

afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
});

async function renderView(data = DATA) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MindElixirView data={data} onRegenerate={vi.fn()} regenerating={false} controller={CONTROLLER} />);
  });
  return root;
}

function nanPathCount() {
  return Array.from(container.querySelectorAll(".lines path"))
    .filter((p) => (p.getAttribute("d") || "").includes("NaN")).length;
}

describe("MindElixirView hidden-canvas connector sanitization", () => {
  it("never leaves a literal NaN in a connector path's d attribute while the pane is hidden (0x0), on first mount", async () => {
    await renderView();
    const paths = container.querySelectorAll(".lines path");
    expect(paths.length).toBeGreaterThan(0); // sanity: the parent+child pair did produce a connector
    expect(nanPathCount()).toBe(0);
  });

  it("never leaves a literal NaN after a map switch (refresh()) while still hidden", async () => {
    await renderView();
    expect(nanPathCount()).toBe(0);

    await act(async () => {
      root.render(<MindElixirView data={{ ...DATA, id: "map-2", title: "Second Map" }} onRegenerate={vi.fn()} regenerating={false} controller={CONTROLLER} />);
    });
    expect(nanPathCount()).toBe(0);
  });
});
