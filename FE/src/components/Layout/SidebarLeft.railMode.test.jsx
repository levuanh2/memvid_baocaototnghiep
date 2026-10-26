// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarLeft from "./SidebarLeft";

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async () => ({
    ok: true,
    json: async () => ({
      sources: [
        { source_id: "s1", filename: "Algorithms.pdf", video_stem: "algorithms", status: "ready", can_query: true },
        { source_id: "s2", filename: "Biology.pdf", video_stem: "biology", status: "ready", can_query: true },
      ],
    }),
  })),
  _appError: vi.fn(),
  isUnauthorizedError: vi.fn(() => false),
  isNotFoundOrForbiddenError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((error) => String(error)),
}));

let container;
let root;

afterEach(() => {
  // Phase C Round 3 (Codex2 review): unmount before detaching so effect
  // cleanup (SidebarLeft's status-polling interval teardown) actually runs.
  if (root) { act(() => { root.unmount(); }); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
});

describe("SidebarLeft tablet rail mode", () => {
  it("reuses source selection, upload, count, and expansion controls in the compact rail", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const setSelectedSources = vi.fn();
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <SidebarLeft
          railMode
          selectedSources={["algorithms"]}
          setSelectedSources={setSelectedSources}
          onSourcesChange={() => {}}
          onClose={onClose}
        />
      );
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const rail = container.querySelector('[data-testid="tablet-source-rail"]');
    expect(rail).toBeTruthy();
    expect(rail.querySelectorAll(".source-rail__file")).toHaveLength(2);
    expect(rail.querySelector('[aria-label="2 tài liệu"]')).toBeTruthy();
    expect(rail.querySelector(".source-rail__file.is-selected").getAttribute("aria-pressed")).toBe("true");
    expect(rail.querySelector('button[aria-label="Thêm tài liệu"]')).toBeTruthy();
    expect(rail.querySelector('input[type="file"][multiple]')).toBeTruthy();

    await act(async () => { rail.querySelectorAll(".source-rail__file")[1].click(); });
    expect(setSelectedSources).toHaveBeenCalled();
    const updater = setSelectedSources.mock.calls.at(-1)[0];
    expect(updater(["algorithms"])).toEqual(["algorithms", "biology"]);

    await act(async () => { rail.querySelector('button[aria-label="Mở rộng thư mục nguồn"]').click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
