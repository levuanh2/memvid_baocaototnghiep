// @vitest-environment jsdom
//
// Regression test for a real bug found and fixed this session: dragging the
// empty canvas background was supposed to pan the viewport (constructor sets
// `mouseSelectionButton: 2` specifically to free the left button for
// panning), but never did. Root cause is inside mind-elixir 5.13.0 itself —
// its own pointerdown handler hardcodes left-button-down on the bare
// `.map-container` to a `BoxSelect` state regardless of the
// `mouseSelectionButton` config, and `BoxSelect` has no `pointermove` case,
// so it's a silent dead end. Confirmed live via `getComputedStyle` on
// `.map-canvas` before/after a real drag (byte-identical transform). Can't
// patch node_modules, so MindElixirView now drives `mind.move(dx, dy)`
// itself from a pointerdown/move/up listener on the wrapper — this test
// proves that listener (a) calls `move` for a background drag and (b)
// ignores drags that start on a node (`<me-tpc>`), so node drag/reparent
// still goes through mind-elixir's own Drag state untouched.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixirView from "./MindElixirView";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
});

const DATA = {
  id: "map-1", title: "Test Map",
  nodes: [{ id: "root", kind: "root", title: "Root", parent: null }],
  relations: [], sources: [], schema_version: 2,
  mindMaps: [{ id: "map-1", title: "Test Map", sources: [] }],
};
let container;

afterEach(() => {
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
});

async function renderView() {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let capturedMind = null;
  const controller = {
    registerMindInstance: vi.fn((mind) => { capturedMind = mind; }),
    onNodeSelected: vi.fn(),
    selected: null,
    sidecarRef: { current: new Map() },
  };
  await act(async () => {
    root.render(<MindElixirView data={DATA} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
  });
  return { get mind() { return capturedMind; } };
}

function fire(el, type, opts) {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...opts }));
}

describe("MindElixirView background pan", () => {
  it("pans the map when a drag starts on the empty canvas background", async () => {
    const view = await renderView();
    view.mind.move = vi.fn(view.mind.move.bind(view.mind));
    const wrap = container.querySelector(".mm-canvas-wrap");
    expect(wrap).toBeTruthy();

    fire(wrap, "pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
    fire(wrap, "pointermove", { clientX: 130, clientY: 145, pointerId: 1 });
    fire(wrap, "pointerup", { clientX: 130, clientY: 145, pointerId: 1 });

    expect(view.mind.move).toHaveBeenCalled();
    const [dx, dy] = view.mind.move.mock.calls[0];
    expect(dx).toBe(30);
    expect(dy).toBe(45);
  });

  it("does not pan when a drag starts on a node", async () => {
    const view = await renderView();
    view.mind.move = vi.fn(view.mind.move.bind(view.mind));
    const wrap = container.querySelector(".mm-canvas-wrap");
    const fakeNode = document.createElement("me-tpc");
    wrap.appendChild(fakeNode);

    fire(fakeNode, "pointerdown", { clientX: 100, clientY: 100, pointerId: 2 });
    fire(wrap, "pointermove", { clientX: 130, clientY: 145, pointerId: 2 });
    fire(wrap, "pointerup", { clientX: 130, clientY: 145, pointerId: 2 });

    expect(view.mind.move).not.toHaveBeenCalled();
  });
});
