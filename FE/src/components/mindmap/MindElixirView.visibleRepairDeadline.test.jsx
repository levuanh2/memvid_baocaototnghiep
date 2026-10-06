// @vitest-environment jsdom
//
// Production reproduction (2026-10-06, 7/7 at dwell >= 10000 ms, 3/3 ready at
// dwell <= 9950 ms): a map that initialises while its Mind Map pane is still
// hidden (container 0x0) gets NaN connector paths from mind-elixir's linkDiv,
// and the sanitizer neutralises them to d="". The repair poll's deadline was an
// absolute 10 s from mount, so it expired while the pane was still hidden and
// set the error banner. Nothing restarted the poll when the pane became
// visible, so the map stayed in the error state.
//
// The deadline now starts only once the container has real size, and resets
// whenever the container goes back to 0x0. Hidden time never consumes the
// render budget.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixir from "mind-elixir";
import MindElixirView from "./MindElixirView";

const DATA = {
  id: "map-visible-repair", title: "Visible repair", schema_version: 3,
  nodes: [
    { id: "root", kind: "root", title: "Root", parent: null },
    { id: "a", kind: "section", title: "Branch", parent: "root" },
    { id: "b", kind: "section", title: "Branch B", parent: "root" },
  ],
  relations: [], sources: [],
};
const CONTROLLER = { registerMindInstance: vi.fn(), onNodeSelected: vi.fn(), selected: null, sidecarRef: { current: new Map() } };
const TICK = 16;
const BUDGET = 10000;

let container;
let root;

beforeEach(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});

afterEach(async () => {
  if (root) { await act(async () => { root.unmount(); }); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Mirrors the real browser: linkDiv writes valid geometry only once the container
// has real size, and writes NaN while it is 0x0. `fixAfterVisibleCalls` lets a test
// keep the output invalid while visible to exercise the timeout.
function installLinkDivSpy({ alwaysInvalid = false } = {}) {
  const orig = MindElixir.prototype.linkDiv;
  return vi.spyOn(MindElixir.prototype, "linkDiv").mockImplementation(function (...args) {
    const result = orig.apply(this, args);
    const pane = document.querySelector(".me-container");
    const sized = pane.clientWidth > 0 && pane.clientHeight > 0;
    this.container.querySelectorAll(".lines path, .subLines path").forEach((p) => {
      p.setAttribute("d", sized && !alwaysInvalid ? "M 100 100 L 200 200" : "M NaN 0 Q NaN 0 0 0");
    });
    return result;
  });
}

function setSize(el, w, h) {
  Object.defineProperty(el, "clientWidth", { value: w, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: h, configurable: true });
}

async function mountHidden({ alwaysInvalid = false } = {}) {
  const linkDivSpy = installLinkDivSpy({ alwaysInvalid });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MindElixirView data={DATA} onRegenerate={vi.fn()} regenerating={false} controller={CONTROLLER} />);
  });
  const el = container.querySelector(".me-container");
  setSize(el, 0, 0);
  return { linkDivSpy, el, wrap: container.querySelector("[data-mindmap-render-state]") };
}

const state = () => container.querySelector("[data-mindmap-render-state]")?.getAttribute("data-mindmap-render-state");
const bannerError = () => !!container.querySelector(".mm-render-overlay.is-error");
const advance = async (ms) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
const invalidPaths = () => [...container.querySelectorAll(".lines path, .subLines path")]
  .filter((p) => /NaN|undefined|Infinity/.test(p.getAttribute("d") || "")).length;

describe("MindElixirView visible-only repair deadline", () => {
  it("A: hidden longer than the timeout, then visible, repairs without error", async () => {
    const { el, linkDivSpy } = await mountHidden();
    expect(invalidPaths()).toBe(0); // sanitizer neutralised the hidden NaN writes

    await advance(BUDGET + 500); // hidden the whole time
    expect(bannerError()).toBe(false);
    expect(state()).not.toBe("error");

    setSize(el, 1187, 920); // pane becomes visible
    await advance(TICK);
    expect(state()).toBe("ready");
    expect(bannerError()).toBe(false);
    expect(invalidPaths()).toBe(0);
    expect(container.querySelectorAll(".lines path").length).toBeGreaterThan(0);
    expect(linkDivSpy).toHaveBeenCalled();
  });

  it("B: visible but connectors never valid: times out to error after 10 s of visible time", async () => {
    const { el } = await mountHidden({ alwaysInvalid: true });
    setSize(el, 1187, 920);
    await advance(BUDGET - 500);
    expect(bannerError()).toBe(false);
    await advance(1000);
    expect(bannerError()).toBe(true);
    expect(state()).toBe("error");
  });

  it("C: hidden -> visible -> hidden -> visible: each visible stretch gets a fresh budget", async () => {
    const { el } = await mountHidden({ alwaysInvalid: true });
    setSize(el, 1187, 920);
    await advance(6000); // visible stretch 1 (budget not yet spent)
    setSize(el, 0, 0);
    await advance(BUDGET + 2000); // hidden: budget must not run
    expect(bannerError()).toBe(false);
    setSize(el, 1187, 920); // visible stretch 2
    await advance(BUDGET - 500);
    expect(bannerError()).toBe(false);
    await advance(1000);
    expect(bannerError()).toBe(true);
  });

  it("D: unmount while waiting cancels the poll and causes no state update", async () => {
    const { linkDivSpy } = await mountHidden();
    await advance(3000);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { root.unmount(); });
    root = null;
    const callsAtUnmount = linkDivSpy.mock.calls.length;
    await advance(BUDGET + 2000);
    expect(linkDivSpy.mock.calls.length).toBe(callsAtUnmount);
    expect(errSpy.mock.calls.filter(([m]) => /unmounted|state update/i.test(String(m)))).toHaveLength(0);
  });

  it("E: retry restarts exactly one poll, not two", async () => {
    const { el, linkDivSpy } = await mountHidden({ alwaysInvalid: true });
    setSize(el, 1187, 920);
    await advance(BUDGET + 500);
    expect(bannerError()).toBe(true);
    const retry = container.querySelector('[data-action="retry-mindmap-render"]');
    expect(retry).toBeTruthy();
    const before = linkDivSpy.mock.calls.length;
    await act(async () => { retry.click(); });
    await advance(800); // 50 ticks at 16 ms; two parallel polls would double this
    const delta = linkDivSpy.mock.calls.length - before;
    expect(delta).toBeGreaterThanOrEqual(40);
    expect(delta).toBeLessThanOrEqual(56);
  });
});
