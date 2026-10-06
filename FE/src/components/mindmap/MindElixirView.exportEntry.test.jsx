// @vitest-environment jsdom
//
// Export entry ownership: the toolbar `.mm-export-trigger` is the only export
// trigger, the overflow menu carries no duplicate export action, and the dialog
// copy is "Xuất sơ đồ" with the new subtitle (no "Export Studio" in UI copy).
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixirView from "./MindElixirView";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

const DATA = {
  id: "map-export-entry", title: "Export entry", schema_version: 3,
  nodes: [
    { id: "root", kind: "root", title: "Root", parent: null },
    { id: "a", kind: "section", title: "Branch", parent: "root" },
  ],
  relations: [], sources: [],
};
const CONTROLLER = { registerMindInstance: vi.fn(), onNodeSelected: vi.fn(), selected: null, sidecarRef: { current: new Map() } };
let container;
let root;

afterEach(async () => {
  if (root) { await act(async () => { root.unmount(); }); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
});

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MindElixirView data={DATA} onRegenerate={vi.fn()} regenerating={false} controller={CONTROLLER} />);
  });
}

const EXPORT_WORD = /export studio|xuất|export/i;

describe("Mind Map export entry", () => {
  it("exposes exactly one visible export trigger in the toolbar", async () => {
    await mount();
    const triggers = [...container.querySelectorAll(".mm-export-trigger")];
    expect(triggers).toHaveLength(1);
    expect(triggers[0].getAttribute("aria-label")).toBe("Xuất sơ đồ");
  });

  it("overflow menu carries no duplicate export action", async () => {
    await mount();
    const overflow = container.querySelector('button[aria-label="Thêm tùy chọn"]');
    expect(overflow).toBeTruthy();
    await act(async () => { overflow.click(); });
    const items = [...container.querySelectorAll('[role="menu"] [role="menuitem"]')];
    const exportItems = items.filter((el) => EXPORT_WORD.test(el.textContent || ""));
    expect(exportItems.map((el) => el.textContent.trim())).toEqual([]);
    // An empty export group heading must not survive either.
    expect(container.querySelector('[role="menu"] [aria-label="Xuất sơ đồ"]')).toBeNull();
  });

  it("the trigger opens the Xuất sơ đồ dialog with the new subtitle and no Export Studio copy", async () => {
    await mount();
    const trigger = container.querySelector(".mm-export-trigger");
    await act(async () => { trigger.click(); });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("Xuất sơ đồ");
    expect(dialog.textContent).toContain("Chọn phạm vi, định dạng và cách trình bày");
    expect(dialog.textContent).not.toMatch(/Export Studio/);
  });
});
