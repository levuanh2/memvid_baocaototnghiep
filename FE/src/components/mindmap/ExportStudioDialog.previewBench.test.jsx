// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import ExportStudioDialog from "./ExportStudioDialog";

const { exportImage, captureBase64, captureGeometry } = vi.hoisted(() => ({
  exportImage: vi.fn(),
  captureBase64: vi.fn(),
  captureGeometry: vi.fn(),
}));

vi.mock("../../utils/mindmapImageExport", async (loadOriginal) => ({
  ...(await loadOriginal()),
  estimateExportDimensions: () => ({ width: 1440, height: 900 }),
  exportMindmapImage: exportImage,
  captureMapImageBase64: captureBase64,
  captureMapImageWithGeometry: captureGeometry,
}));

beforeAll(() => {
  window.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});

const mind = {
  nodeData: {
    id: "root", topic: "Hệ điều hành", expanded: true,
    children: [
      { id: "branch", topic: "Bộ nhớ", expanded: true, children: [{ id: "leaf", topic: "Phân trang", children: [] }] },
      { id: "other", topic: "Tiến trình", children: [] },
    ],
  },
  map: document.createElement("div"),
  container: document.createElement("div"),
};

// Two sibling sub-branches, each two levels deep, used to build a
// multi-branch selection with suppressed auto-context — the exact shape
// where "node count - 1" is NOT a valid connector count (the render set can
// be two disjoint components once the connecting ancestor is suppressed).
const multiBranchMind = {
  nodeData: {
    id: "root", topic: "Gốc", expanded: true,
    children: [
      {
        id: "sectionA", topic: "Nhánh A", expanded: true,
        children: [{ id: "leafA", topic: "Lá A", expanded: true, children: [] }],
      },
      {
        id: "sectionB", topic: "Nhánh B", expanded: true,
        children: [{ id: "leafB", topic: "Lá B", expanded: true, children: [] }],
      },
    ],
  },
  map: document.createElement("div"),
  container: document.createElement("div"),
};

let host;
let root;

async function renderDialog() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(
    <ExportStudioDialog
      open
      onClose={vi.fn()}
      mind={mind}
      mapId="map-1"
      title="Hệ điều hành hiện đại"
      selectedNodeId="branch"
      selectedBranchIds={new Set()}
      onRequestBranchSelection={vi.fn()}
    />,
  ));
  return document.body.querySelector('[role="dialog"]');
}

async function click(element) {
  await act(async () => element.click());
}

async function renderMultiBranchDialog() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(
    <ExportStudioDialog
      open
      onClose={vi.fn()}
      mind={multiBranchMind}
      mapId="map-1"
      title="Gốc"
      selectedNodeId={null}
      selectedBranchIds={new Set(["leafA", "leafB"])}
      onRequestBranchSelection={vi.fn()}
    />,
  ));
  return document.body.querySelector('[role="dialog"]');
}

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("Export Studio Preview Bench", () => {
  it("keeps preview and every settings group mounted while metadata follows scope, format, and appearance", async () => {
    const dialog = await renderDialog();
    const preview = dialog.querySelector('[data-testid="export-persistent-preview"]');
    const settings = dialog.querySelector('aside[aria-label="Thiết lập bản xuất"]');

    expect(preview).toBeTruthy();
    expect(settings).toBeTruthy();
    expect(settings.querySelector("#export-bench-content")).toBeTruthy();
    expect(settings.querySelector("#export-bench-presentation")).toBeTruthy();
    expect(settings.querySelector("#export-bench-check")).toBeTruthy();
    expect(preview.textContent).toContain("Nhánh hiện tại · PNG");
    expect(preview.textContent).toContain("3 node");
    expect(preview.textContent).toContain("≈1440×900px");

    await click(dialog.querySelector('input[name="mm-export-scope"][value="full"]'));
    expect(preview.textContent).toContain("Toàn bộ sơ đồ · PNG");
    expect(preview.textContent).toContain("4 node");

    await click(dialog.querySelector('input[name="mm-export-format"][value="jpeg"]'));
    expect(preview.textContent).toContain("Toàn bộ sơ đồ · JPEG");

    await click([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Tài liệu học tập"));
    expect(preview.textContent).toContain("Tài liệu học tập");
  });

  it("never invokes an export or capture path while preview-driving choices change", async () => {
    const dialog = await renderDialog();
    // The dialog OPENS on "current_branch" (deriveOpeningScope, since
    // selectedNodeId is set) — re-clicking the already-active radio is a
    // no-op, not a genuine scope transition. Exercise every OTHER scope so
    // this test actually covers scope changes, not just format/appearance.
    await click(dialog.querySelector('input[name="mm-export-scope"][value="full"]'));
    await click(dialog.querySelector('input[name="mm-export-scope"][value="selected_branches"]'));
    await click(dialog.querySelector('input[name="mm-export-scope"][value="visible"]'));
    await click(dialog.querySelector('input[name="mm-export-format"][value="pdf"]'));
    await click([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Tối giản"));

    expect(exportImage).not.toHaveBeenCalled();
    expect(captureBase64).not.toHaveBeenCalled();
    expect(captureGeometry).not.toHaveBeenCalled();
  });

  it("never renders an invented connector count, including for a multi-branch selection with a suppressed auto-context ancestor", async () => {
    const dialog = await renderMultiBranchDialog();
    const preview = dialog.querySelector('[data-testid="export-persistent-preview"]');

    // Two leaves from separate sub-branches, exact-selection mode (the only
    // mode this dialog's "selected_branches" scope offers): the render set
    // is leafA + leafB + their minimal connecting ancestors (sectionA,
    // sectionB, root). "kết nối" must never appear — the fix removes the
    // metric unconditionally, not only when it would be wrong, since no
    // already-resolved authoritative connector count exists.
    expect(preview.textContent).toContain("node");
    expect(preview.textContent).not.toContain("kết nối");
    const nodeCountBefore = Number(preview.querySelector(".export-preview__stats b").textContent);
    expect(nodeCountBefore).toBeGreaterThan(0);

    // Suppress one auto-added context ancestor — this can disconnect the
    // render set into separate components (exactly the case "node count -
    // 1", the old formula, would silently get wrong). The fix must still
    // show no connector stat after the render set changes shape.
    const suppressButton = dialog.querySelector(".export-context-list button");
    expect(suppressButton).toBeTruthy();
    await click(suppressButton);

    const nodeCountAfter = Number(preview.querySelector(".export-preview__stats b").textContent);
    expect(nodeCountAfter).toBeLessThan(nodeCountBefore);
    expect(preview.textContent).not.toContain("kết nối");
  });

  it("keeps the export action outside the only scrollable settings region", async () => {
    const dialog = await renderDialog();
    const settings = dialog.querySelector(".export-settings");
    const footer = dialog.querySelector(".export-footer");
    const action = [...footer.querySelectorAll("button")].find((button) => button.textContent.includes("Xuất PNG"));

    expect(settings.contains(footer)).toBe(false);
    expect(action).toBeTruthy();
    expect(action.disabled).toBe(false);
  });
});
