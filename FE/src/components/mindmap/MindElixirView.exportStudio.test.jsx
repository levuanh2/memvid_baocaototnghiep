// @vitest-environment jsdom
//
// Export Studio integration: header entry point, selection mode entering
// mind-elixir's live canvas (real package, same pattern as
// MindElixirView.lifecycle.test.jsx), and the load-bearing claim that
// clicking a node in selection mode does NOT open the node-detail drawer
// (controller.onNodeSelected must not fire) — that's the one behavior a
// unit test of mindmapBranchSelectionMode.js alone can't prove, since it
// needs mind-elixir's REAL internal click handling in the loop to show the
// suppression actually beats it, not just that our own handler runs.
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixirView from "./MindElixirView";

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
      { id: "s2", kind: "section", title: "Section 2", parent: "root" },
    ],
    relations: [], sources: [], schema_version: 2,
    mindMaps: [{ id, title: `Map ${id}`, sources: [] }],
  };
}

function makeController() {
  return {
    registerMindInstance: vi.fn(), onNodeSelected: vi.fn(),
    selected: null, sidecarRef: { current: new Map() },
  };
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

describe("MindElixirView Export Studio", () => {
  it("the header 'Xuất' button opens Export Studio", async () => {
    await render(makeController());
    expect(document.body.querySelector('[role="dialog"]')).toBeFalsy();
    await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("Xuất sơ đồ");
  });

  it("closing the dialog removes it", async () => {
    await render(makeController());
    await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
    const closeBtn = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Hủy");
    await act(async () => { closeBtn.click(); });
    expect(document.body.querySelector('[role="dialog"]')).toBeFalsy();
  });

  it("entering branch selection mode from the dialog closes it and shows the selection bar", async () => {
    await render(makeController());
    await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
    const scopeRadio = document.body.querySelector('input[value="selected_branches"]');
    await act(async () => { scopeRadio.click(); });
    const enterBtn = [...document.body.querySelectorAll("button")].find((b) => b.textContent.includes("Chọn nhánh trên sơ đồ"));
    await act(async () => { enterBtn.click(); });
    expect(document.body.querySelector('[role="dialog"]')).toBeFalsy(); // dialog closed while selecting
    expect(container.querySelector(".mm-selection-bar")).toBeTruthy();
    expect(container.querySelector(".mm-selection-bar").textContent).toContain("Đã chọn 0 nhánh");
  });

  it("clicking a node while in selection mode toggles selection WITHOUT opening the node-detail drawer", async () => {
    const controller = makeController();
    await render(controller);
    await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
    await act(async () => { document.body.querySelector('input[value="selected_branches"]').click(); });
    await act(async () => {
      [...document.body.querySelectorAll("button")].find((b) => b.textContent.includes("Chọn nhánh trên sơ đồ")).click();
    });
    controller.onNodeSelected.mockClear(); // clear any incidental calls from setup above

    const s1Tpc = [...container.querySelectorAll("me-tpc")].find((t) => t.nodeObj?.id === "s1");
    await act(async () => { s1Tpc.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    expect(container.querySelector(".mm-selection-bar").textContent).toContain("Đã chọn 1 nhánh");
    expect(controller.onNodeSelected).not.toHaveBeenCalled(); // the load-bearing assertion
  });

  it("'Hủy' on the selection bar clears the selection and reopens the dialog", async () => {
    await render(makeController());
    await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
    await act(async () => { document.body.querySelector('input[value="selected_branches"]').click(); });
    await act(async () => {
      [...document.body.querySelectorAll("button")].find((b) => b.textContent.includes("Chọn nhánh trên sơ đồ")).click();
    });
    const s1Tpc = [...container.querySelectorAll("me-tpc")].find((t) => t.nodeObj?.id === "s1");
    await act(async () => { s1Tpc.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const cancelBtn = [...container.querySelectorAll(".mm-selection-bar button")].find((b) => b.textContent === "Hủy");
    await act(async () => { cancelBtn.click(); });

    expect(container.querySelector(".mm-selection-bar")).toBeFalsy();
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("Chưa chọn nhánh nào"); // selection was cleared
  });

  it("multi-branch export is explicitly blocked with a message, not silently exported as the whole map", async () => {
    await render(makeController());
    await act(async () => { container.querySelector('[aria-label="Xuất sơ đồ"]').click(); });
    await act(async () => { document.body.querySelector('input[value="selected_branches"]').click(); });
    await act(async () => {
      [...document.body.querySelectorAll("button")].find((b) => b.textContent.includes("Chọn nhánh trên sơ đồ")).click();
    });
    const s1Tpc = [...container.querySelectorAll("me-tpc")].find((t) => t.nodeObj?.id === "s1");
    await act(async () => { s1Tpc.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const continueBtn = [...container.querySelectorAll(".mm-selection-bar button")].find((b) => b.textContent === "Tiếp tục");
    await act(async () => { continueBtn.click(); });

    // Navigate to the preview step.
    for (let i = 0; i < 3; i++) {
      const nextBtn = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Tiếp tục");
      await act(async () => { nextBtn.click(); });
    }
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain("chưa được hỗ trợ");
    const exportBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Xuất"));
    expect(exportBtn.disabled).toBe(true);
  });
});
