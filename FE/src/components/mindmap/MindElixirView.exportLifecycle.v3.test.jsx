// @vitest-environment jsdom
// PR A lifecycle red tests (fail-before on origin/main). Fake data only.
// Uses the same job-API spies as MindElixirView.exportStudioDocument.test.jsx.
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

async function openToPreview(format) {
  await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
  const dialog = document.body.querySelector('[role="dialog"]');
  const next = () => [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục");
  // Reopened dialogs can resume at a later step; only walk forward while "Tiếp tục" is still offered.
  if (!dialog.querySelector(`input[value="${format}"]`)) {
    await act(async () => { next()?.click(); });
  }
  if (dialog.querySelector(`input[value="${format}"]`)) {
    await act(async () => { dialog.querySelector(`input[value="${format}"]`).click(); });
  }
  for (let i = 0; i < 3 && next(); i++) {
    await act(async () => { next().click(); });
  }
  return dialog;
}

const clickByText = async (dialog, text) => {
  const btn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes(text));
  if (!btn) throw new Error(`missing button: ${text}`);
  await act(async () => { btn.click(); });
};

describe("Export lifecycle — attempts and idempotency", () => {
  it("'Xuất lại' after a finished export sends a second request with a NEW idempotency key", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({ status: "done", download_url: "/x?token=a" });
    vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});
    await render(makeController());
    const dialog = await openToPreview("pdf");
    await clickByText(dialog, "Tạo PDF");
    await clickByText(dialog, "Xuất lại");
    const calls = docExport.createMindmapExport.mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][1].idempotencyKey ?? calls[0][1].idempotency_key).toBeTruthy();
    const k1 = calls[0][1].idempotencyKey ?? calls[0][1].idempotency_key;
    const k2 = calls[1][1].idempotencyKey ?? calls[1][1].idempotency_key;
    expect(k2).not.toBe(k1);
  });

  it("a failed export retried with 'Thử lại' uses a new attempt key", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({ status: "error", error: "Lỗi máy chủ" });
    await render(makeController());
    const dialog = await openToPreview("pdf");
    await clickByText(dialog, "Tạo PDF");
    await clickByText(dialog, "Thử lại");
    const calls = docExport.createMindmapExport.mock.calls;
    expect(calls.length).toBe(2);
    const k1 = calls[0][1].idempotencyKey ?? calls[0][1].idempotency_key;
    const k2 = calls[1][1].idempotencyKey ?? calls[1][1].idempotency_key;
    expect(k2).not.toBe(k1);
  });

  it("double click while generating creates exactly one job", async () => {
    let resolvePoll;
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockImplementation(() => new Promise((r) => { resolvePoll = r; }));
    await render(makeController());
    const dialog = await openToPreview("pdf");
    const btn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF"));
    await act(async () => { btn.click(); });
    await act(async () => { btn.click(); });
    expect(docExport.createMindmapExport).toHaveBeenCalledTimes(1);
    resolvePoll?.({ status: "done", download_url: "/x" });
  });

  it("'Tạo bản xuất mới' resets transient state and returns to configuration", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({ status: "done", download_url: "/x" });
    vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});
    await render(makeController());
    const dialog = await openToPreview("pdf");
    await clickByText(dialog, "Tạo PDF");
    await clickByText(dialog, "Tạo bản xuất mới");
    expect(dialog.textContent).not.toContain("Đã xuất");
    // Back at the configuration step (scope), with the previous format kept as a default.
    expect(dialog.querySelector('input[name="mm-export-scope"]')).toBeTruthy();
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
    expect(dialog.querySelector('input[value="pdf"]').checked).toBe(true);
  });

  it("closing and reopening the dialog can export again", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({ status: "done", download_url: "/x" });
    vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});
    await render(makeController());
    const dialog = await openToPreview("pdf");
    await clickByText(dialog, "Tạo PDF");
    await clickByText(dialog, "Đóng");
    const reopened = await openToPreview("pdf");
    await clickByText(reopened, "Tạo PDF");
    expect(docExport.createMindmapExport).toHaveBeenCalledTimes(2);
  });

  it("a finished job id is not reused by the next attempt", async () => {
    const createSpy = vi.spyOn(docExport, "createMindmapExport")
      .mockResolvedValueOnce({ job_id: "j-done", status: "queued" })
      .mockResolvedValueOnce({ job_id: "j-new", status: "queued" });
    const pollSpy = vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({ status: "done", download_url: "/x" });
    vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});
    await render(makeController());
    const dialog = await openToPreview("pdf");
    await clickByText(dialog, "Tạo PDF");
    await clickByText(dialog, "Xuất lại");
    expect(pollSpy.mock.calls.map((c) => c[0])).toEqual(["j-done", "j-new"]);
    expect(createSpy).toHaveBeenCalledTimes(2);
  });
});
