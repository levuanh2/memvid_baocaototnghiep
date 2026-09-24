// @vitest-environment jsdom
//
// Regression for the "intermittent no map" bug: `showModalMap` defaulted to
// null and only ever became truthy via an explicit library click or a
// resumed job's own completion handler. A user with existing completed maps
// and no running job saw "Chưa có sơ đồ" on every fresh /app load even
// though `mindMaps` (the library, from GET /mindmaps) was already fully
// populated — because nothing ever auto-opened one.
//
// Fix: once mindMaps resolves with no active job pending, auto-select the
// most recent map (backend already orders by created_at DESC) and tag it
// `__restoredOnLoad` so MainLayout's own "jump to a newly-populated tab"
// effect (meant for a fresh generation) does not also fire for a plain
// page-load restore.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarRight from "./SidebarRight";
import { StudyContextProvider } from "../../study/StudyContextProvider";

const noop = () => {};

const SAVED_MAP = {
  id: "map-1", title: "Sơ đồ gần nhất", nodes: [{ id: "n0", title: "root" }],
  sources: ["mota_sanpham"], createdAt: new Date().toISOString(),
};

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path) => {
    if (path === "/mindmaps") return { ok: true, json: async () => ({ mindmaps: [SAVED_MAP] }) };
    if (path === "/summaries") return { ok: true, json: async () => ({ summaries: [] }) };
    return { ok: true, json: async () => ({}) };
  }),
  generateMindmap: vi.fn(), cancelMindmap: vi.fn(), generateSummary: vi.fn(), cancelSummary: vi.fn(),
  getMindmapCapability: vi.fn(async () => ({ guided_mindmap_v3: true })),
  isUnauthorizedError: vi.fn(() => false), isNotFoundOrForbiddenError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((e) => String(e)),
}));

let container;

afterEach(() => {
  if (container) {
    document.body.removeChild(container);
    container = null;
  }
  localStorage.clear();
  vi.restoreAllMocks();
});

async function mount(props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <StudyContextProvider>
        <SidebarRight
          selectedSources={[]} evidence={null} onSummaryDataChange={noop} onSwitchToChat={noop}
          {...props}
        />
      </StudyContextProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

describe("SidebarRight auto-selects the most recent map on load", () => {
  it("forwards the most recent map with __restoredOnLoad when no job is active", async () => {
    const onMindmapDataChange = vi.fn();
    await mount({ onMindmapDataChange });

    const calls = onMindmapDataChange.mock.calls.filter((c) => c[0]?.data);
    expect(calls.length).toBeGreaterThan(0);
    const lastData = calls[calls.length - 1][0].data;
    expect(lastData.id).toBe(SAVED_MAP.id);
    expect(lastData.__restoredOnLoad).toBe(true);
  });

  it("does not auto-select while a generation job is still active in localStorage", async () => {
    localStorage.setItem("mindmap_active_job", JSON.stringify({
      jobId: "job-mid-flight", sources: ["mota_sanpham"], startedAt: Date.now(),
    }));
    const onMindmapDataChange = vi.fn();
    await mount({ onMindmapDataChange });

    const restoredCalls = onMindmapDataChange.mock.calls.filter((c) => c[0]?.data?.__restoredOnLoad);
    expect(restoredCalls.length).toBe(0);
  });
});
