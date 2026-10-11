// @vitest-environment jsdom
//
// Phase 2 (PR D — Mind Map 5-level expand UX), red tests written against
// CURRENT origin/main code (no implementation changes in this commit). Run
// with `npx vitest run src/components/mindmap/MindElixirView.depthLevels.test.jsx`
// and compare against the fail-before report in the audit. Same raw-harness
// pattern as MindElixirView.branchToggle.test.jsx (flat nodes+parent record,
// real MindElixirView, real mind-elixir in jsdom).
//
// Fixture: 5 distinct depths (0..4), unbalanced — one branch 4 generations
// deep (root->a->b->c->d), two shallow branches (root->f leaf, root->g->h).
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
      { id: "a", kind: "section", title: "A", parent: "root" },
      { id: "b", kind: "section", title: "B", parent: "a" },
      { id: "c", kind: "section", title: "C", parent: "b" },
      { id: "d", kind: "idea", title: "D", parent: "c" },
      { id: "f", kind: "section", title: "F", parent: "root" },
      { id: "g", kind: "section", title: "G", parent: "root" },
      { id: "h", kind: "idea", title: "H", parent: "g" },
    ],
    relations: [], sources: [], schema_version: 2,
    mindMaps: [{ id, title: `Map ${id}`, sources: [] }],
  };
}

function makeController(selected, extra = {}) {
  return {
    registerMindInstance: vi.fn(), onNodeSelected: vi.fn(), selected,
    sidecarRef: { current: new Map() },
    clearSelectedNode: vi.fn(),
    ...extra,
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

async function openMenu() {
  await act(async () => { container.querySelector(".mm-overflow-trigger").click(); });
}

function menuItemLabels() {
  return [...container.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
}

function menuItem(label) {
  return [...container.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.includes(label));
}

describe("Mind Map depth menu — target UX: exactly 5 items (RED against current main)", () => {
  it("has 'Chỉ chủ đề chính' (root-only)", async () => {
    await render(makeController(null));
    await openMenu();
    expect(menuItemLabels().some((t) => t.includes("Chỉ chủ đề chính"))).toBe(true);
  });

  it("has 'Hiện 1 tầng nhánh'", async () => {
    await render(makeController(null));
    await openMenu();
    expect(menuItemLabels().some((t) => t.includes("Hiện 1 tầng nhánh"))).toBe(true);
  });

  it("has 'Hiện 2 tầng nhánh'", async () => {
    await render(makeController(null));
    await openMenu();
    expect(menuItemLabels().some((t) => t.includes("Hiện 2 tầng nhánh"))).toBe(true);
  });

  it("has 'Hiện 3 tầng nhánh'", async () => {
    await render(makeController(null));
    await openMenu();
    expect(menuItemLabels().some((t) => t.includes("Hiện 3 tầng nhánh"))).toBe(true);
  });

  it("has 'Mở toàn bộ' (expand everything)", async () => {
    await render(makeController(null));
    await openMenu();
    expect(menuItemLabels().some((t) => t.includes("Mở toàn bộ"))).toBe(true);
  });

  it("no longer offers the old copy 'Mở đến cấp 2'/'Mở đến cấp 3'", async () => {
    await render(makeController(null));
    await openMenu();
    const labels = menuItemLabels();
    expect(labels.some((t) => t.includes("Mở đến cấp 2"))).toBe(false);
    expect(labels.some((t) => t.includes("Mở đến cấp 3"))).toBe(false);
  });

  it("the 'Cấu trúc' group offers exactly 5 depth-level items, nothing more", async () => {
    await render(makeController(null));
    await openMenu();
    const group = [...container.querySelectorAll(".mm-toolbar-menu__group")]
      .find((g) => g.getAttribute("aria-label") === "Cấu trúc");
    expect(group.querySelectorAll('[role="menuitem"]')).toHaveLength(5);
  });
});

describe("Mind Map depth menu — selected-state ARIA per level (RED: no such indicator exists today)", () => {
  it("marks the matching level as selected/current after it's applied", async () => {
    await render(makeController(null));
    await openMenu();
    const item = menuItem("Hiện 2 tầng nhánh") || menuItem("Mở đến cấp 2");
    await act(async () => { item.click(); });
    await openMenu();
    const reopened = menuItem("Hiện 2 tầng nhánh") || menuItem("Mở đến cấp 2");
    expect(reopened.getAttribute("aria-current") === "true" || reopened.getAttribute("aria-pressed") === "true").toBe(true);
  });

  it("drops the selected indicator once a manual expand/collapse breaks the preset match", async () => {
    await render(makeController(null));
    await openMenu();
    const item = menuItem("Hiện 2 tầng nhánh") || menuItem("Mở đến cấp 2");
    await act(async () => { item.click(); });
    // Manually re-expand a cutoff node via its caret, breaking the depth=2 exact match.
    await act(async () => {
      const epd = [...container.querySelectorAll("me-epd")].find((e) => e.closest("me-tpc")?.nextSibling);
      epd?.click();
    });
    await openMenu();
    const reopened = menuItem("Hiện 2 tầng nhánh") || menuItem("Mở đến cấp 2");
    expect(reopened.getAttribute("aria-current") === "true" || reopened.getAttribute("aria-pressed") === "true").toBe(false);
  });
});

describe("Mind Map depth menu — selection lifecycle when a depth change hides the selected node (RED against current expandToDepth)", () => {
  it("clears selection and canvas selection when the selected node becomes hidden", async () => {
    const clearSelectedNode = vi.fn();
    // "c" is at depth 3; collapsing to depth 2 hides it.
    await render(makeController({ id: "c" }, { clearSelectedNode }));
    await openMenu();
    const item = menuItem("Hiện 2 tầng nhánh") || menuItem("Mở đến cấp 2");
    await act(async () => { item.click(); });
    expect(clearSelectedNode).toHaveBeenCalled();
  });

  it("keeps selection when the selected node stays visible after a depth change", async () => {
    const clearSelectedNode = vi.fn();
    // "a" is at depth 1; depth<=2 keeps it visible.
    await render(makeController({ id: "a" }, { clearSelectedNode }));
    await openMenu();
    const item = menuItem("Hiện 2 tầng nhánh") || menuItem("Mở đến cấp 2");
    await act(async () => { item.click(); });
    expect(clearSelectedNode).not.toHaveBeenCalled();
  });
});

describe("Mind Map depth menu — keyboard operability (guard: native buttons already focusable)", () => {
  it("every depth menuitem is a real, focusable <button>", async () => {
    await render(makeController(null));
    await openMenu();
    const group = [...container.querySelectorAll(".mm-toolbar-menu__group")]
      .find((g) => g.getAttribute("aria-label") === "Cấu trúc");
    const items = [...group.querySelectorAll('[role="menuitem"]')];
    expect(items.length).toBeGreaterThan(0);
    items.forEach((btn) => { expect(btn.tagName).toBe("BUTTON"); });
  });
});
