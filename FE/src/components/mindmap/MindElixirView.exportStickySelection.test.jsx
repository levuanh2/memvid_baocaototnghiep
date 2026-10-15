// @vitest-environment jsdom
//
// H3A red test. Reproduces the reported defect: pick a branch on the
// canvas (controller.selected set), then dismiss the node-detail panel the
// same way MainLayout's closeRightPanel does for the mindmap surface —
// `mmClearSelectedNode({ preserveExportIntent: true })` clears
// `controller.selected` but keeps `controller.lastSelectedForExport` (see
// useMindMapController.selectionLifecycle.test.jsx for the hook-level
// contract this simulates). Before the fix, Export Studio's opening-scope
// derivation (`deriveOpeningScope`) read `controller?.selected?.id`
// straight from the live controller, found it empty, and silently
// defaulted to "full" — the user believed they were exporting one branch
// and got the whole map, matching the H3 brief's reported symptom exactly.
// This file exercises MindElixirView's own consumption of
// `controller.lastSelectedForExport` with a hand-built fake controller;
// the hook's OWN preserveExportIntent/map-switch/reselection contract is
// covered directly in useMindMapController.selectionLifecycle.test.jsx.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixirView from "./MindElixirView";
import * as docExport from "../../utils/mindmapDocumentExport";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
});

function dataFor(id) {
  return {
    id, title: `Map ${id}`,
    nodes: [
      { id: "root", kind: "root", title: "Root", parent: null },
      { id: "a", kind: "section", title: "A", parent: "root" },
      { id: "a1", kind: "idea", title: "A1", parent: "a" },
      { id: "b", kind: "section", title: "B", parent: "root" },
      { id: "b1", kind: "idea", title: "B1", parent: "b" },
    ],
    relations: [], sources: [], schema_version: 2,
    mindMaps: [{ id, title: `Map ${id}`, sources: [] }],
  };
}

function makeController(selected = null, lastSelectedForExport = selected?.id ?? null) {
  return { registerMindInstance: vi.fn(), onNodeSelected: vi.fn(), selected, lastSelectedForExport, sidecarRef: { current: new Map() } };
}

let container, root;
afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
});

async function render(controller, data) {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root.render(<MindElixirView data={data || dataFor("m1")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
  });
}

async function openExportDialog() {
  await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
  return document.body.querySelector('[role="dialog"]');
}

async function goToPdfPreviewAndExport(dialog) {
  // content step -> format step
  await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
  await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
  // format step -> appearance step
  await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
  // appearance step -> review step
  await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
  const btn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF") || b.textContent.includes("Thử lại"));
  await act(async () => { btn.click(); });
}

function mockHappyExport() {
  vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
  vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({ status: "done", download_url: "/x" });
  vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});
}

function lastSentScope() {
  return docExport.createMindmapExport.mock.calls.at(-1)?.[1]?.scope;
}

describe("Export Studio keeps the branch selection after the node-detail panel is dismissed (H3A)", () => {
  it("opens with current_branch (not full) after the canvas selection was cleared by a manual panel close", async () => {
    mockHappyExport();
    const controller = makeController(null);
    await render(controller, dataFor("m1"));

    // Pick branch "a" on the canvas.
    await render({ ...controller, selected: { id: "a" }, lastSelectedForExport: "a" }, dataFor("m1"));
    // Dismiss the node-detail panel -- same effect as MainLayout's
    // closeRightPanel: controller.selected goes back to null, but
    // lastSelectedForExport survives (preserveExportIntent: true).
    await render({ ...controller, selected: null, lastSelectedForExport: "a" }, dataFor("m1"));

    const dialog = await openExportDialog();
    const currentBranchRadio = dialog.querySelector('input[name="mm-export-scope"][value="current_branch"]');
    expect(currentBranchRadio.checked).toBe(true); // FAILS before the fix: "full" was checked instead

    await goToPdfPreviewAndExport(dialog);
    const scope = lastSentScope();
    expect(scope.scope_type).toBe("current_branch");
    expect(scope.selected_node_id).toBe("a");
  });

  it("does not leak a sticky selection from a previous map into a newly opened map", async () => {
    mockHappyExport();
    const controller = makeController(null);
    await render(controller, dataFor("mapA"));
    await render({ ...controller, selected: { id: "a" }, lastSelectedForExport: "a" }, dataFor("mapA"));
    await render({ ...controller, selected: null, lastSelectedForExport: "a" }, dataFor("mapA"));

    // Switch to a different map -- useMindMapController's own data?.id
    // effect clears lastSelectedForExport along with selected; the fake
    // controller here mirrors that real contract.
    await render({ ...controller, selected: null, lastSelectedForExport: null }, dataFor("mapB"));

    const dialog = await openExportDialog();
    const fullRadio = dialog.querySelector('input[name="mm-export-scope"][value="full"]');
    expect(fullRadio.checked).toBe(true);
  });

  it("leaving the mindmap workspace and coming back resets to full, even though the map never changed", async () => {
    mockHappyExport();
    const controller = makeController(null);
    await render(controller, dataFor("m1"));
    await render({ ...controller, selected: { id: "a" }, lastSelectedForExport: "a" }, dataFor("m1"));
    await render({ ...controller, selected: null, lastSelectedForExport: "a" }, dataFor("m1")); // panel closed, pick preserved

    // Leaving the workspace (MainLayout's mode-leave effect) calls
    // clearSelectedNode() with NO args -- clears lastSelectedForExport too,
    // same map identity the whole time.
    await render({ ...controller, selected: null, lastSelectedForExport: null }, dataFor("m1"));

    const dialog = await openExportDialog();
    const fullRadio = dialog.querySelector('input[name="mm-export-scope"][value="full"]');
    expect(fullRadio.checked).toBe(true);
  });
});
