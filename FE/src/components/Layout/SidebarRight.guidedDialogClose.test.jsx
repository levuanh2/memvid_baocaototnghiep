// @vitest-environment jsdom
//
// Regression for the 2026-09-24 P1 finding: submitGuidedMindmap closed the
// Guided Mind Map dialog SYNCHRONOUSLY on submit, before the create request
// even started. A real QA browser job ran for a genuine ~60s in the
// background with zero visible feedback anywhere, because the only surface
// showing progress (this dialog) was already gone by the time the request
// was even sent. The fix moves the close into runMindmapGeneration, gated on
// the request's outcome actually being known (queued or done).
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarRight from "./SidebarRight";
import { StudyContextProvider } from "../../study/StudyContextProvider";
import { generateMindmap } from "../../utils/api";

const noop = () => {};

function Harness({ onMindmapLibraryChange }) {
  return (
    <StudyContextProvider>
      <SidebarRight
        selectedSources={["doc-1"]} evidence={null} onMindmapDataChange={noop}
        onMindmapLibraryChange={onMindmapLibraryChange}
        onSummaryDataChange={noop} onSwitchToChat={noop}
      />
    </StudyContextProvider>
  );
}

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path) => {
    if (path === "/mindmaps") return { ok: true, json: async () => ({ mindmaps: [] }) };
    if (path === "/summaries") return { ok: true, json: async () => ({ summaries: [] }) };
    return { ok: true, json: async () => ({}) };
  }),
  generateMindmap: vi.fn(),
  suggestMindmapTopics: vi.fn(async () => ({ suggestions: [] })),
  cancelMindmap: vi.fn(), generateSummary: vi.fn(), cancelSummary: vi.fn(),
  getMindmapCapability: vi.fn(async () => ({ guided_mindmap_v3: true })),
  isUnauthorizedError: vi.fn(() => false), isNotFoundOrForbiddenError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((e) => String(e)),
}));

let container;

afterEach(() => {
  if (container) { document.body.removeChild(container); container = null; }
  localStorage.clear();
  vi.restoreAllMocks();
});

async function openDialogAndSubmit() {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let libraryActions;

  await act(async () => {
    root.render(<Harness onMindmapLibraryChange={(value) => { libraryActions = value.actions; }} />);
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

  await act(async () => { libraryActions.create(); });
  // let suggestMindmapTopics() settle so the dialog is fully rendered
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  // GuidedMindmapDialog portals its content onto document.body (fix: it must
  // stay visible regardless of SidebarRight's own hidden/visible state), so
  // it's not inside `container` anymore.
  expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
  await act(async () => { document.body.querySelector('button[type="submit"]').click(); });
  return container;
}

describe("Guided Mind Map dialog close timing", () => {
  it("stays open while the create request is in flight (queued path)", async () => {
    let resolveCreate;
    generateMindmap.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));

    await openDialogAndSubmit();
    // Before the fix, the dialog was already gone at this exact point --
    // setGuidedOpen(false) fired synchronously in submitGuidedMindmap, before
    // generateMindmap() was even called.
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();

    await act(async () => {
      resolveCreate({ job_id: "job-1" });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    // Outcome is known now (queued) -- dialog should close.
    expect(document.body.querySelector('[role="dialog"]')).toBeFalsy();
  });

  it("stays open on create failure and shows the error instead of vanishing", async () => {
    generateMindmap.mockRejectedValue(new Error("boom"));

    await openDialogAndSubmit();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    // Failure must not silently close the dialog with no feedback.
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
    expect(document.body.textContent).toContain("boom");
  });
});
