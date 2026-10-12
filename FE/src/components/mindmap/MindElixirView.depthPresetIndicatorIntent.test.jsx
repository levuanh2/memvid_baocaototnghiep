// @vitest-environment jsdom
//
// Follow-up to PR D (#65). Live production smoke on a real 3-level-deep map
// found: clicking "Hiện 3 tầng nhánh" (depth 3) left "Mở toàn bộ" marked
// aria-pressed=true instead, because `matchDepthPreset` derives the active
// preset PURELY from the resulting tree shape — and on a map whose real
// depth tops out at 3, "show depth<=3" and "show everything" produce an
// IDENTICAL visible-node set (no node anywhere is left collapsed), so the
// derivation can't tell them apart and always resolves to "all".
//
// Contract (this file pins it): the indicator reflects the preset the user
// just explicitly clicked, not a re-derivation from the tree shape that
// click happened to produce. `matchDepthPreset` itself is correct and stays
// in use for: initial load (no explicit action yet) and after a manual
// caret/branch toggle (not a preset click, so no explicit choice applies).
//
// Red tests written against the CURRENT merged main (PR D, commit b299ffc)
// — no implementation changes in this commit. Same raw-harness pattern as
// MindElixirView.depthLevels.test.jsx.
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixir from "mind-elixir";
import MindElixirView from "./MindElixirView";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
});

// jsdom never computes real geometry; force valid connector `d` data after
// every real linkDiv() call, same fix every sibling MindElixirView test file
// already applies (MindElixirView.appearanceColdLoad.test.jsx etc.).
beforeEach(() => {
  const originalLinkDiv = MindElixir.prototype.linkDiv;
  vi.spyOn(MindElixir.prototype, "linkDiv").mockImplementation(function (...args) {
    const result = originalLinkDiv.apply(this, args);
    this.container.querySelectorAll(".lines path, .subLines path").forEach((path) => path.setAttribute("d", "M 10 10 L 20 20"));
    return result;
  });
});

const STUDY_APPEARANCE = {
  version: 2,
  preset: "study",
  overrides: { canvas: {}, connector: {}, node: { root: {}, branch: {}, leaf: {} } },
};

// Exactly 3 levels deep (root->a->b->c), plus a SECOND depth-1 branch that
// also has its own child (root->e->f) -- needed so collapsing "a" alone
// leaves genuine depth-1 ambiguity (matchDepthPreset's "custom" path), not a
// clean accidental match to "Hiện 1 tầng nhánh". Matches the real production
// map's shape that surfaced this bug: "Hiện 3 tầng nhánh" and "Mở toàn bộ"
// produce the SAME visible-node set on this tree.
function shallowData3(id, { appearance } = {}) {
  return {
    id, title: `Map ${id}`,
    nodes: [
      { id: "root", kind: "root", title: "Root", parent: null },
      { id: "a", kind: "section", title: "A", parent: "root" },
      { id: "b", kind: "section", title: "B", parent: "a" },
      { id: "c", kind: "idea", title: "C", parent: "b" },
      { id: "e", kind: "section", title: "E", parent: "root" },
      { id: "f", kind: "idea", title: "F", parent: "e" },
    ],
    relations: [], sources: [], schema_version: 2, appearance,
  };
}

// Exactly 2 levels deep (root->a->b) — "Hiện 3 tầng nhánh" clicked on this
// tree ALSO produces the full-tree set (nothing deeper than depth 2 exists
// to collapse), same ambiguity one level shallower.
function shallowData2(id) {
  return {
    id, title: `Map ${id}`,
    nodes: [
      { id: "root", kind: "root", title: "Root", parent: null },
      { id: "a", kind: "section", title: "A", parent: "root" },
      { id: "b", kind: "idea", title: "B", parent: "a" },
      { id: "e", kind: "section", title: "E", parent: "root" },
    ],
    relations: [], sources: [], schema_version: 2,
  };
}

// 5 distinct depths (0..4), unbalanced — same fixture MindElixirView.
// depthLevels.test.jsx uses, so depth<=3 and "all" stay genuinely distinct.
function deepData(id) {
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
  };
}

function makeController(selected = null, extra = {}) {
  return {
    registerMindInstance: vi.fn(), onNodeSelected: vi.fn(), selected,
    sidecarRef: { current: new Map() },
    clearSelectedNode: vi.fn(),
    ...extra,
  };
}

function findNodeEl(c, rawId) { return c.querySelector(`[data-nodeid="me${rawId}"]`); }

let container, root;
afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function renderMap(data, controller) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MindElixirView data={data} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
  });
}

async function openMenu() {
  await act(async () => { container.querySelector(".mm-overflow-trigger").click(); });
}

function menuItem(label) {
  return [...container.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.includes(label));
}

function depthGroupItems() {
  const group = [...container.querySelectorAll(".mm-toolbar-menu__group")]
    .find((g) => g.getAttribute("aria-label") === "Cấu trúc");
  return [...group.querySelectorAll('[role="menuitem"]')];
}

async function clickPreset(label) {
  await openMenu();
  await act(async () => { menuItem(label).click(); });
}

