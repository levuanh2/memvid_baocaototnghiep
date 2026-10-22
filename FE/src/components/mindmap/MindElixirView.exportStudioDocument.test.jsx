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
import * as imageExport from "../../utils/mindmapImageExport";

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
  it("PR C1: lists PDF as the only document format — DOCX/XLSX no longer selectable", async () => {
    await render(makeController());
    const dialog = await openToFormatStep();
    expect(dialog.querySelector('input[name="mm-export-format"][value="pdf"]')).toBeTruthy();
    expect(dialog.querySelector('input[name="mm-export-format"][value="docx"]')).toBeFalsy();
    expect(dialog.querySelector('input[name="mm-export-format"][value="xlsx"]')).toBeFalsy();
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

  it("offers the screen-oriented content-fit page without changing the A4 default", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j-fit", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({ status: "done", progress: 100 });
    vi.spyOn(imageExport, "captureMapImageWithGeometry").mockResolvedValue({ base64: "ZmFrZQ==", geometryManifest: null });

    await render(makeController());
    const dialog = await openToFormatStep();
    await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });

    const panel = dialog.querySelector('[data-testid="doc-appearance"]');
    const a4 = [...panel.querySelectorAll("button")].find((b) => b.textContent === "A4 — In tài liệu");
    const contentFit = [...panel.querySelectorAll("button")].find((b) => b.textContent === "Vừa nội dung — Xem trên màn hình");
    expect(a4?.getAttribute("aria-pressed")).toBe("true");
    expect(contentFit).toBeTruthy();
    expect(contentFit.disabled).toBe(true);
    expect(panel.textContent).toContain("“Vừa nội dung” chỉ áp dụng cho trang sơ đồ; khi chọn “Chỉ dàn ý”, khổ này chuyển về A4.");
    await act(async () => { [...panel.querySelectorAll("button")].find((b) => b.textContent === "Chỉ sơ đồ").click(); });
    expect(contentFit.disabled).toBe(false);
    await act(async () => { contentFit.click(); });
    expect(contentFit.getAttribute("aria-pressed")).toBe("true");

    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF")).click(); });

    expect(docExport.createMindmapExport).toHaveBeenCalledWith("m1", expect.objectContaining({
      options: expect.objectContaining({ pageSize: "content_fit" }),
    }));
  });

  it("switching from a content-fit map to outline exposes and sends the intentional A4 fallback", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j-outline", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({ status: "done", progress: 100 });

    await render(makeController());
    const dialog = await openToFormatStep();
    await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    const panel = dialog.querySelector('[data-testid="doc-appearance"]');
    const button = (label) => [...panel.querySelectorAll("button")].find((b) => b.textContent === label);

    await act(async () => { button("Chỉ sơ đồ").click(); });
    await act(async () => { button("Vừa nội dung — Xem trên màn hình").click(); });
    expect(button("Vừa nội dung — Xem trên màn hình").getAttribute("aria-pressed")).toBe("true");
    await act(async () => { button("Chỉ dàn ý").click(); });
    expect(button("Vừa nội dung — Xem trên màn hình").disabled).toBe(true);
    expect(button("A4 — In tài liệu").getAttribute("aria-pressed")).toBe("true");

    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF")).click(); });
    expect(docExport.createMindmapExport).toHaveBeenCalledWith("m1", expect.objectContaining({
      options: expect.objectContaining({ mode: "outline", pageSize: "A4" }),
    }));
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
    await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });

    const exportBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF"));
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
    await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });

    const exportBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF"));
    await act(async () => { exportBtn.click(); });

    const cancelBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Hủy xuất");
    expect(cancelBtn).toBeTruthy();
    await act(async () => { cancelBtn.click(); });
    expect(cancelSpy).toHaveBeenCalledWith("j1");
    void resolvePoll;
  });

  it("a delayed server cancellation cannot overwrite a map-switched session", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "job-a", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockImplementation((jobId, { onUpdate, signal }) => {
      onUpdate({ status: "running", progress: 25 });
      return new Promise((resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    let resolveCancel;
    vi.spyOn(docExport, "cancelMindmapExport").mockImplementation(() => new Promise((resolve) => { resolveCancel = resolve; }));
    const controller = makeController();

    await render(controller);
    const dialog = await openToFormatStep();
    await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    act(() => { [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF")).click(); });
    await act(async () => { await Promise.resolve(); });

    act(() => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Hủy xuất").click(); });
    await act(async () => {
      root.render(<MindElixirView data={dataFor("m2")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
      await Promise.resolve();
    });
    expect(dialog.textContent).not.toContain("Đã hủy");

    await act(async () => {
      resolveCancel({ status: "cancel_requested" });
      await Promise.resolve();
    });

    expect(dialog.textContent).not.toContain("Đã hủy");
    expect(dialog.textContent).not.toContain("Thất bại");
  });

  it("a cancelled export can retry with a fresh attempt and complete normally", async () => {
    vi.spyOn(docExport, "createMindmapExport")
      .mockResolvedValueOnce({ job_id: "job-a", status: "queued" })
      .mockResolvedValueOnce({ job_id: "job-b", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone")
      .mockImplementationOnce((jobId, { onUpdate, signal }) => {
        onUpdate({ status: "running", progress: 15 });
        return new Promise((resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      })
      .mockResolvedValueOnce({ status: "done", progress: 100, download_url: "/job-b" });
    vi.spyOn(docExport, "cancelMindmapExport").mockResolvedValue({ status: "cancel_requested" });
    const downloadSpy = vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});

    await render(makeController());
    const dialog = await openToFormatStep();
    await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    act(() => { [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF")).click(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Hủy xuất").click(); });
    expect(dialog.textContent).toContain("Đã hủy");

    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF")).click(); });

    expect(docExport.createMindmapExport).toHaveBeenCalledTimes(2);
    expect(downloadSpy).toHaveBeenCalledWith("/job-b");
    expect(dialog.textContent).toContain("Đã xuất:");
  });

  it("cancel and reopen starts a clean session that can export", async () => {
    vi.spyOn(docExport, "createMindmapExport")
      .mockResolvedValueOnce({ job_id: "job-a", status: "queued" })
      .mockResolvedValueOnce({ job_id: "job-b", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone")
      .mockImplementationOnce((jobId, { onUpdate, signal }) => {
        onUpdate({ status: "running", progress: 15 });
        return new Promise((resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      })
      .mockResolvedValueOnce({ status: "done", progress: 100, download_url: "/job-b" });
    vi.spyOn(docExport, "cancelMindmapExport").mockResolvedValue({ status: "cancel_requested" });
    const downloadSpy = vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});

    await render(makeController());
    const dialog = await openToFormatStep();
    await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    act(() => { [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF")).click(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Hủy xuất").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Hủy").click(); });

    await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
    const reopened = document.body.querySelector('[role="dialog"]');
    expect(reopened.textContent).not.toContain("Đã hủy");
    await act(async () => { [...reopened.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...reopened.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...reopened.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...reopened.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF")).click(); });

    expect(docExport.createMindmapExport).toHaveBeenCalledTimes(2);
    expect(downloadSpy).toHaveBeenCalledWith("/job-b");
    expect(reopened.textContent).toContain("Đã xuất:");
  });

  it("cancel during the local PDF capture never creates or downloads a backend job", async () => {
    let resolveCapture;
    vi.spyOn(imageExport, "captureMapImageWithGeometry").mockImplementation(() => new Promise((resolve) => { resolveCapture = resolve; }));
    const createSpy = vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "late", status: "queued" });
    const downloadSpy = vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});

    await render(makeController());
    const dialog = await openToFormatStep();
    await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Chỉ sơ đồ").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });

    act(() => { [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF")).click(); });
    await act(async () => {});
    const cancelBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Hủy xuất");
    expect(cancelBtn).toBeTruthy();
    await act(async () => { cancelBtn.click(); });
    await act(async () => {
      resolveCapture({ base64: "ZmFrZQ==", geometryManifest: { version: 1, nodes: [], connectors: [] } });
      await Promise.resolve();
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(downloadSpy).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain("Đã hủy");
  });

  it("a rejected stale capture cannot overwrite a newer running attempt", async () => {
    let rejectFirstCapture;
    let captureCount = 0;
    vi.spyOn(imageExport, "captureMapImageWithGeometry").mockImplementation(() => {
      captureCount += 1;
      if (captureCount === 1) return new Promise((resolve, reject) => { rejectFirstCapture = reject; });
      return Promise.resolve({ base64: "ZmFrZQ==", geometryManifest: { version: 1, nodes: [], connectors: [] } });
    });
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "job-b", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockImplementation((jobId, { onUpdate, signal }) => {
      onUpdate({ status: "running", progress: 40 });
      return new Promise((resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });

    await render(makeController());
    const dialog = await openToFormatStep();
    await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Chỉ sơ đồ").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });

    act(() => { [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF")).click(); });
    await act(async () => {});
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Hủy xuất").click(); });
    act(() => { [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF")).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(dialog.textContent).toContain("Đang xử lý (40%)");

    await act(async () => {
      rejectFirstCapture(new Error("stale capture failed"));
      await Promise.resolve();
    });

    expect(dialog.textContent).toContain("Đang xử lý (40%)");
    expect(dialog.textContent).not.toContain("stale capture failed");
  });

  it("a map switch during local PDF capture invalidates the old attempt", async () => {
    let resolveCapture;
    vi.spyOn(imageExport, "captureMapImageWithGeometry").mockImplementation(() => new Promise((resolve) => { resolveCapture = resolve; }));
    const createSpy = vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "late", status: "queued" });
    const downloadSpy = vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});
    const controller = makeController();

    await render(controller);
    const dialog = await openToFormatStep();
    await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Chỉ sơ đồ").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    act(() => { [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF")).click(); });
    await act(async () => {});

    await act(async () => {
      root.render(<MindElixirView data={dataFor("m2")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    await act(async () => {
      resolveCapture({ base64: "ZmFrZQ==", geometryManifest: { version: 1, nodes: [], connectors: [] } });
      await Promise.resolve();
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it("best-effort cancels a job returned after the user aborted its create request", async () => {
    vi.spyOn(imageExport, "captureMapImageWithGeometry").mockResolvedValue({ base64: "ZmFrZQ==", geometryManifest: { version: 1, nodes: [], connectors: [] } });
    let resolveCreate;
    vi.spyOn(docExport, "createMindmapExport").mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
    const cancelSpy = vi.spyOn(docExport, "cancelMindmapExport").mockResolvedValue({ status: "cancel_requested" });
    const pollSpy = vi.spyOn(docExport, "pollMindmapExportUntilDone");
    const downloadSpy = vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});

    await render(makeController());
    const dialog = await openToFormatStep();
    await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Chỉ sơ đồ").click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    act(() => { [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF")).click(); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Hủy xuất").click(); });
    await act(async () => { resolveCreate({ job_id: "late-job", status: "queued" }); await Promise.resolve(); });

    expect(cancelSpy).toHaveBeenCalledWith("late-job");
    expect(pollSpy).not.toHaveBeenCalled();
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  // PR E closed the gap this test used to pin (PR D-era note, kept for
  // history): "Phần đang hiển thị" now submits scope_type:"visible" WITH a
  // validated visible_node_ids snapshot (see
  // MindElixirView.exportVisibleSnapshot.test.jsx for the full contract —
  // root-only/depth/manual-collapse sets, click-time snapshot, no leak
  // across map switch). This test keeps pinning only that the scope_type
  // itself is still submitted verbatim for PDF.
  it("'Phần đang hiển thị' scope is submitted for PDF export (full contract pinned in MindElixirView.exportVisibleSnapshot.test.jsx)", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({ status: "done", download_url: "/x" });
    vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});

    await render(makeController());
    await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
    const dialog = document.body.querySelector('[role="dialog"]');
    await act(async () => { dialog.querySelector('input[name="mm-export-scope"][value="visible"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); }); // -> format
    await act(async () => { dialog.querySelector('input[value="pdf"]').click(); });
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); }); // -> appearance
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); }); // -> preview

    const exportBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF"));
    await act(async () => { exportBtn.click(); });

    expect(docExport.createMindmapExport).toHaveBeenCalledWith("m1", expect.objectContaining({
      scope: expect.objectContaining({ scope_type: "visible" }),
    }));
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
