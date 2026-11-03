// @vitest-environment jsdom
//
// 2026-09-24 regression, six rounds of the same bug family, each only
// found by re-verifying live against a real production record instead of
// trusting that a fix which looked correct on paper had actually landed:
//
// Round 1 -- mind.init() run against a 0x0 container leaves mind-elixir's
// root-level `.lines` connector paths permanently broken
// (`d="M NaN 0 Q NaN 0 0 0"`). An existing ResizeObserver caught the
// hidden -> visible transition but only called `scaleFit()`, which never
// calls `layout()`/`linkDiv()`, so it could not have repaired the paths.
//
// Round 2 -- after wiring in layout()+linkDiv(), still broken live. The
// repair was gated behind a one-shot flag that the FIRST qualifying resize
// report consumed, not reliably the container's settled size.
//
// Round 3 -- after removing that gate, still broken live. The
// ResizeObserver never fired its callback at all in production (directly
// instrumented). Replaced with a bounded requestAnimationFrame poll.
//
// Round 4 -- the poll's readiness check (`el.clientWidth > 0`) was not
// sufficient: the container reported a real width on the very FIRST poll
// frame, layout()+linkDiv() ran, and the paths were STILL NaN.
// `fitIfReady()` now verifies the actual rendered path data instead of
// trusting `clientWidth` as a proxy.
//
// Round 5 -- the poll's ~1s (60-frame) cap gave up long before the user
// clicked into the Mind Map tab (an unbounded, user-paced wait, not a
// brief settling delay) -- clientWidth confirmed still 0 five real seconds
// after mount. Replaced with an IntersectionObserver that restarted an
// uncapped poll on every "became visible" report.
//
// Round 6 (this one) -- IntersectionObserver fires REPEATEDLY during the
// right panel's own CSS transition, and cancelling + restarting the poll
// on every one of those firings kept resetting it before it landed a
// frame where geometry was actually correct -- confirmed live it never
// succeeded across a full 15s window, while a single manual
// mind.layout()+linkDiv() call from the console, made after everything
// had visibly settled, fixed it instantly every time. Removed the
// observer entirely: a single continuous poll (generous 2-minute
// wall-clock ceiling, guarded against a second concurrent poll) started
// once at mount notices real geometry the next frame after it exists,
// hidden or not, transitioning or not -- no external visibility signal to
// time correctly at all.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixir from "mind-elixir";
import MindElixirView from "./MindElixirView";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
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
  // poll -- whose budget counts only time the container has real size -- actually
  // stops via its effect cleanup, instead of lingering in the background
  // across tests and calling into a since-restored (or a later test's
  // freshly re-spied) MindElixir.prototype.
  if (root) { await act(async () => { root.unmount(); }); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
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
    // the Mind Map tab, however long after mount that took) -- no observer,
    // no event, just the container measuring real size on the next poll tick.
    const realEl = container.querySelector(".me-container");
    Object.defineProperty(realEl, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(realEl, "clientHeight", { value: 600, configurable: true });

    await vi.waitFor(() => {
      expect(scaleFitSpy).toHaveBeenCalledTimes(1);
    }, { timeout: 3000 });
    expect(linkDivSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  }, 10000);
});
