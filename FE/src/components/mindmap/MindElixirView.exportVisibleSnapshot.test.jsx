// @vitest-environment jsdom
//
// PR E — Document Visible Export, Section 4 red tests. Written against the
// CURRENT origin/main code (no implementation changes in this commit):
// `runDocument`'s scope payload is `{ scope_type, selected_node_id,
// selected_branch_root_ids, include_descendants }` — it never includes a
// visible-node-id snapshot, for ANY scope_type (see
// ExportStudioDialog.jsx's own `runDocument`). Every test below pins the
// FUTURE contract (`scope.visible_node_ids` sent, and sent correctly) and
// is expected to fail on origin/main.
//
// Fixture: same unbalanced shape used throughout PR D/PR #66 (root->a->b->c
// chain, root->e->f shallow branch) so root-only/depth1/2/3/full produce
// genuinely distinct visible sets.
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
      { id: "b", kind: "section", title: "B", parent: "a" },
      { id: "c", kind: "idea", title: "C", parent: "b" },
      { id: "e", kind: "section", title: "E", parent: "root" },
      { id: "f", kind: "idea", title: "F", parent: "e" },
    ],
    relations: [], sources: [], schema_version: 2,
    mindMaps: [{ id, title: `Map ${id}`, sources: [] }],
  };
}

function makeController() {
  return { registerMindInstance: vi.fn(), onNodeSelected: vi.fn(), selected: null, sidecarRef: { current: new Map() } };
}

let container, root;
afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
});

async function render(controller, data) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MindElixirView data={data || dataFor("m1")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
  });
}

async function openOverflow() { await act(async () => { container.querySelector(".mm-overflow-trigger").click(); }); }
async function applyLevel(label) {
  await openOverflow();
  const item = [...document.body.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.includes(label));
  await act(async () => { item.click(); });
}

async function openExportToVisiblePreview() {
  await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
  const dialog = document.body.querySelector('[role="dialog"]');
  await act(async () => { dialog.querySelector('input[name="mm-export-scope"][value="visible"]').click(); });
  await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); }); // -> format
  await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
  await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); }); // -> appearance
  await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); }); // -> preview
  return dialog;
}

async function clickExport(dialog) {
  const btn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF") || b.textContent.includes("Thử lại"));
  await act(async () => { btn.click(); });
}

function lastSentVisibleIds() {
  const call = docExport.createMindmapExport.mock.calls.at(-1);
  return call?.[1]?.scope?.visible_node_ids;
}

function mockHappyExport() {
  vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
  vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({ status: "done", download_url: "/x" });
  vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});
}

