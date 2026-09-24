// @vitest-environment jsdom
//
// 2026-09-24 regression, two rounds of the same bug family:
//
// Round 1 -- mind.init() run against a 0x0 container (the map arriving
// while a hidden pane, or before the container's first real layout pass)
// leaves mind-elixir's root-level `.lines` connector paths permanently
// broken (`d="M NaN 0 Q NaN 0 0 0"` -- confirmed live against a real
// production record). An existing ResizeObserver caught the hidden ->
// visible transition but only called `scaleFit()`, which mind-elixir's own
// source shows only recomputes a zoom/pan transform from EXISTING element
// offsets -- it never calls `layout()`/`linkDiv()`, so it could not have
// repaired the broken paths.
//
// Round 2 -- after wiring in layout()+linkDiv(), the connectors were STILL
// broken live even though the container measured a healthy final size.
// Root cause: the repair was gated behind a one-shot `pendingFitRef` flag
// that the FIRST qualifying ResizeObserver entry (width>0 && height>0)
// consumed -- but that first entry is not reliably the container's settled
// size; it can fire mid CSS-transition (the right panel's own
// transform transition, tab-switch animation) against a still-wrong
// intermediate size, permanently spending the one repair attempt. This
// proves layout()/linkDiv() now rerun on a SECOND resize report too, not
// just the first.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixir from "mind-elixir";
import MindElixirView from "./MindElixirView";

let resizeCallback = null;
beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.ResizeObserver = class {
    constructor(cb) { resizeCallback = cb; }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const DATA = {
  id: "map-1", title: "Test Map", schema_version: 3,
  nodes: [
    { id: "root", kind: "root", title: "Root", parent: null },
    { id: "a", kind: "section", title: "Branch", parent: "root" },
  ],
  relations: [], sources: [],
};
const CONTROLLER = { registerMindInstance: vi.fn(), onNodeSelected: vi.fn(), selected: null, sidecarRef: { current: new Map() } };
let container;

afterEach(() => {
  if (container) { document.body.removeChild(container); container = null; }
  resizeCallback = null;
  vi.restoreAllMocks();
});

async function renderMounted() {
  const layoutSpy = vi.spyOn(MindElixir.prototype, "layout");
  const linkDivSpy = vi.spyOn(MindElixir.prototype, "linkDiv");
  const scaleFitSpy = vi.spyOn(MindElixir.prototype, "scaleFit");

  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MindElixirView data={DATA} onRegenerate={vi.fn()} regenerating={false} controller={CONTROLLER} />);
  });

  // Container starts at jsdom's default 0x0 -- init() ran against it
  // already. Give it a real size for the manual observer callbacks below.
  const realEl = container.querySelector(".me-container");
  Object.defineProperty(realEl, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(realEl, "clientHeight", { value: 600, configurable: true });

  layoutSpy.mockClear();
  linkDivSpy.mockClear();
  scaleFitSpy.mockClear();
  return { layoutSpy, linkDivSpy, scaleFitSpy };
}

describe("MindElixirView connector repair on hidden -> visible transition", () => {
  it("calls layout() and linkDiv() (not just scaleFit()) once the container reports a real size", async () => {
    const { layoutSpy, linkDivSpy, scaleFitSpy } = await renderMounted();

    await act(async () => {
      resizeCallback?.([{ contentRect: { width: 800, height: 600 } }]);
    });

    expect(layoutSpy).toHaveBeenCalled();
    expect(linkDivSpy).toHaveBeenCalled();
    expect(scaleFitSpy).toHaveBeenCalled();
  });

  it("still repairs geometry on a SECOND resize report, after the one-shot fit was already spent", async () => {
    const { layoutSpy, linkDivSpy, scaleFitSpy } = await renderMounted();

    // First report: an intermediate size mid CSS-transition -- this is what
    // used to permanently consume the one-shot repair attempt.
    await act(async () => {
      resizeCallback?.([{ contentRect: { width: 200, height: 100 } }]);
    });
    expect(scaleFitSpy).toHaveBeenCalledTimes(1);

    layoutSpy.mockClear();
    linkDivSpy.mockClear();

    // Second report: the container's real, settled size.
    await act(async () => {
      resizeCallback?.([{ contentRect: { width: 800, height: 600 } }]);
    });

    expect(layoutSpy).toHaveBeenCalled();
    expect(linkDivSpy).toHaveBeenCalled();
  });
});
