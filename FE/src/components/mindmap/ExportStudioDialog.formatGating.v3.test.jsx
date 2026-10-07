// @vitest-environment jsdom
// PR C1 fail-before (origin/main): the create-new-export format grid must
// show exactly PNG/JPEG/SVG/WebP/PDF, never DOCX/XLSX. On origin/main this
// is RED — the grid still shows DOCX/XLSX and has no WebP option at all.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import ExportStudioDialog from "./ExportStudioDialog";

vi.mock("../../utils/mindmapImageExport", async (loadOriginal) => {
  const original = await loadOriginal();
  return {
    ...original,
    estimateExportDimensions: () => ({ width: 1200, height: 800 }),
    exportMindmapImage: vi.fn().mockResolvedValue({ filename: "map.png" }),
  };
});

beforeAll(() => {
  window.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});

const nodeData = { id: "root", topic: "Root", expanded: true, children: [] };
const mind = { nodeData, map: document.createElement("div"), container: document.createElement("div") };

let host;
let root;

async function renderDialog(overrides = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <ExportStudioDialog
        open onClose={vi.fn()} mind={mind} mapId="map-1" title="Bản đồ thử nghiệm"
        selectedNodeId={null} selectedBranchIds={new Set()} onRequestBranchSelection={vi.fn()}
        {...overrides}
      />,
    );
  });
  return document.body.querySelector('[role="dialog"]');
}

async function click(element) {
  await act(async () => { element.click(); });
}

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("PR C1: export format picker is exactly PNG/JPEG/SVG/WebP/PDF", () => {
  it("the format grid has exactly 5 radios, matching the new public format set", async () => {
    const dialog = await renderDialog();
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục")); // -> format step
    const values = [...dialog.querySelectorAll('input[name="mm-export-format"]')].map((i) => i.value);
    expect(new Set(values)).toEqual(new Set(["png", "jpeg", "svg", "webp", "pdf"]));
  });

  it("DOCX and XLSX never appear as selectable format values", async () => {
    const dialog = await renderDialog();
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục"));
    const values = [...dialog.querySelectorAll('input[name="mm-export-format"]')].map((i) => i.value);
    expect(values).not.toContain("docx");
    expect(values).not.toContain("xlsx");
  });

  it("WebP is selectable and routes through the image (not document) capability set", async () => {
    const dialog = await renderDialog();
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục"));
    const webp = dialog.querySelector('input[name="mm-export-format"][value="webp"]');
    expect(webp).toBeTruthy();
    await click(webp);
    expect(webp.checked).toBe(true);
    // "Tài liệu" (document) section's own disabled-without-mapId styling must
    // never apply to WebP — it's an image format, captured client-side.
    expect(webp.closest("label").className).not.toContain("is-disabled");
  });
});
