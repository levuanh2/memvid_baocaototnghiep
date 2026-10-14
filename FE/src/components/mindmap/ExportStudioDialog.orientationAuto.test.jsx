// @vitest-environment jsdom
//
// PR H (FE) — the PDF "Hướng trang" control must never imply manual control
// over a page the backend now auto-selects. serialize_pdf() picks the map
// page's orientation itself for mode="map"/"map_and_outline" (contain-fit
// scale vs. the real image, never the client's `orientation` option); the
// `orientation` field is still accepted end to end for backward
// compatibility (old stored job options, and mode="outline" still honors it
// exactly as before), but the UI must stop showing an editable Dọc/Ngang
// toggle for a page value it will silently ignore.
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

// Opens the dialog, selects PDF, advances to the appearance step (which
// auto-opens the "Bố cục" accordion for a document format -- see
// changeFormat() in ExportStudioDialog.jsx), and returns the appearance panel.
async function openPdfAppearance() {
  await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
  const dialog = document.body.querySelector('[role="dialog"]');
  await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); }); // content -> format
  await act(async () => { dialog.querySelector('input[name="mm-export-format"][value="pdf"]').click(); });
  await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); }); // format -> appearance
  return dialog;
}

function clickPill(panel, label) {
  const btn = [...panel.querySelectorAll(".pill-tab")].find((b) => b.textContent === label);
  expect(btn, `pill "${label}" not found`).toBeTruthy();
  btn.click();
}

function orientationControl(panel) {
  const label = [...panel.querySelectorAll(".export-control__label")].find((el) => el.textContent === "Hướng trang");
  return label ? label.closest(".export-control") : null;
}

describe("Export Studio — PDF orientation control reflects the real auto-orientation contract", () => {
  it('mode="map": shows the static "Tự động theo nội dung" note, not an editable Dọc/Ngang toggle', async () => {
    await render(makeController());
    const dialog = await openPdfAppearance();
    await act(async () => { clickPill(dialog, "Chỉ sơ đồ"); }); // mode -> map
    const control = orientationControl(dialog);
    expect(control.textContent).toContain("Tự động theo nội dung");
    expect(control.querySelector(".pill-tab")).toBeFalsy();
    expect(control.textContent).not.toContain("Dọc");
    expect(control.textContent).not.toContain("Ngang");
  });

  it('mode="map_and_outline": same auto-orientation note, no editable toggle', async () => {
    await render(makeController());
    const dialog = await openPdfAppearance();
    await act(async () => { clickPill(dialog, "Sơ đồ + dàn ý"); }); // mode -> map_and_outline
    const control = orientationControl(dialog);
    expect(control.textContent).toContain("Tự động theo nội dung");
    expect(control.querySelector(".pill-tab")).toBeFalsy();
  });

  it('mode="outline" (default): keeps the real, editable Dọc/Ngang control', async () => {
    await render(makeController());
    const dialog = await openPdfAppearance();
    const control = orientationControl(dialog);
    expect(control.textContent).not.toContain("Tự động theo nội dung");
    const pills = [...control.querySelectorAll(".pill-tab")].map((b) => b.textContent);
    expect(pills).toEqual(["Dọc", "Ngang"]);
  });

  it("switching map -> outline -> map never loses the orientation value chosen while in outline mode", async () => {
    await render(makeController());
    const dialog = await openPdfAppearance();
    // still in outline mode (default) -- pick "Ngang" explicitly.
    await act(async () => { clickPill(orientationControl(dialog), "Ngang"); });
    expect(orientationControl(dialog).querySelector('.pill-tab[aria-pressed="true"]').textContent).toBe("Ngang");

    await act(async () => { clickPill(dialog, "Chỉ sơ đồ"); }); // -> map (control hidden)
    expect(orientationControl(dialog).textContent).toContain("Tự động theo nội dung");

    await act(async () => { clickPill(dialog, "Chỉ dàn ý"); }); // -> back to outline
    const restored = orientationControl(dialog).querySelector('.pill-tab[aria-pressed="true"]');
    expect(restored.textContent).toBe("Ngang"); // not silently reset to the "Dọc" default
  });

  it("the orientation field still reaches the export payload unchanged for mode=map (backward compatibility)", async () => {
    vi.spyOn(docExport, "createMindmapExport").mockResolvedValue({ job_id: "j1", status: "queued" });
    vi.spyOn(docExport, "pollMindmapExportUntilDone").mockResolvedValue({ status: "done", download_url: "/x" });
    vi.spyOn(docExport, "triggerMindmapExportDownload").mockImplementation(() => {});
    vi.spyOn(imageExport, "captureMapImageWithGeometry").mockResolvedValue({ base64: "ZmFrZS1iYXNlNjQ=", geometryManifest: null });

    await render(makeController());
    const dialog = await openPdfAppearance();
    await act(async () => { clickPill(dialog, "Chỉ sơ đồ"); }); // mode -> map (UI hides the toggle)
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục").click(); }); // -> review

    const exportBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo PDF"));
    await act(async () => { exportBtn.click(); });

    expect(docExport.createMindmapExport).toHaveBeenCalledWith("m1", expect.objectContaining({
      format: "pdf",
      options: expect.objectContaining({ mode: "map", orientation: "portrait" }), // field still present, untouched
    }));
  });
});
