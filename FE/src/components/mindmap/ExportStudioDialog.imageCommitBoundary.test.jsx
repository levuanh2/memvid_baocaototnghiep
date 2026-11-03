// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import ExportStudioDialog from "./ExportStudioDialog";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { exportMindmapImageMock } = vi.hoisted(() => ({ exportMindmapImageMock: vi.fn() }));
vi.mock("../../utils/mindmapImageExport", async (loadOriginal) => ({
  ...(await loadOriginal()),
  exportMindmapImage: exportMindmapImageMock,
  estimateExportDimensions: vi.fn(() => ({ width: 800, height: 600 })),
}));

beforeAll(() => {
  window.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function artifact(filename = "map.png") {
  return {
    filename,
    commitDownload: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  };
}

const mind = {
  map: document.createElement("div"),
  container: document.createElement("div"),
  nodeData: { id: "root", topic: "Root", expanded: true, children: [] },
};

let host;
let root;

async function renderDialog(overrides = {}) {
  if (!host) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  const mapId = overrides.mapId || "map-a";
  await act(async () => root.render(
    <ExportStudioDialog
      open
      onClose={vi.fn()}
      mind={mind}
      record={{ id: mapId, title: mapId }}
      mapId={mapId}
      canvasReadyId={mapId}
      title={mapId}
      selectedNodeId={null}
      selectedBranchIds={new Set()}
      onRequestBranchSelection={vi.fn()}
      {...overrides}
    />,
  ));
  return document.body.querySelector('[role="dialog"]');
}

async function clickExport(dialog, label = "Xuất PNG") {
  const button = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === label);
  await act(async () => button.click());
}

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = "";
  exportMindmapImageMock.mockReset();
});

describe("Export Studio image capture-to-download commit boundary", () => {
  it("does not download Map A when capture resolves after switching to Map B", async () => {
    const capture = deferred();
    const staleArtifact = artifact("map-a.png");
    exportMindmapImageMock.mockReturnValueOnce(capture.promise);
    const dialog = await renderDialog();
    await clickExport(dialog);

    await renderDialog({ mapId: "map-b" });
    await act(async () => { capture.resolve(staleArtifact); await capture.promise; await Promise.resolve(); });

    expect(staleArtifact.commitDownload).not.toHaveBeenCalled();
    expect(staleArtifact.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not download when the dialog unmounts during capture", async () => {
    const capture = deferred();
    const staleArtifact = artifact();
    exportMindmapImageMock.mockReturnValueOnce(capture.promise);
    const dialog = await renderDialog();
    await clickExport(dialog);
    act(() => root.unmount());
    root = null;

    await act(async () => { capture.resolve(staleArtifact); await capture.promise; await Promise.resolve(); });
    expect(staleArtifact.commitDownload).not.toHaveBeenCalled();
    expect(staleArtifact.dispose).toHaveBeenCalledTimes(1);
  });

  it("commits one download for a valid active export", async () => {
    const validArtifact = artifact();
    exportMindmapImageMock.mockResolvedValueOnce(validArtifact);
    const dialog = await renderDialog();
    await clickExport(dialog);

    expect(validArtifact.commitDownload).toHaveBeenCalledTimes(1);
    expect(validArtifact.dispose).toHaveBeenCalledTimes(1);
    expect(dialog.textContent).toContain("Đã xuất: map.png");
  });

  it("does not let a later invalidated re-export complete across map identity", async () => {
    const first = artifact("first.png");
    const secondCapture = deferred();
    const second = artifact("second.png");
    exportMindmapImageMock.mockResolvedValueOnce(first).mockReturnValueOnce(secondCapture.promise);
    let dialog = await renderDialog();
    await clickExport(dialog);
    await clickExport(dialog, "Xuất PNG");

    dialog = await renderDialog({ mapId: "map-b" });
    await act(async () => { secondCapture.resolve(second); await secondCapture.promise; await Promise.resolve(); });

    expect(first.commitDownload).toHaveBeenCalledTimes(1);
    expect(second.commitDownload).not.toHaveBeenCalled();
    expect(dialog.textContent).not.toContain("second.png");
  });

  it("captures and downloads once when Export is clicked twice rapidly", async () => {
    const capture = deferred();
    const only = artifact();
    exportMindmapImageMock.mockReturnValueOnce(capture.promise);
    const dialog = await renderDialog();
    const button = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === "Xuất PNG");
    await act(async () => { button.click(); button.click(); });
    await act(async () => { capture.resolve(only); await capture.promise; await Promise.resolve(); });

    expect(exportMindmapImageMock).toHaveBeenCalledTimes(1);
    expect(only.commitDownload).toHaveBeenCalledTimes(1);
  });

  it("drops a stale Map A capture that resolves after a newer Map B attempt began", async () => {
    const captureA = deferred();
    const captureB = deferred();
    const staleA = artifact("map-a.png");
    const freshB = artifact("map-b.png");
    exportMindmapImageMock.mockReturnValueOnce(captureA.promise).mockReturnValueOnce(captureB.promise);
    await clickExport(await renderDialog());
    const dialogB = await renderDialog({ mapId: "map-b" });
    await clickExport(dialogB);

    await act(async () => { captureA.resolve(staleA); await captureA.promise; await Promise.resolve(); });
    expect(staleA.commitDownload).not.toHaveBeenCalled();
    expect(staleA.dispose).toHaveBeenCalledTimes(1);

    await act(async () => { captureB.resolve(freshB); await captureB.promise; await Promise.resolve(); });
    expect(freshB.commitDownload).toHaveBeenCalledTimes(1);
    expect(exportMindmapImageMock).toHaveBeenCalledTimes(2);
  });
  it("refuses a close dispatched in the same task as the export click (R82-P3-02)", async () => {
    const capture = deferred();
    const onClose = vi.fn();
    exportMindmapImageMock.mockReturnValueOnce(capture.promise);
    const dialog = await renderDialog({ onClose });
    const find = (label) => [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === label);
    const exportButton = find("Xuất PNG");
    const closeButton = find("Hủy");
    await act(async () => { exportButton.click(); closeButton.click(); });

    expect(onClose).not.toHaveBeenCalled();
    expect(exportMindmapImageMock).toHaveBeenCalledTimes(1);
  });
});
