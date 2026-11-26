// @vitest-environment jsdom
//
// `/list-indexed` responses must not publish after the panel unmounted, and an older request must
// not overwrite a newer one. Found in review of #160: a response landing after a collapse told
// the layout "the list has loaded" (and reconciled the selection) with no rows committed, so the
// chat could offer "upload your first document" to someone with documents.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarLeft from "./SidebarLeft";

const pending = [];
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  pending.push(resolve);
  return promise;
};
const ok = (sources) => ({ ok: true, json: async () => ({ sources }) });
const failed = () => ({ ok: false, status: 500 });

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path) => (path === "/list-indexed" ? deferred() : { ok: true, json: async () => ({}) })),
  _appError: vi.fn(async () => new Error("list failed")), isUnauthorizedError: vi.fn(() => false),
  isNotFoundOrForbiddenError: vi.fn(() => false), getUserFriendlyApiError: vi.fn(() => "Không tải được danh sách."),
}));

let container;
let root;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

async function mount(props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<SidebarLeft selectedSources={[]} onClose={() => {}} {...props} />);
  });
  await flush();
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  pending.length = 0;
  vi.restoreAllMocks();
});

describe("SidebarLeft ignores list responses it no longer owns", () => {
  it("a response that lands after unmount reports nothing to the layout", async () => {
    const props = { setSelectedSources: vi.fn(), onSourcesChange: vi.fn(), onSourcesSettled: vi.fn() };
    await mount(props);
    expect(pending.length).toBe(1);

    act(() => root.unmount());
    root = null;
    await act(async () => { pending[0](ok([{ video: "a", video_stem: "a", filename: "A.pdf", num_chunks: 3 }])); });
    await flush();

    expect(props.onSourcesSettled).not.toHaveBeenCalled();
    expect(props.setSelectedSources).not.toHaveBeenCalled();
    expect(props.onSourcesChange).not.toHaveBeenCalled();
  });

  it("retry is visibly pending: the error gives way to the loading state, then to the list", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const props = { setSelectedSources: vi.fn(), onSourcesChange: vi.fn(), onSourcesSettled: vi.fn() };
    await mount(props);
    await act(async () => { pending[0](failed()); });
    await flush();
    expect(props.onSourcesSettled).toHaveBeenLastCalledWith(false);
    const retry = () => [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Thử lại");
    await act(async () => { retry().click(); });

    // While the retry is in flight there is no second "Thử lại" to press and no "empty" claim.
    expect(retry()).toBeUndefined();
    expect(container.textContent).toContain("Đang tải danh sách tài liệu");
    expect(container.textContent).not.toContain("Chưa có tài liệu nào.");
    expect(pending.length).toBe(2);

    await act(async () => { pending[1](ok([{ video: "a", video_stem: "a", filename: "A.pdf", num_chunks: 3 }])); });
    await flush();
    expect(props.onSourcesSettled).toHaveBeenLastCalledWith(true);
    expect(container.textContent).not.toContain("Đang tải danh sách tài liệu");
  });
});
