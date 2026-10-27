// @vitest-environment jsdom
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

const nodeData = {
  id: "root", topic: "Root", expanded: true,
  children: [{ id: "branch", topic: "Branch", expanded: false, children: [{ id: "hidden", topic: "Hidden" }] }],
};

const mind = {
  nodeData,
  map: document.createElement("div"),
  container: document.createElement("div"),
};

let host;
let root;

async function renderDialog(overrides = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <ExportStudioDialog
        open
        onClose={vi.fn()}
        mind={mind}
        mapId="map-1"
        title="Bản đồ thử nghiệm"
        selectedNodeId={null}
        selectedBranchIds={new Set()}
        onRequestBranchSelection={vi.fn()}
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

describe("Export Studio UX v2", () => {
  it("renders a semantic three-zone bench with preview and settings mounted concurrently", async () => {
    const dialog = await renderDialog();
    const nav = dialog.querySelector('nav[aria-label="Khu vực thiết lập xuất sơ đồ"]');
    expect(nav).toBeTruthy();
    expect([...nav.querySelectorAll("button")].map((button) => button.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Nội dung"), expect.stringContaining("Trình bày"), expect.stringContaining("Kiểm tra")]),
    );
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toContain("Nội dung");
    expect([...nav.querySelectorAll("button")].every((button) => !button.disabled)).toBe(true);
    expect(dialog.querySelector('[data-testid="export-persistent-preview"]')).toBeTruthy();
    expect(dialog.querySelector('aside[aria-label="Thiết lập bản xuất"]')).toBeTruthy();
    expect(dialog.querySelector('input[name="mm-export-scope"]')).toBeTruthy();
    expect(dialog.querySelector('input[name="mm-export-format"]')).toBeTruthy();
  });

  it("applies quick presets without exporting and returns to custom after a manual edit", async () => {
    const dialog = await renderDialog();
    const pngPreset = [...dialog.querySelectorAll("button")].find((button) => button.textContent.includes("Ảnh PNG"));
    await click(pngPreset);
    expect(pngPreset.getAttribute("aria-pressed")).toBe("true");
    expect(dialog.textContent).not.toContain("Đã xuất:");

    await click([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Sans (Inter)"));
    expect(dialog.textContent).toContain("Tùy chỉnh");
  });

  it("keeps visible-only semantics under Advanced instead of deleting it", async () => {
    const dialog = await renderDialog({ selectedNodeId: "branch" });
    expect(dialog.querySelector('input[name="mm-export-visible-only"]')).toBeFalsy();
    await click([...dialog.querySelectorAll("button")].find((button) => button.textContent.includes("Nâng cao")));
    const visibleOnly = dialog.querySelector('input[name="mm-export-visible-only"]');
    expect(visibleOnly).toBeTruthy();
    expect(visibleOnly.closest("label").textContent).toContain("trong phạm vi đã chọn");
  });

  it("shows selected-branch count and prevents continuing until a branch exists", async () => {
    const dialog = await renderDialog();
    await click(dialog.querySelector('input[value="selected_branches"]'));
    expect(dialog.textContent).toContain("0 node đã tick");
    expect([...dialog.querySelectorAll("button")].find((button) => button.textContent.includes("Xuất PNG")).disabled).toBe(true);
    expect([...dialog.querySelectorAll("button")].find((button) => button.textContent.includes("Chọn trên canvas"))).toBeTruthy();
  });

  it("uses a persistent structured preview and format-specific final CTA", async () => {
    const dialog = await renderDialog();
    const preview = dialog.querySelector('[aria-label="Xem trước bản xuất dạng sơ đồ minh họa"]');
    expect(preview).toBeTruthy();
    expect(preview.textContent).toContain("Toàn bộ sơ đồ");
    expect(preview.textContent).toContain("PNG");
    expect(preview.textContent).toContain("3 node");
    expect([...dialog.querySelectorAll("button")].find((button) => button.textContent.includes("Tên file"))).toBeTruthy();
    expect([...dialog.querySelectorAll("button")].find((button) => button.textContent.includes("Xuất PNG"))).toBeTruthy();
  });
});
