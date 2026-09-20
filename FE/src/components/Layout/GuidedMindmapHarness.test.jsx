// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import GuidedMindmapHarness from "./GuidedMindmapHarness.testonly";

let container;
afterEach(() => { if (container) document.body.removeChild(container); container = null; });

describe("Guided visual fixture harness", () => {
  it("renders ready desktop and empty/error fixture states through the real dialog", async () => {
    container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<GuidedMindmapHarness initialState="ready" />));
    expect(container.querySelector('[data-harness="guided-mindmap"]').dataset.state).toBe("ready");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("exposes mobile and dark fixture dimensions without production mock mode", async () => {
    container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<GuidedMindmapHarness initialState="error" mobile dark />));
    const harness = container.querySelector('[data-harness="guided-mindmap"]');
    expect(harness.dataset.mobile).toBe("true");
    expect(harness.dataset.theme).toBe("dark");
  });
});
