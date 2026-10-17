// @vitest-environment jsdom
//
// H3B.1 regression. Production report: after switching Mind Maps within
// the same app session, Export Studio's preview count stays on the
// PREVIOUS map's node count (real example: map A had 11 nodes, map B has
// 57, Export Studio kept showing 11) even though the real export job
// correctly processes the new map's 57 nodes -- the PDF pipeline was
// always right; only the UI preview was stale.
//
// Root cause: MindElixirView.jsx's own mount effect comment says it
// plainly -- "Create once per mounted viewer. Switching saved maps
// refreshes this same public Mind Elixir instance instead of rebuilding
// the canvas." `mind` (mindRef.current) keeps the SAME object identity
// across an A -> B switch; only `mind.nodeData` is mutated in place via
// `mind.refresh(mindData)`. ExportStudioDialog.jsx's `scopeResult` (and
// `estimated`) are memoized on `[mind, scopeType, selectedNodeId,
// selectedBranchIds, effectiveVisibleOnly]` -- when scopeType/selection
// happen to be unchanged across the switch (e.g. both maps opened on the
// default "full" scope, nothing selected), `mind`'s STABLE identity means
// the memo never recomputes, even though `mind.nodeData` now describes a
// completely different map.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixirView from "./MindElixirView";
import { recordToMindElixir } from "../../utils/mindElixirAdapter";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
});

// Match the production reproduction exactly: A has 11 nodes, B has 57.
function dataFor(id, childCount) {
  return {
    id, title: `Map ${id}`,
    nodes: [
      { id: "root", kind: "root", title: "Root", parent: null },
      ...Array.from({ length: childCount }, (_, i) => ({ id: `c${i}`, kind: "topic", title: `C${i}`, parent: "root" })),
    ],
    relations: [], sources: [], schema_version: 2,
    mindMaps: [{ id, title: `Map ${id}`, sources: [] }],
  };
}
const MAP_A = dataFor("mapA", 10);
const MAP_B = dataFor("mapB", 56);

function makeController() {
  return { registerMindInstance: vi.fn(), onNodeSelected: vi.fn(), selected: null, lastSelectedForExport: null, sidecarRef: { current: new Map() } };
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
    root.render(<MindElixirView data={data} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
  });
}

async function openExportDialog() {
  await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
  return document.body.querySelector('[role="dialog"]');
}
async function closeExportDialog(dialog) {
  await act(async () => { dialog.querySelector('button[aria-label="Close"], .modal-close, [data-close]')?.click(); });
  // The dialog's own X/close control isn't guaranteed a stable selector across
  // appearance tweaks -- fall back to the Modal's backdrop-independent "Hủy" button.
  const hủy = [...dialog.querySelectorAll("button")].find((b) => b.textContent.trim() === "Hủy");
  if (document.body.contains(dialog)) await act(async () => { hủy?.click(); });
}
function footerSummary(dialog) {
  return dialog.querySelector(".export-footer__summary")?.textContent || "";
}

describe("Export Studio scope preview goes stale after switching maps (H3B.1)", () => {
  it("reports map B's live count after opening map A first", async () => {
    const controller = makeController();
    await render(controller, MAP_A);
    const reusedMind = controller.registerMindInstance.mock.calls.at(-1)[0];
    let dialog = await openExportDialog();
    expect(footerSummary(dialog)).toContain("11 node");
    await closeExportDialog(dialog);

    // Switch to map B -- same controller/selection state (both default to
    // "full" scope, nothing selected), so nothing except mind.nodeData's
    // own content actually changed.
    await render(controller, MAP_B);
    expect(controller.registerMindInstance.mock.calls.at(-1)[0]).toBe(reusedMind);
    dialog = await openExportDialog();
    expect(footerSummary(dialog)).toContain("57 node");
  });

  it("reports map A's live count after opening map B first", async () => {
    const controller = makeController();
    await render(controller, MAP_B);
    let dialog = await openExportDialog();
    expect(footerSummary(dialog)).toContain("57 node");
    await closeExportDialog(dialog);

    await render(controller, MAP_A);
    dialog = await openExportDialog();
    expect(footerSummary(dialog)).toContain("11 node");
  });

  it("reports the refreshed count again on the review step", async () => {
    const controller = makeController();
    await render(controller, MAP_A);
    let dialog = await openExportDialog();
    await closeExportDialog(dialog);

    await render(controller, MAP_B);
    dialog = await openExportDialog();
    const clickText = async (text) => {
      const btn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
      await act(async () => btn.click());
    };
    await clickText("Tiếp tục"); // content -> format
    await clickText("Tiếp tục"); // format -> appearance
    await clickText("Tiếp tục"); // appearance -> review
    const dd = [...dialog.querySelectorAll("dt")].find((d) => d.textContent === "Số node/nhánh")?.nextElementSibling;
    expect(dd?.textContent).toContain("57 node");
  });

  it("refreshes the snapshot when the same Mind Elixir instance and map id get a new node structure", async () => {
    const controller = makeController();
    await render(controller, MAP_A);
    let dialog = await openExportDialog();
    expect(footerSummary(dialog)).toContain("11 node");
    await closeExportDialog(dialog);

    const liveMind = controller.registerMindInstance.mock.calls.at(-1)[0];
    const originalIdentity = liveMind;
    liveMind.refresh(recordToMindElixir(dataFor("mapA", 20)).mindData);

    dialog = await openExportDialog();
    expect(controller.registerMindInstance.mock.calls.at(-1)[0]).toBe(originalIdentity);
    expect(footerSummary(dialog)).toContain("21 node");
  });
});
