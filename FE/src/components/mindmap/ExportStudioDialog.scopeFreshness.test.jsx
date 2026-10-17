// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import ExportStudioDialog from "./ExportStudioDialog";

const { exportMindmapImageMock, estimateExportDimensionsMock } = vi.hoisted(() => ({
  exportMindmapImageMock: vi.fn(),
  estimateExportDimensionsMock: vi.fn(({ mind: liveMind }) => ({
    width: (liveMind.nodeData.children.length + 1) * 10,
    height: 800,
  })),
}));
vi.mock("../../utils/mindmapImageExport", async (loadOriginal) => ({
  ...(await loadOriginal()),
  estimateExportDimensions: estimateExportDimensionsMock,
  exportMindmapImage: exportMindmapImageMock,
}));

beforeAll(() => {
  window.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});

function nodeData(count, rootTopic = "Root") {
  return {
    id: "root", topic: rootTopic, expanded: true,
    children: Array.from({ length: count - 1 }, (_, index) => ({ id: `n${index}`, topic: `N${index}`, expanded: true, children: [] })),
  };
}

const mind = { nodeData: nodeData(11), map: document.createElement("div"), container: document.createElement("div") };
let host;
let root;

async function renderDialog(overrides = {}) {
  if (!host) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => root.render(
    <ExportStudioDialog
      open
      onClose={vi.fn()}
      mind={mind}
      record={{ id: "map-b", title: "Map B" }}
      mapId="map-b"
      canvasReadyId="map-b"
      title="Map B"
      selectedNodeId={null}
      selectedBranchIds={new Set()}
      onRequestBranchSelection={vi.fn()}
      {...overrides}
    />,
  ));
  return document.body.querySelector('[role="dialog"]');
}

function summary(dialog) {
  return dialog.querySelector(".export-footer__summary")?.textContent || "";
}

async function clickText(dialog, text) {
  const button = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === text);
  await act(async () => button.click());
}

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  root = null;
  host = null;
  mind.nodeData = nodeData(11);
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("Export Studio scope freshness contract", () => {
  it("shows not-ready instead of the previous map count until canvasReadyId catches up", async () => {
    let dialog = await renderDialog({ mapId: "map-b", canvasReadyId: "map-a" });
    expect(dialog.querySelector('[role="status"]')?.textContent).toContain("Đang đồng bộ phạm vi");
    expect(summary(dialog)).not.toMatch(/11 node|57 node/);
    expect([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Tiếp tục").disabled).toBe(true);

    mind.nodeData = nodeData(57);
    dialog = await renderDialog({ mapId: "map-b", canvasReadyId: "map-b" });
    expect(summary(dialog)).toContain("57 node");
  });

  it("revalidates at confirmation and never exports a scope different from the displayed preview", async () => {
    exportMindmapImageMock.mockResolvedValue({ filename: "map-b.png" });
    const dialog = await renderDialog();
    expect(summary(dialog)).toContain("11 node");
    await clickText(dialog, "Tiếp tục");
    await clickText(dialog, "Tiếp tục");
    await clickText(dialog, "Tiếp tục");

    // Simulate an in-place Mind Elixir mutation while the dialog stays open.
    // Object identity, map id, scope and selection all remain unchanged.
    mind.nodeData = nodeData(57);
    await clickText(dialog, "Xuất PNG");
    expect(exportMindmapImageMock).not.toHaveBeenCalled();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("vừa thay đổi");
    expect(summary(dialog)).toContain("57 node");

    await clickText(dialog, "Xuất PNG");
    expect(exportMindmapImageMock).toHaveBeenCalledTimes(1);
  });

  it("revalidates same-id content mutations before exporting with a stale geometry preview", async () => {
    exportMindmapImageMock.mockResolvedValue({ filename: "map-b.png" });
    const dialog = await renderDialog();
    await clickText(dialog, "Tiếp tục");
    await clickText(dialog, "Tiếp tục");
    await clickText(dialog, "Tiếp tục");

    // Editing a topic can change rendered geometry without changing any
    // included id or the displayed node count.
    mind.nodeData = nodeData(11, "A much longer root topic");
    await clickText(dialog, "Xuất PNG");

    expect(exportMindmapImageMock).not.toHaveBeenCalled();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("vừa thay đổi");
  });

  it("refreshes the estimated dimensions on the same readiness boundary as the scope count", async () => {
    let dialog = await renderDialog({ record: { id: "map-a", title: "Map A" }, mapId: "map-a", canvasReadyId: "map-a", title: "Map A" });
    await clickText(dialog, "Tiếp tục");
    await clickText(dialog, "Tiếp tục");
    await clickText(dialog, "Tiếp tục");
    expect(dialog.textContent).toContain("≈110×800px");

    await renderDialog({ open: false, mapId: "map-b", canvasReadyId: "map-a" });
    mind.nodeData = nodeData(57);
    dialog = await renderDialog({ record: { id: "map-b", title: "Map B" }, mapId: "map-b", canvasReadyId: "map-b", title: "Map B" });
    await clickText(dialog, "Tiếp tục");
    await clickText(dialog, "Tiếp tục");
    await clickText(dialog, "Tiếp tục");
    expect(dialog.textContent).toContain("≈570×800px");
    expect(estimateExportDimensionsMock).toHaveBeenCalled();
  });
});
