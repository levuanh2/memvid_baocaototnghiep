// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixir from "mind-elixir";
import MindElixirView from "./MindElixirView";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

const DATA = {
  id: "lifecycle-map", title: "Lifecycle map", schema_version: 3,
  nodes: [
    { id: "root", kind: "root", title: "Root", parent: null },
    { id: "branch", kind: "section", title: "Branch", parent: "root" },
    { id: "child", kind: "idea", title: "Child", parent: "branch" },
    { id: "grandchild", kind: "detail", title: "Grandchild", parent: "child" },
  ],
  relations: [], sources: [],
};

let host;
let root;

function controller() {
  return { registerMindInstance: vi.fn(), onNodeSelected: vi.fn(), selected: null, sidecarRef: { current: new Map() } };
}

async function renderView() {
  const originalLinkDiv = MindElixir.prototype.linkDiv;
  vi.spyOn(MindElixir.prototype, "linkDiv").mockImplementation(function (...args) {
    const result = originalLinkDiv.apply(this, args);
    this.container.querySelectorAll(".lines path, .subLines path").forEach((path) => path.setAttribute("d", "M 10 10 L 20 20"));
    return result;
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const ctrl = controller();
  await act(async () => {
    root.render(<MindElixirView data={DATA} onRegenerate={vi.fn()} regenerating={false} controller={ctrl} />);
  });
  const canvas = host.querySelector(".me-container");
  Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 600 });
  return { canvas, mind: ctrl.registerMindInstance.mock.calls.at(-1)?.[0] };
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (host) host.remove();
  root = null;
  host = null;
  document.documentElement.classList.remove("dark");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MindElixir render lifecycle", () => {
  it("exposes a finite ready state and gates the canvas behind a lifecycle overlay", async () => {
    await renderView();
    await vi.waitFor(() => expect(host.querySelector('[data-mindmap-render-state="ready"]')).toBeTruthy(), { timeout: 3000 });
    expect(host.querySelector('[data-testid="mindmap-render-overlay"]')).toBeNull();
  });

  it("re-links and validates connectors after every theme change without recentering", async () => {
    const { mind } = await renderView();
    await vi.waitFor(() => expect(host.querySelector('[data-mindmap-render-state="ready"]')).toBeTruthy(), { timeout: 3000 });
    const changeTheme = vi.spyOn(mind, "changeTheme");
    const layout = vi.spyOn(mind, "layout");
    const linkDiv = vi.spyOn(mind, "linkDiv");
    const toCenter = vi.spyOn(mind, "toCenter");
    for (let i = 0; i < 10; i += 1) {
      await act(async () => { document.documentElement.classList.toggle("dark"); });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(changeTheme).toHaveBeenCalledTimes(10);
    expect(layout.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(linkDiv.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(toCenter).not.toHaveBeenCalled();
  });

  it("re-renders DOM descendants when expanding only to a requested depth", async () => {
    await renderView();
    await vi.waitFor(() => expect(host.querySelector('[data-mindmap-render-state="ready"]')).toBeTruthy(), { timeout: 3000 });
    await act(async () => { host.querySelector(".mm-overflow-trigger").click(); });
    const depthAction = [...document.body.querySelectorAll('[role="menuitem"]')]
      .find((item) => item.textContent.includes("Mở đến cấp 2"));
    await act(async () => { depthAction.click(); });
    expect(host.querySelector('[data-nodeid="megrandchild"]')).toBeNull();
    expect(host.querySelector('[data-nodeid="mechild"]')).toBeTruthy();
  });

  it("moves to an actionable error instead of polling forever when geometry never settles", async () => {
    vi.useFakeTimers();
    await act(async () => {
      host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
      root.render(<MindElixirView data={DATA} onRegenerate={vi.fn()} regenerating={false} controller={controller()} />);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(host.querySelector('[data-mindmap-render-state="error"]')).toBeTruthy();
    expect(host.querySelector('button[data-action="retry-mindmap-render"]')).toBeTruthy();
  });
});
