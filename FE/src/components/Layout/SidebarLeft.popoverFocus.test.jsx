// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarLeft from "./SidebarLeft";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path) => {
    if (path === "/list-indexed") {
      return {
        ok: true,
        json: async () => ({
          sources: [{
            source_id: "source-1",
            filename: "Nguồn.pdf",
            video_stem: "source-1",
            status: "ready",
            can_query: true,
            num_chunks: 2,
          }],
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  }),
  _appError: vi.fn(async () => new Error("HTTP error")),
  isUnauthorizedError: vi.fn(() => false),
  isNotFoundOrForbiddenError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((error) => String(error)),
}));

let container;
let root;

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
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

describe("SidebarLeft popover focus return", () => {
  it("returns focus to the advanced-filter trigger after Escape", async () => {
    await mountSidebar();
    const trigger = container.querySelector(".source-filter-trigger");
    trigger.focus();
    await act(async () => { trigger.click(); });
    const select = container.querySelector(".source-filter-popover select");
    select.focus();
    expect(document.activeElement).toBe(select);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(container.querySelector(".source-filter-popover")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("returns focus to the source-menu trigger after Escape", async () => {
    await mountSidebar();
    const trigger = container.querySelector('.sidebar-source-menu button[aria-haspopup="true"]');
    trigger.focus();
    await act(async () => { trigger.click(); });
    const item = container.querySelector('[role="menuitem"]');
    item.focus();
    expect(document.activeElement).toBe(item);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
