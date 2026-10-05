// @vitest-environment jsdom
//
// Create-action state machine for "Tạo sơ đồ mới" while GET /mindmaps/capability
// is in flight. Capability is server-authoritative:
//   - unknown/loading: park ONE create intent, open nothing, start nothing.
//   - enabled: open Guided once.
//   - disabled / error: run the legacy V2 path once (error keeps fail-closed).
// Regression for the optimistic open, where a pending click opened Guided
// before the server confirmed it, and the earlier bug, where a pending click
// ran the legacy generator.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarRight from "./SidebarRight";
import { StudyContextProvider } from "../../study/StudyContextProvider";
import { generateMindmap, getMindmapCapability } from "../../utils/api";
import { toast } from "../ui/Toaster";

const noop = () => {};
const VALIDATION = "Vui lòng chọn ít nhất một tài liệu để tạo Sơ đồ!";

function Harness({ selectedSources, onMindmapLibraryChange }) {
  return (
    <StudyContextProvider>
      <SidebarRight
        selectedSources={selectedSources} evidence={null} onMindmapDataChange={noop}
        onMindmapLibraryChange={onMindmapLibraryChange}
        onSummaryDataChange={noop} onSwitchToChat={noop}
      />
    </StudyContextProvider>
  );
}

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path) => {
    if (path === "/mindmaps") return { ok: true, json: async () => ({ mindmaps: [] }) };
    if (path === "/summaries") return { ok: true, json: async () => ({ summaries: [] }) };
    return { ok: true, json: async () => ({}) };
  }),
  generateMindmap: vi.fn(),
  suggestMindmapTopics: vi.fn(async () => ({ suggestions: [] })),
  cancelMindmap: vi.fn(), generateSummary: vi.fn(), cancelSummary: vi.fn(),
  getMindmapCapability: vi.fn(),
  isUnauthorizedError: vi.fn(() => false), isNotFoundOrForbiddenError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((e) => String(e)),
}));
vi.mock("../ui/Toaster", () => ({ toast: vi.fn() }));

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let container;
let root;

beforeEach(() => {
  generateMindmap.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  localStorage.clear();
  generateMindmap.mockReset();
  getMindmapCapability.mockReset();
  toast.mockClear();
  vi.restoreAllMocks();
});

async function mount({ selectedSources = ["doc-1"] } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const seen = {};
  await act(async () => {
    root.render(
      <Harness
        selectedSources={selectedSources}
        onMindmapLibraryChange={(value) => { seen.actions = value.actions; }}
      />
    );
  });
  return seen;
}

const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
const click = (seen) => act(async () => { seen.actions.create(); });
const dialogCount = () => document.body.querySelectorAll('[role="dialog"]').length;
const validationToasts = () => toast.mock.calls.filter(([msg]) => String(msg).includes(VALIDATION)).length;

