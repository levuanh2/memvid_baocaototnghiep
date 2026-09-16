// @vitest-environment jsdom
//
// Regression for round 9, Bug 2: `fetchSourcesFromBackend` used to capture
// "the previous sources" as a SIDE EFFECT inside the `setSources` functional
// updater, then read it back from a separate `setSelectedSources` call —
// relying on an unspecified execution-order detail between two independent
// React dispatches instead of a guaranteed contract. If a selected source
// gets renamed by the backend (same filename, new video_stem) while this
// reconciliation runs off a stale/empty snapshot, the selection silently
// drops instead of migrating to the new stem.
//
// This exercises the REAL vulnerable path end-to-end: `fetchSourcesFromBack
// end` is called a SECOND time from `onKetThuc`'s own `setTimeout(...)` (a
// closure captured back at upload time, in `pollSourceStatus`), not from a
// direct synchronous call — the exact "delayed, closure-captured caller"
// shape the bug report named. Seeds the "in-flight upload" localStorage
// record `nguonConDangXuLy()` reads on mount (same mechanism a real
// page-reload-mid-upload uses) so the poller starts without needing to
// drive a real file input.
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarLeft from "./SidebarLeft";
import { nhoNguon, quenHetNguon } from "../../utils/nguonDangXuLy";

const FILENAME = "Doc.txt";
let listIndexedCallCount = 0;

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path) => {
    if (path === "/list-indexed") {
      listIndexedCallCount += 1;
      const stem = listIndexedCallCount === 1 ? "old_stem" : "new_stem";
      return { ok: true, json: async () => ({ sources: [{ video_stem: stem, filename: FILENAME, num_chunks: 3 }] }) };
    }
    if (path === "/sources/up1/status") {
      return { ok: true, json: async () => ({ status: "ready", can_query: true, video_stem: "old_stem", filename: FILENAME }) };
    }
    return { ok: true, json: async () => ({}) };
  }),
  _appError: vi.fn(), isUnauthorizedError: vi.fn(() => false), isNotFoundOrForbiddenError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((e) => String(e)),
}));

function Harness({ onSelectedChange }) {
  const [selected, setSelected] = useState(["old_stem"]);
  return (
    <SidebarLeft
      selectedSources={selected}
      setSelectedSources={(updater) => {
        setSelected((prev) => {
          const next = typeof updater === "function" ? updater(prev) : updater;
          onSelectedChange(next);
          return next;
        });
      }}
      onSourcesChange={() => {}}
      onClose={() => {}}
    />
  );
}

let container;

afterEach(() => {
  if (container) {
    document.body.removeChild(container);
    container = null;
  }
  listIndexedCallCount = 0;
  quenHetNguon();
  vi.restoreAllMocks();
});

describe("SidebarLeft selection reconciliation across a delayed re-fetch", () => {
  it("migrates a selected stem to its rename instead of silently dropping it", async () => {
    nhoNguon({ sourceId: "up1", filename: FILENAME });

    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let latestSelected = null;
    const onSelectedChange = (next) => { latestSelected = next; };

    await act(async () => {
      root.render(<Harness onSelectedChange={onSelectedChange} />);
    });
    // Mount effects: nguonConDangXuLy() reconstruction -> pollSourceStatus("up1")
    // starts immediately, status resolves "ready" on its first tick -> onKetThuc
    // -> setTimeout(fetchSourcesFromBackend, 500). Wait past that real delay.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
    });

    expect(listIndexedCallCount).toBeGreaterThanOrEqual(2);
    expect(latestSelected).toEqual(["new_stem"]);
    expect(latestSelected).not.toEqual([]);
  }, 10000);
});
