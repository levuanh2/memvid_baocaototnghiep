// @vitest-environment jsdom
//
// 2026-09-24 regression, three rounds of the same bug family, each only
// found by re-verifying live against a real production record instead of
// trusting that a fix which looked correct on paper had actually landed:
//
// Round 1 -- mind.init() run against a 0x0 container (the map arriving
// while a hidden pane, or before the container's first real layout pass)
// leaves mind-elixir's root-level `.lines` connector paths permanently
// broken (`d="M NaN 0 Q NaN 0 0 0"`). An existing ResizeObserver caught the
// hidden -> visible transition but only called `scaleFit()`, which
// mind-elixir's own source shows only recomputes a zoom/pan transform from
// EXISTING element offsets -- it never calls `layout()`/`linkDiv()`, so it
// could not have repaired the broken paths.
//
// Round 2 -- after wiring in layout()+linkDiv(), still broken live. The
// repair was gated behind a one-shot `pendingFitRef` flag that the FIRST
// qualifying resize report consumed -- but that first report is not
// reliably the container's settled size, so the one repair attempt could
// be spent on a still-wrong intermediate size.
//
// Round 3 -- after removing that one-shot gate, still broken live, even
// after several genuine, confirmed container resizes (right panel
// collapse/expand). Directly instrumented MindElixir.prototype.layout in
// the live browser console: the call count stayed at 0 through every
// resize -- the ResizeObserver never fired its callback at all in
// production. Manually calling mind.layout()+linkDiv() in that console DID
// fix the paths, proving the logic itself was correct -- only the trigger
// was unreliable. Replaced the trigger with a bounded requestAnimationFrame
// poll on mount, independent of ResizeObserver entirely.
//
// Round 4 (this one) -- deployed the poll, still broken live. The poll's
// readiness check (`el.clientWidth > 0`) is not sufficient either:
// reproduced live with layout()/linkDiv() instrumented from BEFORE mount
// (via a fresh dynamic import of the mind-elixir module, patched before
// the app ever created an instance) -- the container reported a real width
// on the very FIRST poll frame, layout()+linkDiv() ran exactly once, and
// the paths were STILL NaN (something layout() measures internally, e.g.
// the root topic element's own offsetWidth/offsetHeight per mind-elixir's
// source, was not yet settled even though the outer container's width
// already was). `fitIfReady()` now verifies the actual rendered path data
// instead of trusting `clientWidth` as a proxy, and only reports success
// once no `.lines path` still contains "NaN" -- the poll keeps retrying
// otherwise.
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

// jsdom has no real layout engine -- mind-elixir's REAL linkDiv() will
// always compute NaN geometry there, regardless of clientWidth. To test
// OUR retry/self-verification logic (not mind-elixir's internals, which
// are out of scope and third-party), this mock calls the real
// implementation through (so genuine call-count assertions still mean
// something) and then, starting from the Nth call, stamps valid path data
// onto the real `.lines` elements the real implementation created --
// simulating "geometry has now genuinely settled", matching what a real
// browser eventually produces once layout truly stabilizes.
function mockLinkDivFixedFromCall(fixFromCallNumber) {
  const orig = MindElixir.prototype.linkDiv;
  let calls = 0;
  return vi.spyOn(MindElixir.prototype, "linkDiv").mockImplementation(function (...args) {
    calls++;
    const result = orig.apply(this, args);
    if (calls >= fixFromCallNumber) {
      this.container.querySelectorAll(".lines path").forEach((p) => {
        p.setAttribute("d", "M 100 100 L 200 200");
      });
    }
    return result;
  });
}

async function renderMounted({ fixFromCallNumber = 1 } = {}) {
  const layoutSpy = vi.spyOn(MindElixir.prototype, "layout");
  const linkDivSpy = mockLinkDivFixedFromCall(fixFromCallNumber);
  const scaleFitSpy = vi.spyOn(MindElixir.prototype, "scaleFit");

  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MindElixirView data={DATA} onRegenerate={vi.fn()} regenerating={false} controller={CONTROLLER} />);
  });

  const realEl = container.querySelector(".me-container");
  Object.defineProperty(realEl, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(realEl, "clientHeight", { value: 600, configurable: true });

  return { layoutSpy, linkDivSpy, scaleFitSpy, realEl };
}

describe("MindElixirView connector repair", () => {
  it("keeps polling past a call where the container measured real size but the paths were still NaN", async () => {
    // Simulate the exact round-4 bug: first call still broken, second call
    // is where geometry has genuinely settled.
    const { layoutSpy, linkDivSpy, scaleFitSpy } = await renderMounted({ fixFromCallNumber: 2 });

    await vi.waitFor(() => {
      expect(linkDivSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    }, { timeout: 3000 });

    expect(layoutSpy).toHaveBeenCalled();
    expect(scaleFitSpy).toHaveBeenCalledTimes(1); // one-shot fit, even though the repair itself retried
  });

  it("does not report success (and does not fire scaleFit) while paths are still NaN", async () => {
    // Geometry never settles in this run -- the poll should keep trying
    // (bounded, ~60 frames) without ever calling scaleFit prematurely.
    const { linkDivSpy, scaleFitSpy } = await renderMounted({ fixFromCallNumber: Infinity });

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(linkDivSpy.mock.calls.length).toBeGreaterThan(1); // kept retrying
    expect(scaleFitSpy).not.toHaveBeenCalled(); // never falsely reported fixed
  });

  it("also repairs geometry when only the ResizeObserver fires (secondary safety net still works)", async () => {
    const { layoutSpy, linkDivSpy } = await renderMounted({ fixFromCallNumber: 1 });
    await vi.waitFor(() => expect(linkDivSpy.mock.calls.length).toBeGreaterThanOrEqual(1), { timeout: 3000 });
    layoutSpy.mockClear();
    linkDivSpy.mockClear();

    await act(async () => {
      resizeCallback?.([{ contentRect: { width: 800, height: 600 } }]);
    });

    expect(layoutSpy).toHaveBeenCalled();
    expect(linkDivSpy).toHaveBeenCalled();
  });
});
