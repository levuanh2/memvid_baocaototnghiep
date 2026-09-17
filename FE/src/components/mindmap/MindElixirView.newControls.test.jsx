// @vitest-environment jsdom
//
// Regression for round 10 (mockup parity): two new floating canvas controls
// added to match the approved reference image — a bottom-center "generate a
// new map" CTA (previously the only entry point lived inside SidebarRight's
// own panel) and a standalone bottom-right fullscreen button (previously
// merged into the main zoom/view toolbar). Both reuse existing, already-
// wired behavior (`onRegenerate` prop, the same native-Fullscreen-API
// `toggleFullscreen` this view already had) — this only proves the NEW JSX
// is wired to the right handler, not that regenerate/fullscreen themselves
// work (those predate this round).
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixirView from "./MindElixirView";

beforeAll(() => {
  window.matchMedia = window.matchMedia || function () {
    return { matches: false, addEventListener() {}, removeEventListener() {} };
  };
  // jsdom implements neither — this view's own ResizeObserver effect
  // (re-layout on the canvas becoming visible) and mind-elixir's own
  // internal use of MutationObserver's target need at least a no-op stand-in.
  window.ResizeObserver = window.ResizeObserver || class {
    observe() {} unobserve() {} disconnect() {}
  };
});

const DATA = {
  id: "map-1", title: "Test Map",
  nodes: [{ id: "root", kind: "root", title: "Root", parent: null }],
  relations: [], sources: [], schema_version: 2,
};

const CONTROLLER = {
  registerMindInstance: vi.fn(),
  onNodeSelected: vi.fn(),
  selected: null,
  sidecarRef: { current: new Map() },
};

let container;

afterEach(() => {
  if (container) {
    document.body.removeChild(container);
    container = null;
  }
  vi.restoreAllMocks();
});

async function renderView(onRegenerate) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MindElixirView data={DATA} onRegenerate={onRegenerate} regenerating={false} controller={CONTROLLER} />);
  });
  return root;
}

describe("MindElixirView new canvas controls (round 10)", () => {
  it("bottom-center generate CTA calls onRegenerate, not some new/duplicate generation path", async () => {
    const onRegenerate = vi.fn();
    await renderView(onRegenerate);

    const cta = container.querySelector(".mm-generate-cta");
    expect(cta).toBeTruthy();
    expect(cta.textContent).toContain("Tạo sơ đồ mới");
    // Exactly one button at this position — no separate dropdown/chevron
    // trigger next to it, since nothing in this product backs a second
    // generation option (see MindElixirView.jsx's comment at the button's
    // definition for why none was added).
    expect(container.querySelectorAll(".mm-generate-cta").length).toBe(1);

    await act(async () => { cta.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("fullscreen is a standalone corner button, separate from the main toolbar", async () => {
    await renderView(vi.fn());

    const toolbar = container.querySelector(".mm-floating-toolbar");
    const corner = container.querySelector(".mm-fullscreen-corner");
    expect(toolbar).toBeTruthy();
    expect(corner).toBeTruthy();
    // The fullscreen button must NOT be a descendant of the main toolbar —
    // that's the actual regression this test guards (it used to be the
    // toolbar's last child).
    expect(toolbar.contains(corner)).toBe(false);
    expect(corner.getAttribute("aria-label")).toMatch(/toàn màn hình/i);
  });
});
