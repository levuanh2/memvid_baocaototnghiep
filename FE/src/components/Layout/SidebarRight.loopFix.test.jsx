// @vitest-environment jsdom
//
// Regression for the round-6 live-QA finding: the FIRST time a real,
// populated Mind Map ever rendered in this app's history (five prior rounds
// only ever saw the empty state), the page hit a continuous "Maximum update
// depth exceeded" loop.
//
// Root cause: `handleCancelMindMap` was a plain (non-useCallback) function,
// so it got a new reference on every render. `modalMapData` (a useMemo)
// lists it as a dependency, and while `showModalMap` was null the memo's
// ternary always returned the stable primitive `null` regardless — but once
// a map is actually open, the ternary's object branch runs on every
// (unnecessary) recompute, producing a brand-new object each time. The
// effect that forwards `modalMapData` to `onMindmapDataChange` sees a
// "changed" value every render and fires again, which is exactly what
// re-renders the parent (and this component) — an infinite loop invisible
// until `showModalMap` was ever truthy.
//
// This test opens a saved map (the same `setShowModalMap(map)` path a real
// "open saved map" click uses — no need to fake the generation/poll
// pipeline) and asserts `onMindmapDataChange` is NOT called again with a
// new `data` reference across an unrelated re-render.
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarRight from "./SidebarRight";
import { StudyContextProvider } from "../../study/StudyContextProvider";

// Stable (module-level) no-ops — an inline `() => {}` prop would itself be a
// fresh reference every render and mask the very bug this test targets.
const noop = () => {};

// A wrapper with its OWN state to force a genuine, state-driven re-render of
// SidebarRight (an unrelated tick) rather than relying on root.render()
// reference semantics, which React may bail out of differently.
function Harness({ onMindmapDataChange, onMindmapLibraryChange }) {
  const [, forceRerender] = useState(0);
  return (
    <StudyContextProvider>
      <button data-testid="force-rerender" onClick={() => forceRerender((n) => n + 1)}>force</button>
      <SidebarRight
        selectedSources={[]} evidence={null} onMindmapDataChange={onMindmapDataChange}
        onMindmapLibraryChange={onMindmapLibraryChange}
        onSummaryDataChange={noop} onSwitchToChat={noop}
      />
    </StudyContextProvider>
  );
}

const SAVED_MAP = {
  id: "map-1", title: "Sơ đồ đã lưu", nodes: [{ id: "n0", title: "root" }],
  sources: ["mota_sanpham"], createdAt: new Date().toISOString(),
};

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path) => {
    if (path === "/mindmaps") return { ok: true, json: async () => ({ mindmaps: [SAVED_MAP] }) };
    if (path === "/summaries") return { ok: true, json: async () => ({ summaries: [] }) };
    return { ok: true, json: async () => ({}) };
  }),
  generateMindmap: vi.fn(), cancelMindmap: vi.fn(), generateSummary: vi.fn(), cancelSummary: vi.fn(),
  isUnauthorizedError: vi.fn(() => false), isNotFoundOrForbiddenError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((e) => String(e)),
}));

let container;

afterEach(() => {
  if (container) {
    document.body.removeChild(container);
    container = null;
  }
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("SidebarRight modalMapData stability", () => {
  it("does not re-forward mindmap data on an unrelated re-render once a map is open", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onMindmapDataChange = vi.fn();
    let libraryActions;

    await act(async () => {
      root.render(<Harness onMindmapDataChange={onMindmapDataChange} onMindmapLibraryChange={(value) => { libraryActions = value.actions; }} />);
    });
    // let fetchMindMaps()/fetchSummaries() settle
    await act(async () => {
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(libraryActions?.select).toBeTypeOf("function");
    await act(async () => {
      libraryActions.select(SAVED_MAP);
    });

    const callsAfterOpen = onMindmapDataChange.mock.calls.length;
    expect(callsAfterOpen).toBeGreaterThan(0);
    const dataRefAfterOpen = onMindmapDataChange.mock.calls[callsAfterOpen - 1][0]?.data;
    expect(dataRefAfterOpen).toBeTruthy();

    // Force a genuine, unrelated state-driven re-render (a sibling's own
    // state changing, nothing mindmap-related) — before the fix, this alone
    // re-fired the effect with a brand-new modalMapData object.
    const forceBtn = container.querySelector('[data-testid="force-rerender"]');
    await act(async () => {
      forceBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await Promise.resolve(); await Promise.resolve();
    });

    const callsAfterRerender = onMindmapDataChange.mock.calls.length;
    expect(callsAfterRerender).toBe(callsAfterOpen);
  });
});
