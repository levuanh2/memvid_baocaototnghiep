// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import UsageChip from "./UsageChip";
import { apiFetch } from "../../utils/api";

vi.mock("../../utils/api", () => ({ apiFetch: vi.fn() }));

let container;
let root;

const summary = (overrides = {}) => ({
  plan: "Free",
  used: 800,
  reserved: 0,
  limit: 1000,
  remaining: 200,
  percentage: 80,
  reset_at: "2026-11-01T00:00:00Z",
  breakdown: { chat: 800 },
  ...overrides,
});

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

async function renderChip() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<UsageChip />));
  await flush();
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe("UsageChip", () => {
  it("shows loading then the 80% warning state", async () => {
    let resolve;
    apiFetch.mockReturnValue(new Promise((done) => { resolve = done; }));
    await act(async () => {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      root.render(<UsageChip />);
    });
    expect(container.querySelector('[aria-label="Đang tải mức sử dụng"]')).toBeTruthy();

    await act(async () => resolve({ ok: true, json: async () => summary() }));
    await flush();
    const trigger = container.querySelector('button[aria-haspopup="dialog"]');
    expect(trigger.textContent).toContain("AI 80%");
    expect(trigger.querySelector(".text-warn")).toBeTruthy();
  });

  it("retries after an error and renders the exhausted danger state", async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => summary({ used: 1000, remaining: 0, percentage: 100 }) });
    await renderChip();
    const retry = Array.from(container.querySelectorAll("button")).find((node) => node.textContent.includes("Usage"));
    expect(retry).toBeTruthy();
    await act(async () => retry.click());
    await flush();
    const trigger = container.querySelector('button[aria-haspopup="dialog"]');
    expect(trigger.textContent).toContain("AI 100%");
    expect(trigger.querySelector(".text-danger")).toBeTruthy();
    await act(async () => trigger.click());
    expect(container.querySelector(".bg-danger")).toBeTruthy();
  });

  it("closes on Escape and outside click and constrains the mobile popover", async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => summary() });
    await renderChip();
    const trigger = container.querySelector('button[aria-haspopup="dialog"]');
    await act(async () => trigger.click());
    let dialog = container.querySelector('[role="dialog"]');
    expect(dialog.className).toContain("w-[min(280px,calc(100vw-16px))]");

    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => trigger.click());
    await act(async () => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
