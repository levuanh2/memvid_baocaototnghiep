// @vitest-environment jsdom
//
// Mind Elixir lifecycle invariant (V2, preserved through this redesign):
// one instance per viewer, and switching to a different saved map refreshes
// that SAME instance (`refresh()` + `clearHistory()`) rather than
// destroying and reconstructing it, with exactly one `scaleFit()` call per
// switch — not one-per-render, not zero. This has no dedicated test in the
// suite; the other MindElixirView test files cover controls/ownership, not
// this lifecycle contract, so a regression here (e.g. a second `new
// MindElixir()` on map switch, or scaleFit firing on every rerender) would
// currently ship silently.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixir from "mind-elixir";
import MindElixirView from "./MindElixirView";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
});

function dataFor(id) {
  return {
    id, title: `Map ${id}`,
    nodes: [{ id: "root", kind: "root", title: "Root", parent: null }],
    relations: [], sources: [], schema_version: 2,
    mindMaps: [{ id, title: `Map ${id}`, sources: [] }],
  };
}

let container;
let root;

afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MindElixirView mind-elixir lifecycle", () => {
  it("creates exactly one MindElixir instance across a map switch, refreshing it instead of reconstructing", async () => {
    const spy = vi.spyOn(MindElixir.prototype, "init");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let mind = null;
    const controller = {
      registerMindInstance: vi.fn((m) => { mind = m; }),
      onNodeSelected: vi.fn(), selected: null, sidecarRef: { current: new Map() },
    };

    await act(async () => {
      root.render(<MindElixirView data={dataFor("map-1")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    const firstInstance = mind;
    expect(spy).toHaveBeenCalledTimes(1);

    const refreshSpy = vi.spyOn(firstInstance, "refresh");
    const clearHistorySpy = vi.spyOn(firstInstance, "clearHistory");

    await act(async () => {
      root.render(<MindElixirView data={dataFor("map-2")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });

    // same instance, not a second `new MindElixir()` + init()
    expect(spy).toHaveBeenCalledTimes(1);
    expect(mind).toBe(firstInstance);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(clearHistorySpy).toHaveBeenCalledTimes(1);
  });

  it("calls scaleFit exactly once per map switch, not on every rerender", async () => {
    // Real-timer version of this test raced against MindElixirView's own
    // 16ms setTimeout-based fit poll (a legitimate, intentional part of the
    // connector-repair fix -- see `startFitPoll`'s comment in the source):
    // enough real wall-clock time could pass between the two `act()` calls
    // below for that background poll to fire on its own, independent of
    // whether a same-id rerender happened in between, making the "not
    // called yet" assertion flaky rather than wrong. Fake timers make the
    // poll's own 16ms cadence deterministic instead.
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let mind = null;
    const controller = {
      registerMindInstance: vi.fn((m) => { mind = m; }),
      onNodeSelected: vi.fn(), selected: null, sidecarRef: { current: new Map() },
    };

    await act(async () => {
      root.render(<MindElixirView data={dataFor("map-1")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    // jsdom containers report 0x0 — the poll's `fitIfReady` only calls
    // scaleFit once real geometry exists. `containerRef.current` (the
    // React-owned wrapper mind-elixir was mounted into, class
    // "me-container") is what it measures — NOT `mind.container`, which is
    // a separate ".map-container" div the library creates one level deeper.
    const refEl = container.querySelector(".me-container");
    Object.defineProperty(refEl, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(refEl, "clientHeight", { value: 300, configurable: true });
    const fitSpy = vi.spyOn(mind, "scaleFit");

    // Let the poll's first 16ms tick land and succeed (no `.lines path`
    // elements in this tiny jsdom tree, so the NaN-connector check trivially
    // passes) — this is the ONE expected scaleFit call for map-1.
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(fitSpy).toHaveBeenCalledTimes(1);
    fitSpy.mockClear();

    // rerender with the SAME data.id (e.g. a parent rerender unrelated to
    // switching maps): the mount effect's deps (`[data?.id, startFitPoll]`)
    // don't change, so no new poll starts, and the previous poll already
    // stopped itself on success — must not re-trigger a fit.
    await act(async () => {
      root.render(<MindElixirView data={dataFor("map-1")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(fitSpy).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<MindElixirView data={dataFor("map-2")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(fitSpy).toHaveBeenCalledTimes(1);
  });
});
