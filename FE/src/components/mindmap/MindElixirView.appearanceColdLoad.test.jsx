// @vitest-environment jsdom
//
// Follow-up to PR #63 (Appearance V2). Live-production QA (real EC2 backend,
// real QA account) reproduced: a map with a saved, server-confirmed
// non-default `appearance` sometimes loads showing the plain default look
// instead — 1 failure in 4 cold loads of the SAME map in a SAME fresh tab,
// no PATCH fired, server record correct throughout. Reloading again (no
// other state change) then showed it correctly every time — the signature
// of a timing race, not a data-loss bug.
//
// Root cause: the mount effect that creates/refreshes the mind-elixir
// instance keys on `[data?.id, startFitPoll]` ONLY (deliberately — so a
// local "Áp dụng" PATCH success never re-triggers recordToMindElixir/
// refresh()). The OLD code applied `data?.appearance` directly inside that
// same effect, inheriting its blind spot: if the `data` object for the
// CURRENT id is first seen with `appearance` still absent/stale, the canvas
// is stuck on default forever, because the mount effect never runs again
// for that id — there is no second chance for a later-updated `appearance`
// to apply.
//
// These tests reproduce every race shape called for: appearance arriving
// before/after/with the instance, a map switch (A→B→A, checking for a
// leaked connector <style> tag along the way), and a React StrictMode
// double mount/cleanup/mount cycle. Each one asserts what a user would
// actually see — inline node style / a style tag presence — not an
// internal implementation detail.
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixir from "mind-elixir";
import MindElixirView from "./MindElixirView";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
});

// jsdom never computes real geometry, so mind-elixir's own linkDiv() writes
// literal "NaN" into every connector `d` attribute — `validateMindMapRender`
// (used by the readiness poll this effect is gated behind) correctly
// refuses to call that "ready" forever. Same fix MindElixirView.
// lifecycle.test.jsx already uses: force valid path data after every real
// linkDiv() call.
beforeEach(() => {
  const originalLinkDiv = MindElixir.prototype.linkDiv;
  vi.spyOn(MindElixir.prototype, "linkDiv").mockImplementation(function (...args) {
    const result = originalLinkDiv.apply(this, args);
    this.container.querySelectorAll(".lines path, .subLines path").forEach((path) => path.setAttribute("d", "M 10 10 L 20 20"));
    return result;
  });
});

const STUDY_APPEARANCE = {
  version: 2,
  preset: "study",
  overrides: { canvas: {}, connector: {}, node: { root: {}, branch: {}, leaf: {} } },
};

function dataFor(id, { appearance } = {}) {
  return {
    id, title: `Map ${id}`,
    nodes: [
      { id: "root", kind: "root", title: "Root", parent: null },
      { id: "leaf1", kind: "leaf", title: "Leaf One", parent: "root" },
    ],
    relations: [], sources: [], schema_version: 2,
    appearance,
  };
}

function makeController() {
  return {
    registerMindInstance: vi.fn(),
    onNodeSelected: vi.fn(), selected: null, sidecarRef: { current: new Map() },
  };
}

// mind-elixir prefixes every node id with "me" in the DOM's data-nodeid —
// confirmed against the existing lifecycle tests' own id scheme. "root" ->
// "meroot".
function findNodeEl(container, rawId) {
  return container.querySelector(`[data-nodeid="me${rawId}"]`);
}

function connectorStyleTags(container) {
  return container.querySelectorAll('style[data-mm-appearance-connector]');
}

// The appearance-apply effect only fires once `renderState === "ready"` (a
// second real-browser-only race, found via Playwright, requires this — see
// the long comment at its definition in MindElixirView.jsx: `mind.scale()`
// from the mobile readable-floor, and `mind.changeTheme()` from the dark-
// mode MutationObserver, both rewrite node inline style directly and can
// otherwise land after an early apply and wipe it). jsdom never lays
// anything out for real, so `fitIfReady`'s own `clientWidth`/`clientHeight`
// check never passes on its own — these tests give it real geometry and
// drive fake timers forward, exactly the pattern MindElixirView.lifecycle.
// test.jsx already established for the same reason.
async function settleToReady(container) {
  const el = container.querySelector(".me-container");
  Object.defineProperty(el, "clientWidth", { value: 400, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 300, configurable: true });
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
}

let container;
let root;

afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MindElixirView — appearance cold-load race (PR C2 follow-up)", () => {
  it("applies the saved appearance when it arrives WITH the instance (baseline — already works today)", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const controller = makeController();

    await act(async () => {
      root.render(<MindElixirView data={dataFor("map-1", { appearance: STUDY_APPEARANCE })} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    await settleToReady(container);

    const rootEl = findNodeEl(container, "root");
    expect(rootEl.style.cssText).not.toBe("");
    expect(rootEl.style.borderRadius).toBe("10px");
  });

  it("applies the saved appearance when it arrives AFTER the instance is already ready (same id, data updates) — reproduces the live cold-load miss", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const controller = makeController();

    // First render: instance created, but `data.appearance` for this id is
    // still absent — exactly the "instance ready, appearance not yet"
    // ordering the live QA session hit.
    await act(async () => {
      root.render(<MindElixirView data={dataFor("map-1")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    await settleToReady(container);
    const rootElBefore = findNodeEl(container, "root");
    expect(rootElBefore.style.cssText).toBe(""); // genuinely no appearance yet — correct so far

    // The SAME id, but `data` now carries the appearance (the record
    // finished loading / was updated) — the mount effect's own deps
    // (`[data?.id, startFitPoll]`) do NOT change here, so on the OLD code
    // this update was silently dropped forever.
    await act(async () => {
      root.render(<MindElixirView data={dataFor("map-1", { appearance: STUDY_APPEARANCE })} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });

    const rootElAfter = findNodeEl(container, "root");
    expect(rootElAfter.style.borderRadius).toBe("10px");
    expect(rootElAfter.style.boxShadow).not.toBe("");
  });

  it("is idempotent: re-rendering with the IDENTICAL id+appearance does not reapply (no duplicate connector <style> tag)", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const controller = makeController();
    const withConnector = {
      version: 2, preset: "study",
      overrides: { canvas: {}, connector: { thickness: "thick" }, node: { root: {}, branch: {}, leaf: {} } },
    };

    await act(async () => {
      root.render(<MindElixirView data={dataFor("map-1", { appearance: withConnector })} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    await settleToReady(container);
    expect(connectorStyleTags(container).length).toBe(1);

    // Unrelated parent rerender: new `data` object, SAME id, SAME
    // appearance content.
    await act(async () => {
      root.render(<MindElixirView data={dataFor("map-1", { appearance: withConnector })} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    expect(connectorStyleTags(container).length).toBe(1); // still exactly one, not two
  });

  it("A → B → A: each switch shows the right map's own appearance, and never leaks a connector <style> tag from the map just left", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const controller = makeController();
    const withConnector = {
      version: 2, preset: "study",
      overrides: { canvas: {}, connector: { thickness: "thick" }, node: { root: {}, branch: {}, leaf: {} } },
    };

    await act(async () => {
      root.render(<MindElixirView data={dataFor("map-a", { appearance: withConnector })} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    await settleToReady(container);
    expect(connectorStyleTags(container).length).toBe(1);

    // Switch to a map with NO saved appearance.
    await act(async () => {
      root.render(<MindElixirView data={dataFor("map-b")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    await settleToReady(container);
    expect(connectorStyleTags(container).length).toBe(0); // map-a's connector style must not survive the switch
    expect(findNodeEl(container, "root").style.cssText).toBe("");

    // Back to map-a.
    await act(async () => {
      root.render(<MindElixirView data={dataFor("map-a", { appearance: withConnector })} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    await settleToReady(container);
    expect(connectorStyleTags(container).length).toBe(1);
    expect(findNodeEl(container, "root").style.borderRadius).toBe("10px");
  });

  it("React StrictMode double mount/cleanup/mount ends in the same clean state as a single mount (no duplicate styling, no leaked style tag)", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const controller = makeController();

    await act(async () => {
      root.render(
        <React.StrictMode>
          <MindElixirView data={dataFor("map-1", { appearance: STUDY_APPEARANCE })} onRegenerate={vi.fn()} regenerating={false} controller={controller} />
        </React.StrictMode>,
      );
    });
    await settleToReady(container);

    const rootEl = findNodeEl(container, "root");
    expect(rootEl.style.borderRadius).toBe("10px");
    expect(connectorStyleTags(container).length).toBeLessThanOrEqual(1);
  });

  it("unmounting while an appearance is applied restores cleanly (no orphaned connector <style> tag left in the DOM)", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const controller = makeController();
    const withConnector = {
      version: 2, preset: "study",
      overrides: { canvas: {}, connector: { thickness: "thick" }, node: { root: {}, branch: {}, leaf: {} } },
    };

    await act(async () => {
      root.render(<MindElixirView data={dataFor("map-1", { appearance: withConnector })} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    await settleToReady(container);
    expect(connectorStyleTags(container).length).toBe(1);

    await act(async () => { root.unmount(); });
    root = null;
    expect(connectorStyleTags(container).length).toBe(0);
  });
});
