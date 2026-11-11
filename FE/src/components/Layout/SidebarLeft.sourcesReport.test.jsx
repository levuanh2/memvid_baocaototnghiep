// @vitest-environment jsdom
//
// SidebarLeft remounts on every 768px / 1280px crossing. It must not report its mount-time `[]`
// before `/list-indexed` answers (that flashed the chat's "no documents" state), but once it has
// reported a real list it must keep reporting, including a later `[]`.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarLeft from "./SidebarLeft";
import { nhoNguon, quenHetNguon } from "../../utils/nguonDangXuLy";

let listIndexed = () => new Promise(() => {});

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path) => {
    if (path === "/list-indexed") return listIndexed();
    if (path === "/sources/up1/status") return { ok: true, json: async () => ({ status: "processing", progress: 10 }) };
    if (path === "/sources/up1") return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => ({}) };
  }),
  _appError: vi.fn(async () => new Error("list failed")), isUnauthorizedError: vi.fn(() => false),
  isNotFoundOrForbiddenError: vi.fn(() => false), getUserFriendlyApiError: vi.fn((e) => String(e)),
}));

let container;
let root;

async function mount(onSourcesChange) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<SidebarLeft selectedSources={[]} setSelectedSources={() => {}} onSourcesChange={onSourcesChange} onClose={() => {}} />);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  listIndexed = () => new Promise(() => {});
  quenHetNguon();
  vi.restoreAllMocks();
});

describe("SidebarLeft reports its source list to the layout", () => {
  it("does not report the mount-time [] while /list-indexed is pending", async () => {
    const onSourcesChange = vi.fn();
    await mount(onSourcesChange);
    expect(onSourcesChange).not.toHaveBeenCalled();
  });

  it("reports a successful empty list", async () => {
    listIndexed = async () => ({ ok: true, json: async () => ({ sources: [] }) });
    const onSourcesChange = vi.fn();
    await mount(onSourcesChange);
    expect(onSourcesChange).toHaveBeenLastCalledWith([]);
  });

  it("after a failed fetch, deleting the last restored upload still reports []", async () => {
    listIndexed = async () => ({ ok: false, status: 500 });
    nhoNguon({ sourceId: "up1", filename: "Doc.txt" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onSourcesChange = vi.fn();
    await mount(onSourcesChange);
    expect(onSourcesChange.mock.lastCall[0]).toHaveLength(1);

    await act(async () => { container.querySelector('[aria-label="Tuỳ chọn"]').click(); });
    await act(async () => { container.querySelector('[role="menuitem"]').click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(onSourcesChange).toHaveBeenLastCalledWith([]);
  });
});
