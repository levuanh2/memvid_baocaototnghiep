// @vitest-environment jsdom
// Who may publish the summary list (merge of #164 and #165). A /summaries answer is published
// only when the panel that asked is still mounted AND no newer request has started since.
// The harness is the one from SidebarRight.orphanPoller.test.jsx.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SidebarRight from "./SidebarRight";
import { StudyContextProvider } from "../../study/StudyContextProvider";
import { apiFetch, generateMindmap } from "../../utils/api";

const pollerSpies = vi.hoisted(() => ({
  mindmapStart: vi.fn(),
  summaryStart: vi.fn(),
}));

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path) => {
    if (path === "/mindmaps") return { ok: true, json: async () => ({ mindmaps: [] }) };
    if (path === "/summaries") return { ok: true, json: async () => ({ summaries: [] }) };
    return { ok: true, json: async () => ({}) };
  }),
  generateMindmap: vi.fn(),
  generateSummary: vi.fn(),
  cancelMindmap: vi.fn(),
  cancelSummary: vi.fn(),
  getMindmapCapability: vi.fn(async () => ({ guided_mindmap_v3: false })),
  isUnauthorizedError: vi.fn(() => false),
  isNotFoundOrForbiddenError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((error) => String(error)),
}));

vi.mock("../../utils/mindmapJob", () => ({
  createMindmapPoller: vi.fn(() => ({ start: pollerSpies.mindmapStart, stop: vi.fn() })),
  stageLabel: vi.fn(() => "Đang tạo sơ đồ…"),
}));

vi.mock("../../utils/summaryJob", () => ({
  createSummaryPoller: vi.fn(() => ({ start: pollerSpies.summaryStart, stop: vi.fn() })),
  stageLabel: vi.fn(() => "Đang tóm tắt…"),
  LENGTH_MODES: [{ value: "medium", label: "Vừa" }],
  SUMMARY_MODES: [{ value: "standard", label: "Chuẩn" }],
}));

vi.mock("../ui/Toaster", () => ({ toast: vi.fn() }));

const flush = () => act(async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
});

let container;
let root;
let mindmapLibrary;
let summaryLibrary;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.clearAllMocks();
  mindmapLibrary = null;
  summaryLibrary = null;
});

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  if (container) {
    document.body.removeChild(container);
    container = null;
  }
  localStorage.clear();
});

async function mountSidebar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <StudyContextProvider>
        <SidebarRight
          selectedSources={["doc-1"]}
          evidence={null}
          onMindmapDataChange={vi.fn()}
          onSummaryDataChange={vi.fn()}
          onSwitchToChat={vi.fn()}
          onMindmapLibraryChange={(value) => { mindmapLibrary = value; }}
          onSummaryLibraryChange={(value) => { summaryLibrary = value; }}
        />
      </StudyContextProvider>,
    );
  });
  await flush();
}

