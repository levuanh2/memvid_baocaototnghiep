// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GuidedMindmapHarness from "./GuidedMindmapHarness.testonly";

// GuidedMindmapDialog portals its content onto document.body (fix: it must
// stay visible regardless of the launching subtree's own visibility), so
// cleanup must unmount the root -- removing `container` alone leaves the
// portaled dialog behind and pollutes later tests in this file.
let container;
let currentRoot;
afterEach(() => {
  if (currentRoot) act(() => currentRoot.unmount());
  if (container) container.remove();
  container = null; currentRoot = null;
});
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ mindmaps: [], summaries: [], guided_mindmap_v3: true }) }));
});

function mount() {
  container = document.createElement("div"); document.body.appendChild(container);
  currentRoot = createRoot(container);
  return currentRoot;
}

describe("Guided visual fixture harness", () => {
  it("renders ready desktop and empty/error fixture states through the real dialog", async () => {
    const root = mount();
    await act(async () => root.render(<GuidedMindmapHarness initialState="ready" />));
    expect(container.querySelector('[data-harness="guided-mindmap"]').dataset.state).toBe("ready");
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("exposes mobile and dark fixture dimensions without production mock mode", async () => {
    const root = mount();
    await act(async () => root.render(<GuidedMindmapHarness initialState="error" mobile dark />));
    const harness = container.querySelector('[data-harness="guided-mindmap"]');
    expect(harness.dataset.mobile).toBe("true");
    expect(harness.dataset.theme).toBe("dark");
  });

  it("renders generation progress, failure retry context, and the real library menu", async () => {
    const root = mount();
    await act(async () => root.render(<GuidedMindmapHarness initialState="progress" mobile />));
    expect(document.body.querySelector('button[type="submit"]')?.disabled).toBe(true);
    await act(async () => root.render(<GuidedMindmapHarness initialState="failed" />));
    expect(document.body.textContent).toContain("Không thể tạo sơ đồ");
    await act(async () => root.render(<GuidedMindmapHarness initialState="library" />));
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(3);
    expect(container.querySelector('[role="region"][aria-label="Bộ kiểm tra ngữ cảnh"]')).not.toBeNull();
  });
});
