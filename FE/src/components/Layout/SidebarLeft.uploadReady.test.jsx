// @vitest-environment jsdom
// W1-4: SidebarLeft registers a trigger for its own hidden upload input via
// `onUploadReady`, so a centre empty state (ChatArea/WorkspaceEmptyState,
// neither of which owns a file input) can open the SAME input SidebarLeft's
// own "Thêm tài liệu" uses, instead of a duplicate upload POST elsewhere.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarLeft from "./SidebarLeft";

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({ sources: [] }) })),
  _appError: vi.fn(),
  isUnauthorizedError: vi.fn(() => false),
  isNotFoundOrForbiddenError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((error) => String(error)),
}));

let container, root;
afterEach(() => {
  if (root) { act(() => { root.unmount(); }); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
});

async function render(onUploadReady) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SidebarLeft selectedSources={[]} setSelectedSources={vi.fn()} onSourcesChange={vi.fn()} onClose={vi.fn()} onUploadReady={onUploadReady} />,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

describe("SidebarLeft upload-trigger registration", () => {
  it("registers a function that opens its own hidden file input exactly once until settlement", async () => {
    const onUploadReady = vi.fn();
    await render(onUploadReady);
    expect(onUploadReady).toHaveBeenCalledTimes(1);
    const trigger = onUploadReady.mock.calls[0][0];
    expect(typeof trigger).toBe("function");

    const input = container.querySelector('input[type="file"]');
    const clickSpy = vi.spyOn(input, "click");
    trigger();
    trigger();
    expect(clickSpy).toHaveBeenCalledTimes(1);

    input.dispatchEvent(new Event("cancel", { bubbles: true }));
    trigger();
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });

  it("clears the registered trigger before its file input unmounts", async () => {
    const onUploadReady = vi.fn();
    await render(onUploadReady);
    await act(async () => { root.unmount(); });
    root = null;
    expect(onUploadReady).toHaveBeenLastCalledWith(null);
  });
});
