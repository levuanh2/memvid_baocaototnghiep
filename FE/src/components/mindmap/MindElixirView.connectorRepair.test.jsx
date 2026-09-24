// @vitest-environment jsdom
//
// 2026-09-24 regression: mind.init() run against a 0x0 container (the map
// arriving while a hidden pane, or before the container's first real layout
// pass) leaves mind-elixir's root-level `.lines` connector paths permanently
// broken (`d="M NaN 0 Q NaN 0 0 0"` -- confirmed live against a real
// production record). A ResizeObserver already existed to catch the
// hidden -> visible transition, but it only called `scaleFit()`, which
// mind-elixir's own source shows only recomputes a zoom/pan transform from
// EXISTING element offsets -- it never calls `layout()`/`linkDiv()`, so it
// could not have repaired the broken paths. This proves `layout()` and
// `linkDiv()` are now actually invoked once the container reports a real
// (non-zero) size.
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

describe("MindElixirView connector repair on hidden -> visible transition", () => {
  it("calls layout() and linkDiv() (not just scaleFit()) once the container reports a real size", async () => {
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
    // already. Give it a real size and manually fire the observer, matching
    // the hidden -> visible transition this effect exists to catch.
    const realEl = container.querySelector(".me-container");
    Object.defineProperty(realEl, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(realEl, "clientHeight", { value: 600, configurable: true });

    layoutSpy.mockClear();
    linkDivSpy.mockClear();
    scaleFitSpy.mockClear();

    await act(async () => {
      resizeCallback?.([{ contentRect: { width: 800, height: 600 } }]);
    });

    expect(layoutSpy).toHaveBeenCalled();
    expect(linkDivSpy).toHaveBeenCalled();
    expect(scaleFitSpy).toHaveBeenCalled();
  });
});
