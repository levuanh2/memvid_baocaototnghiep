// @vitest-environment jsdom
//
// Regression for the round-6 live-QA finding: clicking a source's checkbox
// visibly did nothing. Root cause: for a checkbox, React's onChange fires off
// the native "click" event too — so a single click bubbled to the row's own
// onClick handler as well, calling toggleSelect a SECOND time and cancelling
// the first out. Fixed with onClick={(e) => e.stopPropagation()} on the
// checkbox itself in SidebarLeft.jsx, next to its existing onChange.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarLeft from "./SidebarLeft";

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path) => {
    if (path === "/list-indexed") {
      return {
        ok: true,
        json: async () => ({
          sources: [
            { source_id: "s1", filename: "MoTa_SanPham.txt", video_stem: "mota_sanpham", status: "ready", can_query: true, num_chunks: 3 },
          ],
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  }),
  _appError: vi.fn(),
  isUnauthorizedError: vi.fn(() => false),
  isNotFoundOrForbiddenError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((e) => String(e)),
}));

let container;

afterEach(() => {
  if (container) {
    document.body.removeChild(container);
    container = null;
  }
  vi.restoreAllMocks();
});

async function renderSidebar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let currentSelected = [];
  const setSelectedSources = vi.fn((updater) => {
    currentSelected = typeof updater === "function" ? updater(currentSelected) : updater;
  });
  await act(async () => {
    root.render(
      <SidebarLeft selectedSources={currentSelected} setSelectedSources={setSelectedSources} onSourcesChange={() => {}} onClose={() => {}} />
    );
  });
  // Let the mount-time /list-indexed fetch (and its own setSelectedSources
  // reconciliation call) settle before the test starts counting clicks.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  setSelectedSources.mockClear();
  return { setSelectedSources };
}

describe("SidebarLeft source checkbox", () => {
  it("selects the source with a single native click (no double-toggle cancel-out)", async () => {
    const { setSelectedSources } = await renderSidebar();

    const checkbox = container.querySelector('input[type="checkbox"]:not([disabled])');
    expect(checkbox).toBeTruthy();

    await act(async () => {
      checkbox.click();
    });

    // A single click must run the selection update exactly once. Before the
    // fix this was 2 (onChange + the row's onClick), which cancelled out to
    // a net no-op selection.
    expect(setSelectedSources).toHaveBeenCalledTimes(1);
    const updater = setSelectedSources.mock.calls[0][0];
    expect(updater([])).toEqual(["mota_sanpham"]);
  });
});
