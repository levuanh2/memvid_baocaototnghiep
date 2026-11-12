// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SidebarRight from "./SidebarRight";
import { StudyContextProvider } from "../../study/StudyContextProvider";
import { apiFetch, generateMindmap, generateSummary } from "../../utils/api";
import { createMindmapPoller } from "../../utils/mindmapJob";
import { createSummaryPoller } from "../../utils/summaryJob";
import { toast } from "../ui/Toaster";
import { loadActiveMindmapJob, saveActiveMindmapJob } from "../../utils/activeMindmapJob";
import { loadActiveSummaryJob } from "../../utils/activeSummaryJob";

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

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

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

async function unmountThenResolve(request, value) {
  await act(async () => root.unmount());
  root = null;
  request.resolve(value);
  await flush();
}

describe("SidebarRight generation ownership", () => {
  it("does not start a mind-map poller when the start response arrives after unmount", async () => {
    const request = deferred();
    generateMindmap.mockReturnValue(request.promise);
    await mountSidebar();

    await act(async () => { mindmapLibrary.actions.create(); });
    expect(generateMindmap).toHaveBeenCalledOnce();
    await unmountThenResolve(request, { status: "queued", job_id: "map-job" });

    expect(createMindmapPoller).not.toHaveBeenCalled();
    expect(pollerSpies.mindmapStart).not.toHaveBeenCalled();
    // The server queued it, so the next visit must still be able to resume it.
    expect(loadActiveMindmapJob()?.jobId).toBe("map-job");
  });

  it("a late start response does not replace a job a newer panel has stored", async () => {
    const request = deferred();
    generateMindmap.mockReturnValue(request.promise);
    await mountSidebar();
    await act(async () => { mindmapLibrary.actions.create(); });
    await act(async () => root.unmount());
    root = null;
    saveActiveMindmapJob({ jobId: "newer-job", sources: ["a"], startedAt: Date.now() });
    request.resolve({ status: "queued", job_id: "map-job" });
    await flush();
    expect(loadActiveMindmapJob()?.jobId).toBe("newer-job");
  });

  it("does not run mind-map cache-hit completion after unmount", async () => {
    const request = deferred();
    generateMindmap.mockReturnValue(request.promise);
    await mountSidebar();
    apiFetch.mockClear();
    toast.mockClear();

    await act(async () => { mindmapLibrary.actions.create(); });
    await unmountThenResolve(request, {
      status: "done",
      result: { id: "cached-map", nodes: [{ id: "root", title: "Root" }] },
    });

    expect(apiFetch).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("does not start a summary poller when the start response arrives after unmount", async () => {
    const request = deferred();
    generateSummary.mockReturnValue(request.promise);
    await mountSidebar();

    await act(async () => { summaryLibrary.actions.create(); });
    expect(generateSummary).toHaveBeenCalledOnce();
    await unmountThenResolve(request, { status: "queued", job_id: "summary-job" });

    expect(createSummaryPoller).not.toHaveBeenCalled();
    expect(pollerSpies.summaryStart).not.toHaveBeenCalled();
    expect(loadActiveSummaryJob()?.jobId).toBe("summary-job");
  });

  it("does not run summary cache-hit completion after unmount", async () => {
    const request = deferred();
    generateSummary.mockReturnValue(request.promise);
    await mountSidebar();
    apiFetch.mockClear();
    toast.mockClear();

    await act(async () => { summaryLibrary.actions.create(); });
    await unmountThenResolve(request, {
      status: "done",
      result: { id: "cached-summary", title: "Cached summary" },
    });

    expect(apiFetch).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