async function pressedLabel() {
  await openMenu();
  const pressed = depthGroupItems().filter((b) => b.getAttribute("aria-pressed") === "true");
  const label = pressed[0]?.textContent ?? null;
  await act(async () => { container.querySelector(".mm-overflow-trigger").click(); }); // close
  return { count: pressed.length, label };
}

describe("Depth preset indicator reflects explicit intent, not tree-shape re-derivation", () => {
  it("max-depth=3 tree: clicking 'Hiện 3 tầng nhánh' marks ONLY that item pressed, not 'Mở toàn bộ'", async () => {
    await renderMap(shallowData3("m1"), makeController());
    await clickPreset("Hiện 3 tầng nhánh");
    const { count, label } = await pressedLabel();
    expect(count).toBe(1);
    expect(label).toContain("Hiện 3 tầng nhánh");
  });

  it("max-depth=3 tree: clicking 'Mở toàn bộ' right after marks ONLY that item pressed", async () => {
    await renderMap(shallowData3("m1"), makeController());
    await clickPreset("Hiện 3 tầng nhánh");
    await clickPreset("Mở toàn bộ");
    const { count, label } = await pressedLabel();
    expect(count).toBe(1);
    expect(label).toContain("Mở toàn bộ");
  });

  it("max-depth=2 tree: clicking 'Hiện 3 tầng nhánh' still marks that exact item pressed", async () => {
    await renderMap(shallowData2("m1"), makeController());
    await clickPreset("Hiện 3 tầng nhánh");
    const { count, label } = await pressedLabel();
    expect(count).toBe(1);
    expect(label).toContain("Hiện 3 tầng nhánh");
  });

  it("clicking the same preset twice is idempotent (still exactly that one pressed)", async () => {
    await renderMap(shallowData3("m1"), makeController());
    await clickPreset("Hiện 3 tầng nhánh");
    await clickPreset("Hiện 3 tầng nhánh");
    const { count, label } = await pressedLabel();
    expect(count).toBe(1);
    expect(label).toContain("Hiện 3 tầng nhánh");
  });

  it("a manual caret toggle after a preset click drops the indicator to custom (no item pressed)", async () => {
    await renderMap(shallowData3("m1"), makeController());
    await clickPreset("Hiện 3 tầng nhánh");
    await act(async () => {
      const tpcA = container.querySelector('[data-nodeid="mea"]');
      const epd = tpcA?.parentElement?.querySelector("me-epd");
      epd?.click();
    });
    const { count } = await pressedLabel();
    expect(count).toBe(0);
  });

  it("switching A (shallow) -> B (deep) -> A does not leak the explicit preset across map identities", async () => {
    const controller = makeController();
    await renderMap(shallowData3("mapA"), controller);
    await clickPreset("Hiện 3 tầng nhánh");
    let r = await pressedLabel();
    expect(r.label).toContain("Hiện 3 tầng nhánh");

    await act(async () => {
      root.render(<MindElixirView data={deepData("mapB")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    // Map B is freshly loaded and fully expanded by default (no explicit
    // action yet on it) -- matchDepthPreset's own initial-inference applies.
    r = await pressedLabel();
    expect(r.label).toContain("Mở toàn bộ");

    await act(async () => {
      root.render(<MindElixirView data={shallowData3("mapA")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />);
    });
    // Back to map A's identity: no stale "Hiện 3 tầng nhánh" explicit choice
    // should survive -- it's a fresh load of this id again.
    r = await pressedLabel();
    expect(r.label).toContain("Mở toàn bộ");
  });

  it("Enter activates a depth-preset menuitem the same way a click does", async () => {
    await renderMap(shallowData3("m1"), makeController());
    await openMenu();
    const item = menuItem("Hiện 3 tầng nhánh");
    item.focus();
    await act(async () => { item.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); item.click(); });
    const { count, label } = await pressedLabel();
    expect(count).toBe(1);
    expect(label).toContain("Hiện 3 tầng nhánh");
  });

  it("node/connector counts still match depth exactly after the fix (no regression to PR D's own contract)", async () => {
    await renderMap(shallowData3("m1"), makeController());
    await clickPreset("Hiện 3 tầng nhánh");
    // root, a, b, c, e, f = 6 nodes; 5 edges (e/f both within depth<=3).
    expect(container.querySelectorAll("me-tpc").length).toBe(6);
    expect(container.querySelectorAll(".lines path, .subLines path").length).toBe(5);
  });
});

describe("Depth preset indicator fix does not disturb Appearance V2", () => {
  it("a saved appearance survives every depth-preset change, including the depth3==all edge case", async () => {
    vi.useFakeTimers();
    await renderMap(shallowData3("m1", { appearance: STUDY_APPEARANCE }), makeController());
    const el = container.querySelector(".me-container");
    Object.defineProperty(el, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 300, configurable: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(findNodeEl(container, "root").style.borderRadius).toBe("10px");

    await clickPreset("Hiện 3 tầng nhánh");
    expect(findNodeEl(container, "root").style.borderRadius).toBe("10px");

    await clickPreset("Mở toàn bộ");
    expect(findNodeEl(container, "root").style.borderRadius).toBe("10px");
  });
});
