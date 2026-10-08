// @vitest-environment jsdom
// PR C2 — Export Studio's appearance override: "Dùng giao diện của sơ đồ" is
// the default, an override never persists on its own, "Áp dụng cho sơ đồ"
// persists ONLY the LIVE_SAFE subset (never typography/content/format), and
// typography/density/format controls are untouched by any of this.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import ExportStudioDialog from "./ExportStudioDialog";
import * as api from "../../utils/api";
import * as imageExport from "../../utils/mindmapImageExport";

vi.mock("../../utils/mindmapImageExport", async (loadOriginal) => {
  const original = await loadOriginal();
  return { ...original, estimateExportDimensions: () => ({ width: 1200, height: 800 }), exportMindmapImage: vi.fn().mockResolvedValue({ filename: "map.png" }) };
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
      <ExportStudioDialog open onClose={vi.fn()} mind={mind} mapId="map-1" title="Bản đồ thử nghiệm"
        selectedNodeId={null} selectedBranchIds={new Set()} onRequestBranchSelection={vi.fn()} {...overrides} />,
    );
  });
  return document.body.querySelector('[role="dialog"]');
}
async function click(el) { await act(async () => { el.click(); }); }

// React patches HTMLInputElement's native `value` setter to track the
// "last known" value per element; setting `.value` directly goes through
// that SAME patched setter, so a subsequent native event can be a silent
// no-op if React's tracker already "knows" the new value. Bypassing the
// patched setter (the standard RTL/jsdom technique) is what actually makes
// the event register as a real external change.
function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
async function goToAppearanceStep(dialog) {
  await click([...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục")); // format
  await click([...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục")); // appearance
}

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Export Studio appearance override — default and switching", () => {
  it("defaults to 'Dùng giao diện của sơ đồ' and shows no node/connector editor until switched", async () => {
    const dialog = await renderDialog();
    await goToAppearanceStep(dialog);
    const useMapRadio = dialog.querySelector('input[name="mm-appearance-mode"][checked]') || [...dialog.querySelectorAll('input[name="mm-appearance-mode"]')].find((i) => i.checked);
    expect(useMapRadio).toBeTruthy();
    expect(dialog.textContent).not.toContain("Áp dụng cho sơ đồ");
  });

  it("switching to custom reveals the node-role editor and the 'Áp dụng cho sơ đồ' action", async () => {
    const dialog = await renderDialog();
    await goToAppearanceStep(dialog);
    const customRadio = [...dialog.querySelectorAll('input[name="mm-appearance-mode"]')].find((i) => !i.checked);
    await click(customRadio);
    expect(dialog.textContent).toContain("Áp dụng cho sơ đồ");
    expect(dialog.querySelector('input[type="color"]')).toBeTruthy();
  });
});

describe("Export Studio appearance override — export never persists it on its own", () => {
  it("exporting with a custom override active never calls patchMindmapAppearance", async () => {
    const patchSpy = vi.spyOn(api, "patchMindmapAppearance");
    const dialog = await renderDialog();
    await goToAppearanceStep(dialog);
    const customRadio = [...dialog.querySelectorAll('input[name="mm-appearance-mode"]')].find((i) => !i.checked);
    await click(customRadio);
    const colorInput = dialog.querySelector('input[type="color"]');
    await act(async () => { setInputValue(colorInput, "#112233"); });
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục")); // -> preview
    const exportBtn = [...dialog.querySelectorAll("button")].find((b) => /^(Xuất|Tạo)/.test(b.textContent));
    await click(exportBtn);
    expect(patchSpy).not.toHaveBeenCalled();
    expect(imageExport.exportMindmapImage).toHaveBeenCalledWith(expect.objectContaining({
      exportStyleOverride: expect.objectContaining({ node: expect.objectContaining({ root: expect.objectContaining({ fill: "#112233" }) }) }),
    }));
  });

  it("'Dùng giao diện của sơ đồ' (no override) passes exportStyleOverride: null and canvasAppearance from the map", async () => {
    const savedAppearance = { version: 2, preset: "pastel", overrides: {} };
    const dialog = await renderDialog({ savedAppearance });
    await goToAppearanceStep(dialog);
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục"));
    const exportBtn = [...dialog.querySelectorAll("button")].find((b) => /^(Xuất|Tạo)/.test(b.textContent));
    await click(exportBtn);
    expect(imageExport.exportMindmapImage).toHaveBeenCalledWith(expect.objectContaining({ exportStyleOverride: null, canvasAppearance: savedAppearance }));
  });
});

describe("Export Studio appearance override — 'Áp dụng cho sơ đồ' persists ONLY the LIVE_SAFE subset", () => {
  it("PATCHes {version, preset, overrides} shaped exactly like the canvas contract — never typography/content/format fields", async () => {
    const patchSpy = vi.spyOn(api, "patchMindmapAppearance").mockResolvedValue({ appearance: { version: 2, preset: "default", overrides: {} }, updated_at: "now" });
    const onAppearanceSaved = vi.fn();
    const dialog = await renderDialog({ mapId: "map-42", onAppearanceSaved });
    await goToAppearanceStep(dialog);
    const customRadio = [...dialog.querySelectorAll('input[name="mm-appearance-mode"]')].find((i) => !i.checked);
    await click(customRadio);
    const colorInput = dialog.querySelector('input[type="color"]');
    await act(async () => { setInputValue(colorInput, "#AABBCC"); });
    const applyBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Áp dụng cho sơ đồ"));
    await click(applyBtn);
    expect(patchSpy).toHaveBeenCalledTimes(1);
    const [calledMapId, calledPayload] = patchSpy.mock.calls[0];
    expect(calledMapId).toBe("map-42");
    expect(Object.keys(calledPayload).sort()).toEqual(["overrides", "preset", "version"]);
    expect(calledPayload.overrides.node.root.fill).toBe("#AABBCC");
    expect(calledPayload).not.toHaveProperty("font");
    expect(calledPayload).not.toHaveProperty("content");
    expect(calledPayload).not.toHaveProperty("typography");
    expect(onAppearanceSaved).toHaveBeenCalled();
  });
});

describe("Export Studio appearance override — lifecycle resets", () => {
  it("'Tạo bản xuất mới' returns to 'Dùng giao diện của sơ đồ' even after a custom override was used", async () => {
    vi.spyOn(api, "patchMindmapAppearance").mockResolvedValue({ appearance: {}, updated_at: "now" });
    const dialog = await renderDialog();
    await goToAppearanceStep(dialog);
    const customRadio = [...dialog.querySelectorAll('input[name="mm-appearance-mode"]')].find((i) => !i.checked);
    await click(customRadio);
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục"));
    const exportBtn = [...dialog.querySelectorAll("button")].find((b) => /^(Xuất|Tạo)/.test(b.textContent));
    await click(exportBtn);
    const startNewBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tạo bản xuất mới");
    await click(startNewBtn);
    await goToAppearanceStep(dialog);
    const useMapRadio = [...dialog.querySelectorAll('input[name="mm-appearance-mode"]')].find((i) => i.checked);
    expect(useMapRadio.closest("label").textContent).toContain("Dùng giao diện của sơ đồ");
  });
});
