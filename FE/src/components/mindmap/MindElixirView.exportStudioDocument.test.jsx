// @vitest-environment jsdom
//
// Export Studio — document formats (PDF/DOCX/XLSX) end to end at the
// component level: format selection shows the document group, appearance
// step renders only the controls this format's capability set declares,
// and the job lifecycle (queued -> running -> done, or -> error -> retry,
// or cancel) drives the real UI states. mindmapDocumentExport.js (the API
// client) is mocked here — its own real-fetch behavior is covered by
// mindmapDocumentExport.test.js; the job-status API contract itself is
// covered end-to-end against the real Flask app by
// BE/tests/test_mindmap_export_api.py.
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
      { id: "s1", kind: "section", title: "Section 1", parent: "root" },
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

async function render(controller) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MindElixirView data={dataFor("m1")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
  });
}

async function openToFormatStep() {
  await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
  const dialog = document.body.querySelector('[role="dialog"]');
  await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
  return dialog;
}

describe("Export Studio — document formats", () => {
  it("lists PDF/DOCX/XLSX as a separate group, selectable when a map id exists", async () => {
    await render(makeController());
    const dialog = await openToFormatStep();
    expect(dialog.querySelector('input[name="mm-export-format"][value="pdf"]')).toBeTruthy();
    expect(dialog.querySelector('input[name="mm-export-format"][value="docx"]')).toBeTruthy();
    expect(dialog.querySelector('input[name="mm-export-format"][value="xlsx"]')).toBeTruthy();
    expect(dialog.querySelector('input[name="mm-export-format"][value="pdf"]').disabled).toBe(false);
  });

  it("PDF appearance step shows mode/pageSize/orientation/singlePage/background/font/content — but no spacing or connector-thickness (image-only controls)", async () => {
    await render(makeController());
    const dialog = await openToFormatStep();
    await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    const panel = dialog.querySelector('[data-testid="doc-appearance"]');
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain("Khổ giấy");
    expect(panel.textContent).toContain("Hướng trang");
    expect(panel.textContent).toContain("Chế độ");
    await act(async () => { [...panel.querySelectorAll("button")].find((b) => b.textContent === "Màu và kiểu chữ").click(); });
    expect(panel.textContent).toContain("Nền");
    expect(panel.textContent).toContain("Phông chữ");
    expect(panel.textContent).not.toContain("Khoảng cách"); // image-only (spacing)
    expect(panel.textContent).not.toContain("Độ dày đường nối"); // image-only (connectorThickness)
  });

  it("XLSX appearance step shows font/header-style/content only — no background, no orientation, no page size", async () => {
    await render(makeController());
    const dialog = await openToFormatStep();
    await act(async () => { dialog.querySelector('input[value="xlsx"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    const panel = dialog.querySelector('[data-testid="doc-appearance"]');
    await act(async () => { [...panel.querySelectorAll("button")].find((b) => b.textContent === "Màu và kiểu chữ").click(); });
    expect(panel.textContent).toContain("Phông chữ");
    expect(panel.textContent).toContain("Màu tiêu đề bảng");
    expect(panel.textContent).not.toContain("Nền");
    expect(panel.textContent).not.toContain("Hướng trang");
    expect(panel.textContent).not.toContain("Khổ giấy");
  });

  it("DOCX appearance step has no legend content toggle (docx doesn't declare it)", async () => {
    await render(makeController());
    const dialog = await openToFormatStep();
    await act(async () => { dialog.querySelector('input[value="docx"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    const panel = dialog.querySelector('[data-testid="doc-appearance"]');
    await act(async () => { [...panel.querySelectorAll("button")].find((b) => b.textContent === "Nội dung kèm theo").click(); });
    expect(panel.textContent).not.toContain("Chú giải màu nhánh");
    expect(panel.textContent).toContain("Kèm ảnh sơ đồ"); // docx's mapImage control
  });

  it("full job lifecycle: queued -> running -> done triggers a real download call", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockImplementation(async (jobId, { onUpdate }) => {
      onUpdate({ status: "queued", progress: 0 });
      onUpdate({ status: "running", progress: 40 });
      onUpdate({ status: "done", progress: 100 });
      return { status: "done", download_url: "/mindmaps/exports/j1/download?token=abc" };
    });
    const downloadSpy = vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});

    await render(makeController());
    const dialog = await openToFormatStep();
    await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); }); // -> appearance
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); }); // -> preview

    const exportBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF"));
    await act(async () => { exportBtn.click(); });

    expect(docExport.createMindmapExport).toHaveBeenCalledWith("m1", expect.objectContaining({ format: "pdf" }));
    expect(downloadSpy).toHaveBeenCalledWith("/mindmaps/exports/j1/download?token=abc");
    expect(dialog.textContent).toContain("Đã xuất");
  });

  it("job error surfaces a retry button that re-submits", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({ status: "error", error: "Lỗi máy chủ" });

    await render(makeController());
    const dialog = await openToFormatStep();
    await act(async () => { dialog.querySelector('input[value="docx"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });

    const exportBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo DOCX"));
    await act(async () => { exportBtn.click(); });

    expect(dialog.textContent).toContain("Lỗi máy chủ");
    const retryBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Thử lại"));
    expect(retryBtn).toBeTruthy();

    docExport.createMindmapExport.mockClear();
    await act(async () => { retryBtn.click(); });
    expect(docExport.createMindmapExport).toHaveBeenCalledTimes(1);
  });

  it("cancel while running calls cancelMindmapExport and stops the poll", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
    let resolvePoll;
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockImplementation((jobId, { onUpdate, signal }) => {
      onUpdate({ status: "running", progress: 10 });
      return new Promise((resolve, reject) => {
        resolvePoll = resolve;
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const cancelSpy = vi.spyOn(docExport, "cancelMindmapExport").mockResolvedValue({ status: "cancel_requested" });

    await render(makeController());
    const dialog = await openToFormatStep();
    await act(async () => { dialog.querySelector('input[value="xlsx"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });

    const exportBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo XLSX"));
    await act(async () => { exportBtn.click(); });

    const cancelBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Hủy xuất");
    expect(cancelBtn).toBeTruthy();
    await act(async () => { cancelBtn.click(); });
    expect(cancelSpy).toHaveBeenCalledWith("j1");
    void resolvePoll;
  });

  it("Map A<->B isolation: a completed export's state does not leak into a different map (no remount, same pattern WorkspaceContainer.jsx actually uses)", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({
      status: "done", download_url: "/mindmaps/exports/j1/download?token=abc",
    });
    vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});

    const controller = makeController();
    await render(controller);
    const dialog1 = await openToFormatStep();
    await act(async () => { dialog1.querySelector('input[value="pdf"]').click(); });
    await act(async () => { [...dialog1.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog1.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    const exportBtn1 = [...dialog1.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF"));
    await act(async () => { exportBtn1.click(); });
    expect(dialog1.textContent).toContain("Đã xuất");

    // Close, then re-render the SAME root with a DIFFERENT map — real
    // WorkspaceContainer.jsx renders MindElixirView with no `key` prop, so
    // this is the actual update path a map switch takes, not a remount.
    const closeBtn = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Đóng");
    await act(async () => { closeBtn.click(); });
    await act(async () => {
      root.render(<MindElixirView data={dataFor("m2")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });

    await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
    const dialog2 = document.body.querySelector('[role="dialog"]');
    expect(dialog2.textContent).not.toContain("Đã xuất");
    expect(dialog2.textContent).not.toContain("Hoàn tất");
  });
});
