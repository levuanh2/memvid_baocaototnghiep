// @vitest-environment jsdom
//
// PR H2 Phase 2 — RED test (Section 12): ExportStudioDialog currently
// ignores `final.warning` entirely (runDocument() only reads
// final.status/final.download_url/final.error) -- a job that completes
// `done` with a detail_pages_skipped_ceiling_exceeded warning shows the
// exact same "Đã xuất" success state as one with no warning at all. This
// fails by a real assertion against the EXISTING component, no new import.
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
    nodes: [{ id: "root", kind: "root", title: "Root", parent: null }, { id: "s1", kind: "section", title: "Section 1", parent: "root" }],
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

async function render(controller) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MindElixirView data={dataFor("m1")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />); });
}

describe("Export Studio — ceiling-exceeded warning surfaces to the user (H2)", () => {
  it("RED: job done with a detail_pages_skipped_ceiling_exceeded warning shows the Vietnamese banner, job stays usable", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({
      status: "done", download_url: "/x",
      warning: { code: "detail_pages_skipped_ceiling_exceeded", page_ceiling: 12, best_min_pt_found: 5.4 },
    });
    vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});

    await render(makeController());
    await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
    const dialog = document.body.querySelector('[role="dialog"]');
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { dialog.querySelector('input[name="mm-export-format"][value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    const exportBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF"));
    await act(async () => { exportBtn.click(); });

    expect(dialog.textContent).toContain("Sơ đồ quá lớn để tạo trang chi tiết đọc được trong giới hạn hệ thống");
    // job lifecycle must stay fully usable despite the warning (Section 12 pin):
    expect(dialog.textContent).toContain("Đã xuất");
    const reExportBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Xuất lại"));
    expect(reExportBtn, '"Xuất lại" must not be locked by a warning state').toBeTruthy();
    expect(reExportBtn.disabled).toBe(false);
  });

  it("ALREADY GREEN (regression pin): job done with NO warning shows no banner", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({ status: "done", download_url: "/x" });
    vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});

    await render(makeController());
    await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
    const dialog = document.body.querySelector('[role="dialog"]');
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { dialog.querySelector('input[name="mm-export-format"][value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    const exportBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF"));
    await act(async () => { exportBtn.click(); });

    expect(dialog.textContent).not.toContain("Sơ đồ quá lớn");
  });
});
