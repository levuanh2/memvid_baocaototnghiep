// @vitest-environment jsdom
//
// P2 fix regression: the Guided generation progress chip / retry banner used
// to live in SidebarRight.jsx behind `legacyInspectorSurfacesEnabled = false`
// (permanently dead in production). Status is now rehomed into
// modalMapData's `generating`/`jobLabel`/`jobError`/`onRetryJob` fields
// (SidebarRight.jsx) and rendered here -- this test only exercises the
// rendering half via plain props, proving it needs no legacy flag at all.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixirView from "./MindElixirView";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
});

const CONTROLLER = { registerMindInstance: vi.fn(), onNodeSelected: vi.fn(), selected: null, sidecarRef: { current: new Map() } };
const BASE_DATA = {
  id: "map-1", title: "Map", schema_version: 3,
  nodes: [{ id: "n0", parent: null, kind: "root", title: "Root", node_type: "concept", chunk_refs: [] }],
  relations: [], sources: [], generator: { degraded: false, missing: [] },
};
let container;

afterEach(() => {
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
});

async function renderView(data) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MindElixirView data={data} onRegenerate={vi.fn()} regenerating={false} controller={CONTROLLER} />);
  });
  return root;
}

describe("MindElixirView — Guided generation status banners", () => {
  it("shows the real pipeline stage label and progress while a new guided generation runs", async () => {
    await renderView({ ...BASE_DATA, generating: true, jobLabel: "Dựng khung xương…", progress: 42 });
    expect(container.textContent).toContain("Dựng khung xương…");
    expect(container.textContent).toContain("(42%)");
  });

  it("falls back to a generic label when no stage label is available yet (submitting)", async () => {
    await renderView({ ...BASE_DATA, generating: true, jobLabel: "" });
    expect(container.textContent).toContain("Đang tạo sơ đồ…");
  });

  it("shows a visible, persistent error with a Retry action on failure", async () => {
    const onRetryJob = vi.fn();
    await renderView({ ...BASE_DATA, generating: false, jobError: "Không tạo được sơ đồ: boom", onRetryJob });
    expect(container.textContent).toContain("Không tạo được sơ đồ: boom");
    const retryBtn = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Thử lại"));
    expect(retryBtn).toBeTruthy();
    await act(async () => retryBtn.click());
    expect(onRetryJob).toHaveBeenCalledTimes(1);
  });

  it("clears the error banner once a new attempt is running (retry started)", async () => {
    await renderView({ ...BASE_DATA, generating: true, jobLabel: "Đang tạo sơ đồ…", jobError: "boom" });
    expect(container.textContent).not.toContain("boom");
  });

  it("shows neither banner once generation completes with no error", async () => {
    await renderView({ ...BASE_DATA, generating: false, jobError: null });
    expect(container.textContent).not.toContain("Đang tạo sơ đồ…");
    expect(container.textContent).not.toContain("Thử lại");
  });
});
