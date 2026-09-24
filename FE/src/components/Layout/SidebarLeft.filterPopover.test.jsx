// @vitest-environment jsdom
//
// The source-filter popover and the search box are a real, separate piece
// of UI (task 3 of the workspace-v3 visual QA pass) with no prior dedicated
// test — SidebarLeft.checkbox.test.jsx covers only checkbox toggling.
// Verified live via Playwright against production data: open/close via
// trigger, Escape, and outside-click, plus the search box narrowing the
// visible source list. This reproduces that same coverage as a fast unit
// test so it doesn't regress silently.
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
            { source_id: "s2", filename: "Chuong1.2.docx", video_stem: "chuong1_2", status: "ready", can_query: true, num_chunks: 5 },
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
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
});

async function renderSidebar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <SidebarLeft selectedSources={[]} setSelectedSources={() => {}} onSourcesChange={() => {}} onClose={() => {}} />
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("SidebarLeft filter popover", () => {
  it("opens on trigger click and closes on Escape", async () => {
    await renderSidebar();
    const trigger = container.querySelector(".source-filter-trigger");
    await act(async () => { trigger.click(); });
    expect(container.querySelector(".source-filter-popover")).toBeTruthy();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector(".source-filter-popover")).toBeNull();
  });

  it("closes on outside click", async () => {
    await renderSidebar();
    const trigger = container.querySelector(".source-filter-trigger");
    await act(async () => { trigger.click(); });
    expect(container.querySelector(".source-filter-popover")).toBeTruthy();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(container.querySelector(".source-filter-popover")).toBeNull();
  });
});

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
// React tracks the last value it set on a controlled input via an internal
// property; assigning `.value` directly (bypassing that tracker) makes
// React's own change-detection see "no change" and skip the onChange
// handler even though a real "input" event fires. Going through the
// native setter first is the standard workaround.
function typeInto(input, text) {
  nativeInputValueSetter.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SidebarLeft search", () => {
  it("narrows the visible source list to matches, and clearing restores all", async () => {
    await renderSidebar();
    // +1 for the "select all" checkbox alongside the two per-source ones.
    const rowsFor = () => container.querySelectorAll('input[type="checkbox"]').length;
    expect(rowsFor()).toBe(3);

    const search = container.querySelector('input[aria-label="Tìm trong tài liệu"]');
    await act(async () => { typeInto(search, "Chuong"); });
    expect(rowsFor()).toBe(2);

    await act(async () => { typeInto(search, ""); });
    expect(rowsFor()).toBe(3);
  });
});
