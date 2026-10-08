// @vitest-environment jsdom
// PR C2 — toolbar "Giao diện" editor: no typography/density controls, zero
// layout/linkDiv/refresh/fit/center calls while previewing, Escape/Hủy
// rollback, Áp dụng persists and keeps the preview, PATCH failure rolls
// back to the saved look and shows an error.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import AppearanceEditorDrawer from "./AppearanceEditorDrawer";
import * as api from "../../utils/api";

beforeAll(() => {
  window.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});

function makeMind() {
  const container = document.createElement("div");
  const map = document.createElement("div");
  container.appendChild(map);
  document.body.appendChild(container);
  const nodeData = { id: "root", topic: "Root", expanded: true, children: [{ id: "a", topic: "A", expanded: true, children: [] }] };
  const els = new Map();
  const mk = (n) => { const el = document.createElement("me-tpc"); el.dataset.nodeid = n.id; map.appendChild(el); els.set(n.id, el); (n.children || []).forEach(mk); };
  mk(nodeData);
  return {
    container, map, nodeData, findEle: (id) => els.get(id) || null,
    layout: vi.fn(), linkDiv: vi.fn(), refresh: vi.fn(), scaleFit: vi.fn(), toCenter: vi.fn(),
  };
}

let host;
let root;
async function renderDrawer(overrides = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const mind = overrides.mind || makeMind();
  await act(async () => {
    root.render(
      <AppearanceEditorDrawer open onClose={vi.fn()} mind={mind} mapId="map-1" savedAppearance={undefined} onSaved={vi.fn()} {...overrides} />,
    );
  });
  return { dialog: document.body.querySelector('[role="dialog"]'), mind };
}

async function click(el) { await act(async () => { el.click(); }); }

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("AppearanceEditorDrawer — no typography/density controls", () => {
  it("never renders a font/typography or padding/density control anywhere in the dialog", async () => {
    const { dialog } = await renderDrawer();
    // Open every accordion section so nothing is hidden from the text scan.
    for (const label of ["Mẫu dựng sẵn", "Màu & kiểu node", "Đường nối", "Nền"]) {
      const trigger = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes(label));
      if (trigger && trigger.getAttribute("aria-expanded") === "false") await click(trigger);
    }
    expect(dialog.textContent).not.toMatch(/phông chữ|font|khoảng cách|density|mật độ|line-?height|đệm|padding/i);
  });
});

describe("AppearanceEditorDrawer — zero layout/linkDiv/refresh/fit/center during preview", () => {
  it("opening, switching preset, and editing a role never calls any of the five forbidden methods", async () => {
    const { dialog, mind } = await renderDrawer();
    const studyBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Học tập");
    await click(studyBtn);
    const nodeTrigger = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Màu & kiểu node"));
    await click(nodeTrigger);
    const colorInput = dialog.querySelector('input[type="color"]');
    await act(async () => {
      colorInput.value = "#112233";
      colorInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(mind.layout).not.toHaveBeenCalled();
    expect(mind.linkDiv).not.toHaveBeenCalled();
    expect(mind.refresh).not.toHaveBeenCalled();
    expect(mind.scaleFit).not.toHaveBeenCalled();
    expect(mind.toCenter).not.toHaveBeenCalled();
  });
});

describe("AppearanceEditorDrawer — cancel/Escape rollback", () => {
  it("clicking Hủy restores the node's inline style to what it was before the dialog opened", async () => {
    const mind = makeMind();
    const rootEl = mind.findEle("root");
    const baseline = rootEl.style.cssText;
    const onClose = vi.fn();
    const { dialog } = await renderDrawer({ mind, onClose });
    const studyBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Học tập");
    await click(studyBtn);
    expect(rootEl.style.cssText).not.toBe(baseline);
    const cancelBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Hủy");
    await click(cancelBtn);
    expect(rootEl.style.cssText).toBe(baseline);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("AppearanceEditorDrawer — reset and undo", () => {
  it("Đặt lại returns the draft to the true default (no-op) preset", async () => {
    const { dialog, mind } = await renderDrawer();
    const studyBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Học tập");
    await click(studyBtn);
    const rootEl = mind.findEle("root");
    const studyCss = rootEl.style.cssText;
    const resetBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Đặt lại");
    await click(resetBtn);
    expect(rootEl.style.cssText).not.toBe(studyCss);
  });

  it("Hoàn tác pops exactly one step back", async () => {
    const { dialog, mind } = await renderDrawer();
    const rootEl = mind.findEle("root");
    const beforeAny = rootEl.style.cssText;
    const studyBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Học tập");
    await click(studyBtn);
    const pastelBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Pastel");
    await click(pastelBtn);
    const undoBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Hoàn tác"));
    await click(undoBtn); // back to "study"
    const afterOneUndo = rootEl.style.cssText;
    await click(undoBtn); // back to the pre-edit baseline
    expect(rootEl.style.cssText).toBe(beforeAny);
    expect(afterOneUndo).not.toBe(beforeAny);
  });
});

describe("AppearanceEditorDrawer — Apply persists and keeps the preview", () => {
  it("calls patchMindmapAppearance with the draft, calls onSaved, and does not roll back on close", async () => {
    const patchSpy = vi.spyOn(api, "patchMindmapAppearance").mockResolvedValue({ appearance: { version: 2, preset: "study", overrides: {} }, updated_at: "now" });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const { dialog, mind } = await renderDrawer({ onSaved, onClose, mapId: "map-7" });
    const studyBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Học tập");
    await click(studyBtn);
    const rootEl = mind.findEle("root");
    const previewedCss = rootEl.style.cssText;
    const applyBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Áp dụng");
    await click(applyBtn);
    expect(patchSpy).toHaveBeenCalledWith("map-7", expect.objectContaining({ preset: "study" }));
    expect(onSaved).toHaveBeenCalledWith({ version: 2, preset: "study", overrides: {} });
    expect(onClose).toHaveBeenCalled();
    expect(rootEl.style.cssText).toBe(previewedCss); // kept, not rolled back
  });

  it("on PATCH failure, rolls back to the saved appearance and shows an error without closing", async () => {
    vi.spyOn(api, "patchMindmapAppearance").mockRejectedValue(new Error("Lỗi máy chủ"));
    const onClose = vi.fn();
    const { dialog, mind } = await renderDrawer({ onClose, savedAppearance: undefined });
    const rootEl = mind.findEle("root");
    const baseline = rootEl.style.cssText;
    const studyBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Học tập");
    await click(studyBtn);
    const applyBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Áp dụng");
    await click(applyBtn);
    expect(dialog.textContent).toContain("Lỗi máy chủ");
    expect(onClose).not.toHaveBeenCalled();
    expect(rootEl.style.cssText).toBe(baseline);
  });
});
