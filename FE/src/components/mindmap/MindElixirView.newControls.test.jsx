// @vitest-environment jsdom
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
const CONTROLLER = { registerMindInstance: vi.fn(), onNodeSelected: vi.fn(), selected: null, sidecarRef: { current: new Map() } };
let container;

afterEach(() => {
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
});

async function renderView(onRegenerate, props = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const { data: dataProps = {}, ...viewProps } = props;
  await act(async () => {
    root.render(<MindElixirView data={{ ...DATA, ...dataProps }} onRegenerate={onRegenerate} regenerating={false} controller={CONTROLLER} {...viewProps} />);
  });
  return root;
}

describe("MindElixirView Part B canvas controls", () => {
  it("removes the obsolete centered generate CTA", async () => {
    const onRegenerate = vi.fn();
    await renderView(onRegenerate);
    expect(container.querySelector(".mm-generate-cta")).toBeNull();
    expect(onRegenerate).not.toHaveBeenCalled();
  });

  it("keeps fullscreen separate from the main toolbar", async () => {
    await renderView(vi.fn());
    const toolbar = container.querySelector(".mm-floating-toolbar");
    const corner = container.querySelector(".mm-fullscreen-corner");
    expect(toolbar).toBeTruthy();
    expect(corner).toBeTruthy();
    expect(toolbar.contains(corner)).toBe(false);
  });

  it("uses the real map list and keeps the source drawer closed by default", async () => {
    const onSelectMap = vi.fn();
    const onCreateNew = vi.fn();
    await renderView(vi.fn(), { data: { onSelectMap, onCreateNew } });
    expect(container.querySelector(".mm-context-row")).toBeTruthy();
    expect(container.querySelectorAll(".mm-context-row")).toHaveLength(1);
    expect(container.querySelectorAll(".mm-overflow-trigger")).toHaveLength(1);
    expect(container.querySelector(".mm-map-selector__menu")).toBeNull();
    await act(async () => { container.querySelector(".mm-map-selector__trigger").click(); });
    expect(container.querySelectorAll(".mm-map-selector__item")).toHaveLength(1);
    expect(container.querySelector(".mm-map-selector__item").textContent).toContain("Test Map");
    await act(async () => { container.querySelector(".mm-map-selector__item").click(); });
    expect(onSelectMap).toHaveBeenCalledWith(DATA.mindMaps[0]);
    await act(async () => { container.querySelector(".mm-map-selector__trigger").click(); });
    await act(async () => { container.querySelector(".mm-map-selector__new").click(); });
    expect(onCreateNew).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".mm-inspector-drawer")).toBeNull();
  });

  it("mounts the Inspector as a closed canvas overlay", async () => {
    await renderView(vi.fn(), {
      inspectorProps: {
        node: null, relations: { parent: null, children: [], prev: null, next: null, siblings: [] },
        breadcrumb: [], documentTitle: "", sources: [], generating: false,
        onNavigate: vi.fn(), onAskAI: vi.fn(), onOpenSource: vi.fn(),
        nav: { canBack: false, canForward: false, onBack: vi.fn(), onForward: vi.fn(), pinned: [], recent: [], isPinned: false, onTogglePin: vi.fn() },
      },
    });
    const drawer = container.querySelector(".mm-inspector-drawer");
    expect(drawer).toBeTruthy();
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    await act(async () => { container.querySelector(".mm-inspector-tab").click(); });
    expect(drawer.classList.contains("is-open")).toBe(true);
    expect(drawer.querySelector("button[aria-label='Đóng bảng kiểm tra']")).toBeTruthy();
  });
});