// Every GET /summaries stays pending until the test settles it, in call order.
let summaryRequests;
function holdSummaryRequests() {
  summaryRequests = [];
  apiFetch.mockImplementation((path) => {
    if (path === "/summaries") return new Promise((resolve, reject) => { summaryRequests.push({ resolve, reject }); });
    if (path === "/mindmaps") return Promise.resolve({ ok: true, json: async () => ({ mindmaps: [] }) });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}
const ok = (...ids) => ({ ok: true, json: async () => ({ summaries: ids.map((id) => ({ id, title: id })) }) });
const failed = () => ({ ok: false, status: 500, json: async () => ({}) });
const ids = () => (summaryLibrary?.summaries || []).map((item) => item.id);

describe("SidebarRight: who may publish the summary list", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); holdSummaryRequests(); });

  it("1. request A answering after request B does not replace B's list", async () => {
    await mountSidebar();                                   // A
    await act(async () => { summaryLibrary.actions.retryLoad(); });   // B
    expect(summaryRequests).toHaveLength(2);
    await act(async () => { summaryRequests[1].resolve(ok("from-B")); });
    await flush();
    await act(async () => { summaryRequests[0].resolve(ok("from-A")); });
    await flush();
    expect(ids()).toEqual(["from-B"]);
    expect(summaryLibrary.initialLoading).toBe(false);
  });

  it("2. the panel unmounting during request A publishes nothing afterwards", async () => {
    await mountSidebar();
    const before = summaryLibrary;
    await act(async () => root.unmount());
    root = null;
    await act(async () => { summaryRequests[0].resolve(failed()); });
    await flush();
    // Nothing published, and the dead panel does not even report the failure.
    expect(summaryLibrary).toBe(before);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("3. A failing after B succeeded leaves B's list and no error", async () => {
    await mountSidebar();
    await act(async () => { summaryLibrary.actions.retryLoad(); });
    await act(async () => { summaryRequests[1].resolve(ok("from-B")); });
    await flush();
    await act(async () => { summaryRequests[0].resolve(failed()); });
    await flush();
    expect(ids()).toEqual(["from-B"]);
    expect(summaryLibrary.loadError).toBeNull();
    expect(summaryLibrary.initialLoading).toBe(false);
  });

  it("4. a retry started while the previous request is pending shows loading until the retry itself answers", async () => {
    await mountSidebar();
    await act(async () => { summaryRequests[0].resolve(failed()); });
    await flush();
    expect(summaryLibrary.loadError).toBeTruthy();

    await act(async () => { summaryLibrary.actions.retryLoad(); });   // R1
    expect(summaryLibrary.loadError).toBeNull();
    expect(summaryLibrary.initialLoading).toBe(true);
    await act(async () => { summaryLibrary.actions.retryLoad(); });   // R2, R1 still pending
    await act(async () => { summaryRequests[1].resolve(failed()); }); // R1 answers first, stale
    await flush();
    expect(summaryLibrary.loadError).toBeNull();
    expect(summaryLibrary.initialLoading).toBe(true);

    await act(async () => { summaryRequests[2].resolve(ok("from-R2")); });
    await flush();
    expect(ids()).toEqual(["from-R2"]);
    expect(summaryLibrary.initialLoading).toBe(false);
  });

  it("the mind-map list follows the same rule: a slow mount-time list cannot hide a map that finished since (bug hunt #13)", async () => {
    const mindmapRequests = [];
    apiFetch.mockImplementation((path) => {
      if (path === "/mindmaps") return new Promise((resolve) => { mindmapRequests.push({ resolve }); });
      return Promise.resolve({ ok: true, json: async () => ({ summaries: [] }) });
    });
    generateMindmap.mockResolvedValue({ status: "done", result: { id: "new-map", title: "Mới", nodes: [{ id: "root", title: "Root" }] } });
    await mountSidebar();                                   // list request 0, pending
    await act(async () => { mindmapLibrary.actions.create(); });
    await flush();
    expect(mindmapRequests).toHaveLength(2);                // the finished map refreshed the list
    await act(async () => { mindmapRequests[1].resolve({ ok: true, json: async () => ({ mindmaps: [{ id: "new-map", title: "Mới" }] }) }); });
    await flush();
    await act(async () => { mindmapRequests[0].resolve({ ok: true, json: async () => ({ mindmaps: [] }) }); });
    await flush();
    expect((mindmapLibrary.mindMaps || []).map((m) => m.id)).toContain("new-map");
  });

  // 5. "a generation job answers after the panel closes" is covered by
  //    SidebarRight.orphanPoller.test.jsx (queued and cache-hit, mind map and summary).

  it("6. a remount (panel closed and reopened, breakpoint crossed) keeps its own list; the old panel's late answer is ignored", async () => {
    await mountSidebar();                                   // old panel, request 0 pending
    await act(async () => root.unmount());
    document.body.removeChild(container);
    await mountSidebar();                                   // new panel, request 1
    expect(summaryRequests).toHaveLength(2);
    expect(summaryLibrary.initialLoading).toBe(true);
    await act(async () => { summaryRequests[1].resolve(ok("new-panel")); });
    await flush();
    await act(async () => { summaryRequests[0].resolve(ok("old-panel")); });
    await flush();
    expect(ids()).toEqual(["new-panel"]);
    expect(summaryLibrary.loadError).toBeNull();
    expect(summaryLibrary.initialLoading).toBe(false);
  });
});
