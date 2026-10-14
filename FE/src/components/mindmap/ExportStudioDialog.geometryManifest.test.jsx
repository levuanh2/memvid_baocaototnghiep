// @vitest-environment jsdom
//
// PR H2 Phase 2 — RED tests against the EXISTING ExportStudioDialog
// component (base 01ec09f). Today's runDocument() builds the export
// payload as {format, scope, options, mapImageBase64, idempotencyKey} --
// there is no mapGeometryManifest field at all. These tests fail by a
// REAL assertion (the field is missing from the mocked call), never
// ImportError, since nothing new is imported here.
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

async function openPdfAppearance() {
  await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
  const dialog = document.body.querySelector('[role="dialog"]');
  await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
  await act(async () => { dialog.querySelector('input[name="mm-export-format"][value="pdf"]').click(); });
  await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); });
  return dialog;
}

function clickPill(panel, label) {
  const btn = [...panel.querySelectorAll(".pill-tab")].find((b) => b.textContent === label);
  btn.click();
}

async function runExport(dialog) {
  await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); }); // -> review
  const exportBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF"));
  await act(async () => { exportBtn.click(); });
}

describe("Export Studio — map geometry manifest payload (H2)", () => {
  it("RED: mode=map sends a map_geometry_manifest alongside the image (currently absent entirely)", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({ status: "done", download_url: "/x" });
    vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});
    vi.spyOn(imageExport, "captureMapImageBase64").mockResolvedValue("ZmFrZS1iYXNlNjQ=");

    await render(makeController());
    const dialog = await openPdfAppearance();
    await act(async () => { clickPill(dialog, "Chỉ sơ đồ"); }); // mode -> map
    await runExport(dialog);

    expect(docExport.createMindmapExport).toHaveBeenCalledWith("m1", expect.objectContaining({
      mapImageBase64: expect.any(String),
      mapGeometryManifest: expect.objectContaining({ version: 1 }),
    }));
  });

  it("RED: mode=map_and_outline also sends a geometry manifest", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({ status: "done", download_url: "/x" });
    vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});
    vi.spyOn(imageExport, "captureMapImageBase64").mockResolvedValue("ZmFrZS1iYXNlNjQ=");

    await render(makeController());
    const dialog = await openPdfAppearance();
    await act(async () => { clickPill(dialog, "Sơ đồ + dàn ý"); });
    await runExport(dialog);

    expect(docExport.createMindmapExport).toHaveBeenCalledWith("m1", expect.objectContaining({
      mapGeometryManifest: expect.objectContaining({ version: 1 }),
    }));
  });

  it("ALREADY GREEN (not a Phase-2 red test, kept as regression pin): mode=outline never sends a manifest or captures an image", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({ status: "done", download_url: "/x" });
    vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});
    const captureSpy = vi.spyOn(imageExport, "captureMapImageBase64");

    await render(makeController());
    const dialog = await openPdfAppearance(); // default mode=outline
    await runExport(dialog);

    expect(captureSpy).not.toHaveBeenCalled();
    const call = docExport.createMindmapExport.mock.calls[0][1];
    expect(call.mapGeometryManifest).toBeUndefined();
    expect(call.mapImageBase64).toBeUndefined();
  });
});