describe("Guided create-action state machine", () => {
  it("1. pending + click: no Guided, no legacy call, no POST, loading state visible", async () => {
    const cap = deferred();
    getMindmapCapability.mockReturnValue(cap.promise);
    const seen = await mount();

    await click(seen);

    expect(dialogCount()).toBe(0);
    expect(generateMindmap).not.toHaveBeenCalled();
    expect(seen.actions.createPending).toBe(true);
  });

  it("2. pending -> true: Guided opens exactly once, no legacy call, no POST", async () => {
    const cap = deferred();
    getMindmapCapability.mockReturnValue(cap.promise);
    const seen = await mount();
    await click(seen);

    cap.resolve({ guided_mindmap_v3: true });
    await flush();

    expect(dialogCount()).toBe(1);
    expect(generateMindmap).not.toHaveBeenCalled();
    expect(seen.actions.createPending).toBe(false);
  });

  it("3. pending -> false: Guided never opens, legacy flow runs exactly once", async () => {
    const cap = deferred();
    getMindmapCapability.mockReturnValue(cap.promise);
    const seen = await mount();
    await click(seen);

    cap.resolve({ guided_mindmap_v3: false });
    await flush();

    expect(dialogCount()).toBe(0);
    expect(generateMindmap).toHaveBeenCalledTimes(1);
    expect(seen.actions.createPending).toBe(false);
  });

  it("4. pending -> request error: Guided never opens, fail-closed legacy fallback runs once", async () => {
    const cap = deferred();
    getMindmapCapability.mockReturnValue(cap.promise);
    const seen = await mount();
    await click(seen);

    cap.reject(new Error("boom"));
    await flush();

    expect(dialogCount()).toBe(0);
    expect(generateMindmap).toHaveBeenCalledTimes(1);
  });

  it("5. rapid click x3 while pending: one capability request, one eventual action", async () => {
    const cap = deferred();
    getMindmapCapability.mockReturnValue(cap.promise);
    const seen = await mount();

    await act(async () => { seen.actions.create(); seen.actions.create(); seen.actions.create(); });
    expect(getMindmapCapability).toHaveBeenCalledTimes(1);

    cap.resolve({ guided_mindmap_v3: true });
    await flush();

    expect(dialogCount()).toBe(1);
    expect(generateMindmap).not.toHaveBeenCalled();
  });

  it("6. already enabled: Guided opens immediately, nothing parked", async () => {
    getMindmapCapability.mockResolvedValue({ guided_mindmap_v3: true });
    const seen = await mount();
    await flush();

    await click(seen);

    expect(dialogCount()).toBe(1);
    expect(seen.actions.createPending).toBe(false);
    expect(generateMindmap).not.toHaveBeenCalled();
  });

  it("7. already disabled: legacy path immediately, Guided never mounted", async () => {
    getMindmapCapability.mockResolvedValue({ guided_mindmap_v3: false });
    const seen = await mount();
    await flush();

    await click(seen);

    expect(dialogCount()).toBe(0);
    expect(generateMindmap).toHaveBeenCalledTimes(1);
  });

  it("8. non-QA / global-OFF: Guided content is never mounted, even transiently", async () => {
    const cap = deferred();
    getMindmapCapability.mockReturnValue(cap.promise);
    const mounted = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1 && (node.matches?.('[role="dialog"]') || node.querySelector?.('[role="dialog"]'))) mounted.push(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const seen = await mount();
    await click(seen);
    cap.resolve({ guided_mindmap_v3: false });
    await flush();
    await click(seen);
    await flush();
    observer.takeRecords().forEach((record) => {
      for (const node of record.addedNodes) {
        if (node.nodeType === 1 && (node.matches?.('[role="dialog"]') || node.querySelector?.('[role="dialog"]'))) mounted.push(node);
      }
    });
    observer.disconnect();

    expect(mounted).toHaveLength(0);
    expect(dialogCount()).toBe(0);
  });

  it("9. unmount while pending: no delayed Guided, no state-update warning", async () => {
    const cap = deferred();
    getMindmapCapability.mockReturnValue(cap.promise);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen = await mount();
    await click(seen);

    act(() => root.unmount());
    root = null;
    cap.resolve({ guided_mindmap_v3: true });
    await flush();

    expect(dialogCount()).toBe(0);
    expect(generateMindmap).not.toHaveBeenCalled();
    const warnings = errorSpy.mock.calls.filter((args) => /unmounted|not wrapped in act|state update/i.test(String(args[0])));
    expect(warnings).toHaveLength(0);
  });

  it("10a. pending does not show the source-validation toast", async () => {
    const cap = deferred();
    getMindmapCapability.mockReturnValue(cap.promise);
    const seen = await mount({ selectedSources: [] });

    await click(seen);

    expect(validationToasts()).toBe(0);
  });

  it("10b. disabled with no sources keeps the existing validation toast, once", async () => {
    const cap = deferred();
    getMindmapCapability.mockReturnValue(cap.promise);
    const seen = await mount({ selectedSources: [] });
    await click(seen);

    cap.resolve({ guided_mindmap_v3: false });
    await flush();

    expect(validationToasts()).toBe(1);
    expect(generateMindmap).not.toHaveBeenCalled();
  });
});
