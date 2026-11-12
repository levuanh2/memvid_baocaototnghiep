// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarLeft from "./SidebarLeft";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  nhoNguon: vi.fn(),
  quenNguon: vi.fn(),
  taoBoTheoDoiNguon: vi.fn(),
}));

vi.mock("../../utils/api", () => ({
  apiFetch: (...args) => mocks.apiFetch(...args),
  _appError: vi.fn(async () => new Error("HTTP error")),
  isUnauthorizedError: vi.fn(() => false),
  isNotFoundOrForbiddenError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((error) => String(error)),
}));

vi.mock("../../utils/nguonDangXuLy", () => ({
  nguonConDangXuLy: vi.fn(() => []),
  nhoNguon: (...args) => mocks.nhoNguon(...args),
  quenNguon: (...args) => mocks.quenNguon(...args),
}));

vi.mock("../../utils/theoDoiNguon", () => ({
  taoBoTheoDoiNguon: (...args) => mocks.taoBoTheoDoiNguon(...args),
}));

let container;
let root;

const flush = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

async function mountSidebar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SidebarLeft
        selectedSources={[]}
        setSelectedSources={vi.fn()}
        onSourcesChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
  });
  await flush();
}

async function chooseFile() {
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["content"], "late.pdf", { type: "application/pdf" })],
  });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
}

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.nhoNguon.mockReset();
  mocks.quenNguon.mockReset();
  mocks.taoBoTheoDoiNguon.mockReset();
  mocks.apiFetch.mockImplementation(async (path) => {
    if (path === "/list-indexed") return { ok: true, json: async () => ({ sources: [] }) };
    return { ok: true, json: async () => ({}) };
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

describe("SidebarLeft late upload lifecycle", () => {
  it("does not create a source poller when upload completes after unmount", async () => {
    let finishUpload;
    const upload = new Promise((resolve) => { finishUpload = resolve; });
    mocks.apiFetch.mockImplementation((path) => {
      if (path === "/list-indexed") return Promise.resolve({ ok: true, json: async () => ({ sources: [] }) });
      if (path === "/upload") return upload;
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    mocks.taoBoTheoDoiNguon.mockReturnValue({ start: vi.fn(), stop: vi.fn() });

    await mountSidebar();
    await chooseFile();
    expect(mocks.apiFetch).toHaveBeenCalledWith("/upload", expect.any(Object));

    await act(async () => { root.unmount(); });
    root = null;
    await act(async () => {
      finishUpload({
        ok: true,
        json: async () => ({ source_id: "late-source", status: "processing" }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // No poller from the dead panel, but the accepted upload is remembered for the next
    // mount: without that the document vanishes until it finishes and reads as a failed upload.
    expect(mocks.taoBoTheoDoiNguon).not.toHaveBeenCalled();
    expect(mocks.nhoNguon).toHaveBeenCalledWith(expect.objectContaining({ sourceId: "late-source" }));
  });

  it("clears the 500 ms completion refresh when unmounted", async () => {
    vi.useFakeTimers();
    let pollCallbacks;
    mocks.taoBoTheoDoiNguon.mockImplementation((callbacks) => {
      pollCallbacks = callbacks;
      return { start: vi.fn(), stop: vi.fn() };
    });
    mocks.apiFetch.mockImplementation(async (path) => {
      if (path === "/list-indexed") return { ok: true, json: async () => ({ sources: [] }) };
      if (path === "/upload") {
        return { ok: true, json: async () => ({ source_id: "source-1", status: "processing" }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await mountSidebar();
    await chooseFile();
    await flush();
    expect(pollCallbacks).toBeTruthy();

    await act(async () => { pollCallbacks.onKetThuc({ status: "ready" }); });
    await act(async () => { root.unmount(); });
    root = null;
    await act(async () => { vi.advanceTimersByTime(500); });

    const listCalls = mocks.apiFetch.mock.calls.filter(([path]) => path === "/list-indexed");
    expect(listCalls).toHaveLength(1);
  });
});