describe("Document visible-export snapshot (Section 4, red against origin/main)", () => {
  it("root-only: sends exactly one root id in visible_node_ids", async () => {
    mockHappyExport();
    await render(makeController());
    await applyLevel("Chỉ chủ đề chính");
    const dialog = await openExportToVisiblePreview();
    await clickExport(dialog);
    expect(lastSentVisibleIds()).toEqual(["root"]); // FAILS today: field doesn't exist (undefined)
  });

  it("depth<=2: sends exactly the depth<=2 set", async () => {
    mockHappyExport();
    await render(makeController());
    await applyLevel("Hiện 2 tầng nhánh");
    const dialog = await openExportToVisiblePreview();
    await clickExport(dialog);
    const sent = new Set(lastSentVisibleIds() || []);
    expect(sent).toEqual(new Set(["root", "a", "b", "e", "f"])); // FAILS today: undefined
  });

  it("manual collapse: sends the actual visible set, not a named preset's set", async () => {
    mockHappyExport();
    await render(makeController());
    await applyLevel("Mở toàn bộ");
    // Manually collapse "a" via its own caret -- "e" branch stays open.
    await act(async () => {
      const tpcA = container.querySelector('[data-nodeid="mea"]');
      const epd = tpcA?.parentElement?.querySelector("me-epd");
      epd?.click();
    });
    const dialog = await openExportToVisiblePreview();
    await clickExport(dialog);
    const sent = new Set(lastSentVisibleIds() || []);
    expect(sent).toEqual(new Set(["root", "a", "e", "f"])); // FAILS today: undefined
  });

  it("full tree visible: sends every node id", async () => {
    mockHappyExport();
    await render(makeController());
    await applyLevel("Mở toàn bộ");
    const dialog = await openExportToVisiblePreview();
    await clickExport(dialog);
    const sent = new Set(lastSentVisibleIds() || []);
    expect(sent).toEqual(new Set(["root", "a", "b", "c", "e", "f"])); // FAILS today: undefined
  });

  it("state changed between opening the preview and clicking export: payload reflects the tree AT CLICK TIME, not at preview-open time", async () => {
    mockHappyExport();
    await render(makeController());
    await applyLevel("Chỉ chủ đề chính");
    const dialog = await openExportToVisiblePreview();
    // Close the dialog, expand further on the live canvas, reopen, export.
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Hủy").click(); });
    await applyLevel("Hiện 1 tầng nhánh");
    const dialog2 = await openExportToVisiblePreview();
    await clickExport(dialog2);
    const sent = new Set(lastSentVisibleIds() || []);
    expect(sent).toEqual(new Set(["root", "a", "e"])); // depth1 set, not the stale root-only set. FAILS today: undefined
  });

  it("A -> B -> A: switching maps does not leak a visible snapshot from the previous map identity", async () => {
    mockHappyExport();
    const controller = makeController();
    await render(controller, dataFor("mapA"));
    await applyLevel("Chỉ chủ đề chính");

    await act(async () => {
      root.render(<MindElixirView data={dataFor("mapB")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    await act(async () => {
      root.render(<MindElixirView data={dataFor("mapA")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    // Fresh load of mapA again -- fully expanded by default, not the
    // root-only snapshot from before the A->B->A switch.
    const dialog = await openExportToVisiblePreview();
    await clickExport(dialog);
    const sent = new Set(lastSentVisibleIds() || []);
    expect(sent).toEqual(new Set(["root", "a", "b", "c", "e", "f"])); // FAILS today: undefined
  });

  it("full/current_branch/selected_branches scopes never send visible_node_ids", async () => {
    mockHappyExport();
    await render(makeController());
    await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
    const dialog = document.body.querySelector('[role="dialog"]');
    await act(async () => { dialog.querySelector('input[name="mm-export-scope"][value="full"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await clickExport(dialog);
    const call = docExport.createMindmapExport.mock.calls.at(-1);
    expect(call[1].scope).not.toHaveProperty("visible_node_ids");
    expect(call[1].scope.scope_type).toBe("full");
  });

  it("never sends node title or text content as part of the scope payload", async () => {
    mockHappyExport();
    await render(makeController());
    await applyLevel("Hiện 1 tầng nhánh");
    const dialog = await openExportToVisiblePreview();
    await clickExport(dialog);
    const call = docExport.createMindmapExport.mock.calls.at(-1);
    const scopeStr = JSON.stringify(call[1].scope);
    expect(scopeStr).not.toMatch(/Root|Section|Idea|\bA\b|\bB\b|\bC\b|\bE\b|\bF\b/);
  });

  it("'Tạo bản xuất mới' after a completed export generates a NEW idempotency key, not a reused one", async () => {
    mockHappyExport();
    await render(makeController());
    const dialog = await openExportToVisiblePreview();
    await clickExport(dialog);
    const firstKey = docExport.createMindmapExport.mock.calls.at(-1)[1].idempotencyKey;
    expect(firstKey).toBeTruthy();

    const newExportBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo bản xuất mới"));
    await act(async () => { newExportBtn.click(); });
    const dialog2 = document.body.querySelector('[role="dialog"]');
    await act(async () => { dialog2.querySelector('input[name="mm-export-scope"][value="visible"]')?.click(); });
    const dlg3 = await openExportToVisiblePreview();
    await clickExport(dlg3);
    const secondKey = docExport.createMindmapExport.mock.calls.at(-1)[1].idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });
});
