// @vitest-environment jsdom
//
// H3A (A6) red test. "Chỉ giữ node đang hiển thị trong phạm vi đã chọn"
// (visibleOnly) only has a real contract for scopeType "full" (it maps to
// the server's own "visible" scope — see services/mindmap/export/scope.py's
// docstring: a document export is a snapshot of the record, not of a
// browser tab's collapse state, except through that one explicit,
// validated path). The record-based resolver behind the REAL export
// (recordScopedForExport/resolveExportScopeFromRecord, used by every
// current_branch/selected_branches export) has no visible-only concept at
// all and always includes every descendant — before this fix, the preview
// (`scopeResult`, built from the LIVE mind-elixir tree) still silently
// applied the filter for those scopes anyway, so the on-screen node count
// promised a smaller export than what the backend would actually produce.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import ExportStudioDialog from "./ExportStudioDialog";

vi.mock("../../utils/mindmapImageExport", async (loadOriginal) => {
  const original = await loadOriginal();
  return { ...original, estimateExportDimensions: () => null };
});

beforeAll(() => {
  window.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});

// a1 is collapsed, hiding a2 — the node whose presence/absence in the
// preview count reveals whether visibleOnly was actually applied.
const nodeData = {
  id: "root", topic: "Root", expanded: true,
  children: [
    { id: "a", topic: "A", expanded: true, children: [
      { id: "a1", topic: "A1", expanded: false, children: [{ id: "a2", topic: "A2", expanded: true, children: [] }] },
    ] },
    { id: "b", topic: "B", expanded: true, children: [] },
  ],
};
const mind = { nodeData, map: document.createElement("div"), container: document.createElement("div") };

let host, root;

function Harness(props) {
  return <ExportStudioDialog mind={mind} mapId="map-1" title="Bản đồ thử nghiệm" onClose={vi.fn()} onRequestBranchSelection={vi.fn()} open selectedBranchIds={new Set()} {...props} />;
}

async function mount(props) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness {...props} />));
}

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  root = null; host = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function dialog() { return document.body.querySelector('[role="dialog"]'); }
function openAdvanced() { return act(async () => dialog().querySelector('.export-advanced > button').click()); }
function visibleOnlyCheckbox() { return dialog().querySelector('input[name="mm-export-visible-only"]'); }
async function checkVisibleOnly() { await act(async () => visibleOnlyCheckbox().click()); }
function nodeCount() {
  const dd = [...dialog().querySelectorAll("dt")].find((d) => d.textContent === "Số node/nhánh")?.nextElementSibling;
  return dd?.textContent || "";
}
async function clickScope(value) {
  await act(async () => dialog().querySelector(`input[name="mm-export-scope"][value="${value}"]`).click());
}
async function goToReview() {
  const clickText = async (text) => {
    const btn = [...dialog().querySelectorAll("button")].find((b) => b.textContent.trim() === text);
    await act(async () => btn.click());
  };
  await clickText("Tiếp tục"); // content -> format
  await act(async () => dialog().querySelector('input[name="mm-export-format"][value="pdf"]').click());
  await clickText("Tiếp tục"); // format -> appearance
  await clickText("Tiếp tục"); // appearance -> review
}

describe("Export Studio — visibleOnly only ever filters the 'full' scope (H3A / A6)", () => {
  it("disables the checkbox for current_branch and leaves it unchecked-ineffective", async () => {
    await mount({ selectedNodeId: "a" });
    await clickScope("current_branch");
    await openAdvanced();
    expect(visibleOnlyCheckbox().disabled).toBe(true);
  });

  it("current_branch + visibleOnly checked: preview count is NOT filtered (matches what the real export, which has no visible-only concept for this scope, will actually produce)", async () => {
    await mount({ selectedNodeId: "a" });
    await clickScope("current_branch");
    await openAdvanced();
    // Checkbox is disabled, but even if it were somehow toggled, the
    // effective filter must never apply outside "full".
    expect(visibleOnlyCheckbox().checked).toBe(false);
    await goToReview();
    // a, a1, a2 all included -- a2 is hidden on screen but still exported,
    // exactly like unchecked visibleOnly already behaved.
    expect(nodeCount()).toContain("3 node");
  });

  it("full + visibleOnly checked: preview count IS filtered (the one scope where the contract is real)", async () => {
    await mount({ selectedNodeId: null });
    await openAdvanced();
    expect(visibleOnlyCheckbox().disabled).toBe(false);
    await checkVisibleOnly();
    await goToReview();
    // root, a, a1, b included (a1 itself is still visible when collapsed);
    // only a2 (a1's hidden child) excluded -- 4 node, not 5.
    expect(nodeCount()).toContain("4 node");
  });
});
