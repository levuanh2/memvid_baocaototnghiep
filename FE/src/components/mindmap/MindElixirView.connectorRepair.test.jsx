// @vitest-environment jsdom
//
// 2026-09-24 regression, five rounds of the same bug family, each only
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
// reliably the container's settled size.
//
// Round 3 -- after removing that one-shot gate, still broken live. Directly
// instrumented MindElixir.prototype.layout in the live browser console: the
// call count stayed at 0 through several genuine, confirmed resizes -- the
// ResizeObserver never fired its callback at all in production. Replaced
// the trigger with a bounded requestAnimationFrame poll on mount.
//
// Round 4 -- deployed the poll, still broken live. The poll's readiness
// check (`el.clientWidth > 0`) is not sufficient: the container reported a
// real width on the very FIRST poll frame, layout()+linkDiv() ran, and the
// paths were STILL NaN. `fitIfReady()` now verifies the actual rendered
// path data instead of trusting `clientWidth` as a proxy.
//
// Round 5 (this one) -- deployed the self-verifying poll, STILL broken
// live, five real seconds after mount, with clientWidth/clientHeight
// confirmed to still be exactly 0 at that point. Root cause: WorkspaceContainer
// mounts every pane's content as soon as it HAS data, not when it becomes
// the active tab -- if the map arrives while the user is on the Chat tab,
// the container stays hidden (display:none) for however long the user
// takes to click into Mind Map, an UNBOUNDED, user-paced interval. The
// poll's ~1s (60-frame) cap exhausted and gave up long before that click
// ever happened. `startFitPoll()` now has no frame cap (only a generous 15s
// wall-clock safety valve), and the ResizeObserver -- confirmed live to
// never fire at all in this app -- was replaced with an IntersectionObserver,
// the tool actually built for detecting a display:none -> visible
// transition, which restarts the poll whenever the pane genuinely becomes
// visible however long after mount that is.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixir from "mind-elixir";
import MindElixirView from "./MindElixirView";

let ioCallback = null;
beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.ResizeObserver = window.ResizeObserver || class {
    observe() {} unobserve() {} disconnect() {}
  };
  window.IntersectionObserver = class {
    constructor(cb) { ioCallback = cb; }
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

let root;
afterEach(async () => {
  // Unmount properly (not just detach the DOM node) so each test's rAF
  // poll -- unbounded except for a 15s wall-clock ceiling since this round
  // -- actually stops via its effect cleanup, instead of lingering in the
  // background across tests and calling into a since-restored (or a later
  // test's freshly re-spied) MindElixir.prototype.
  if (root) { await act(async () => { root.unmount(); }); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  ioCallback = null;
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

async function renderMounted({ fixFromCallNumber = 1, startVisible = true } = {}) {
  const layoutSpy = vi.spyOn(MindElixir.prototype, "layout");
  const linkDivSpy = mockLinkDivFixedFromCall(fixFromCallNumber);
  const scaleFitSpy = vi.spyOn(MindElixir.prototype, "scaleFit");

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MindElixirView data={DATA} onRegenerate={vi.fn()} regenerating={false} controller={CONTROLLER} />);
  });

  const realEl = container.querySelector(".me-container");
  if (startVisible) {
    Object.defineProperty(realEl, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(realEl, "clientHeight", { value: 600, configurable: true });
  }

  return { layoutSpy, linkDivSpy, scaleFitSpy, realEl };
}

describe("MindElixirView connector repair", () => {
  it("keeps polling past a call where the container measured real size but the paths were still NaN", async () => {
    const { layoutSpy, linkDivSpy, scaleFitSpy } = await renderMounted({ fixFromCallNumber: 2 });

    await vi.waitFor(() => {
      expect(linkDivSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    }, { timeout: 3000 });

    expect(layoutSpy).toHaveBeenCalled();
    expect(scaleFitSpy).toHaveBeenCalledTimes(1); // one-shot fit, even though the repair itself retried
  });

  it("does not report success (and does not fire scaleFit) while paths are still NaN", async () => {
    const { linkDivSpy, scaleFitSpy } = await renderMounted({ fixFromCallNumber: Infinity });

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(linkDivSpy.mock.calls.length).toBeGreaterThan(1); // kept retrying
    expect(scaleFitSpy).not.toHaveBeenCalled(); // never falsely reported fixed
  });

  it("keeps polling well past the OLD ~1s frame cap while the pane stays hidden, then succeeds once it's given a real size", async () => {
    // Mount with the container still at 0x0 (the map arrived while the pane
    // is hidden -- clientWidth/Height are never set here).
    const { linkDivSpy, scaleFitSpy } = await renderMounted({ fixFromCallNumber: 1, startVisible: false });

    // Real wall-clock wait, deliberately longer than the OLD 60-frame
    // (~1s) cap this round replaced. The old poll would have exhausted and
    // given up well before this point; the new one must still be trying.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(scaleFitSpy).not.toHaveBeenCalled(); // correctly still not fixed -- container is still 0x0

    // The pane becomes visible now (matches the user finally clicking into
    // the Mind Map tab, however long after mount that took).
    const realEl = container.querySelector(".me-container");
    Object.defineProperty(realEl, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(realEl, "clientHeight", { value: 600, configurable: true });

    await vi.waitFor(() => {
      expect(scaleFitSpy).toHaveBeenCalledTimes(1);
    }, { timeout: 3000 });
    expect(linkDivSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  }, 10000);

  it("IntersectionObserver restarts the poll when the pane becomes visible (ResizeObserver confirmed live to never fire in this app)", async () => {
    const { layoutSpy, linkDivSpy } = await renderMounted({ fixFromCallNumber: 1, startVisible: false });

    await new Promise((resolve) => setTimeout(resolve, 100));
    layoutSpy.mockClear();
    linkDivSpy.mockClear();

    const realEl = container.querySelector(".me-container");
    Object.defineProperty(realEl, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(realEl, "clientHeight", { value: 600, configurable: true });

    await act(async () => {
      ioCallback?.([{ isIntersecting: true, boundingClientRect: { width: 800, height: 600 } }]);
    });

    await vi.waitFor(() => {
      expect(layoutSpy).toHaveBeenCalled();
      expect(linkDivSpy).toHaveBeenCalled();
    }, { timeout: 3000 });
  });
});
