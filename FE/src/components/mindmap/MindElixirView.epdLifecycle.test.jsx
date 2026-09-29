// @vitest-environment jsdom
//
// Round 2, section 1: audit the <me-epd> decorator through every real
// lifecycle trigger, not just one initial decoration pass. Uses the REAL
// mind-elixir package (same pattern as MindElixirView.lifecycle.test.jsx).
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MindElixir from "mind-elixir";
import MindElixirView from "./MindElixirView";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
});

function dataFor(id, { deep = false } = {}) {
  const nodes = [
    { id: "root", kind: "root", title: "Root", parent: null },
    { id: "s1", kind: "section", title: `S1-${id}`, parent: "root" },
    { id: "i1", kind: "idea", title: "I1", parent: "s1" },
  ];
  if (deep) {
    // "s1" starts COLLAPSED — mind-elixir renders NO DOM at all for a
    // collapsed node's children (verified in the round-1 audit), so "i1"'s
    // own caret (it has a child "i1x") does not exist in the DOM until s1
    // is expanded — the case that actually exercises "newly revealed
    // carets get decorated too", not just "existing ones survive".
    nodes.push({ id: "i1x", kind: "idea", title: "I1X", parent: "i1" });
  }
  return {
    id, title: `Map ${id}`, nodes, relations: [], sources: [], schema_version: 2,
    mindMaps: [{ id, title: `Map ${id}`, sources: [] }],
  };
}

function makeController(onSelected) {
  return {
    registerMindInstance: vi.fn(), onNodeSelected: onSelected || vi.fn(),
    selected: null, sidecarRef: { current: new Map() },
  };
}

let container, root;
afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
});

function pressEnter(epd) {
  epd.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

function findEpdFor(root_, id) {
  const tpc = [...root_.querySelectorAll("me-tpc")].find((t) => t.nodeObj?.id === id);
  return tpc?.parentElement?.querySelector("me-epd") || null;
}

describe("<me-epd> decorator lifecycle audit (Round 2)", () => {
  it("1. initial render: caret decorated on first mount, keyboard activation reaches mind-elixir's real expandNode exactly once", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let mind = null;
    const controller = makeController();
    controller.registerMindInstance = vi.fn((m) => { mind = m; });
    await act(async () => { root.render(<MindElixirView data={dataFor("m1")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />); });

    const epd = findEpdFor(container, "s1");
    expect(epd.getAttribute("role")).toBe("button");
    const expandNodeSpy = vi.spyOn(mind, "expandNode");
    await act(async () => { pressEnter(epd); });
    expect(expandNodeSpy).toHaveBeenCalledTimes(1);
  });

  it("2. refresh() (map switch): caret re-decorated on the NEW map's own elements, no leaked listener calls from the old map's discarded elements", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let mind = null;
    const controller = makeController();
    controller.registerMindInstance = vi.fn((m) => { mind = m; });
    await act(async () => { root.render(<MindElixirView data={dataFor("m1")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />); });

    const oldEpd = findEpdFor(container, "s1");
    await act(async () => { root.render(<MindElixirView data={dataFor("m2")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />); });

    const newEpd = findEpdFor(container, "s1");
    expect(newEpd).toBeTruthy();
    expect(newEpd).not.toBe(oldEpd); // refresh() really did replace the DOM node, not mutate it in place
    expect(newEpd.getAttribute("role")).toBe("button"); // re-decorated on the new element
    expect(container.contains(oldEpd)).toBe(false); // the old element is really gone

    const expandNodeSpy = vi.spyOn(mind, "expandNode");
    await act(async () => { pressEnter(newEpd); });
    expect(expandNodeSpy).toHaveBeenCalledTimes(1); // not 2 — no ghost listener from the discarded element
  });

  it("3. map A -> B -> A: decoration re-applies correctly every time, not just once", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const controller = makeController();
    const renderMap = async (id) => {
      await act(async () => { root.render(<MindElixirView data={dataFor(id)} onRegenerate={vi.fn()} regenerating={false} controller={controller} />); });
    };
    await renderMap("mA");
    expect(findEpdFor(container, "s1").getAttribute("role")).toBe("button");
    await renderMap("mB");
    expect(findEpdFor(container, "s1").getAttribute("role")).toBe("button");
    await renderMap("mA");
    expect(findEpdFor(container, "s1").getAttribute("role")).toBe("button");
  });

  it("4. theme toggle (html.dark class flip): existing decoration survives, no duplicate keydown listener accumulates", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let mind = null;
    const controller = makeController();
    controller.registerMindInstance = vi.fn((m) => { mind = m; });
    await act(async () => { root.render(<MindElixirView data={dataFor("m1")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />); });

    await act(async () => { document.documentElement.classList.add("dark"); });
    await new Promise((r) => setTimeout(r, 0)); // let the MutationObserver microtask settle

    const epd = findEpdFor(container, "s1");
    expect(epd.getAttribute("role")).toBe("button");
    expect(epd.getAttribute("aria-expanded")).toBeTruthy();
    const expandNodeSpy = vi.spyOn(mind, "expandNode");
    await act(async () => { pressEnter(epd); });
    expect(expandNodeSpy).toHaveBeenCalledTimes(1); // still exactly one — theme toggle didn't double-bind
    document.documentElement.classList.remove("dark");
  });

  it("5. fullscreen toggle: presentation-only, does not touch mind-elixir's DOM — decoration untouched, same element instance", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const controller = makeController();
    await act(async () => { root.render(<MindElixirView data={dataFor("m1")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />); });
    const before = findEpdFor(container, "s1");

    const fsBtn = container.querySelector('[aria-label="Toàn màn hình"]');
    await act(async () => { fsBtn.click(); });

    const after = findEpdFor(container, "s1");
    expect(after).toBe(before); // same DOM node — fullscreen never rebuilt the tree
    expect(after.getAttribute("role")).toBe("button");
  });

  it("6. expand-all: newly-revealed nested carets (previously not in the DOM at all under a collapsed node) get decorated too", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let mind = null;
    const controller = makeController();
    controller.registerMindInstance = vi.fn((m) => { mind = m; });
    // "i1" has a child "i1x", so it has its own caret once rendered.
    const data = dataFor("m1", { deep: true });
    await act(async () => { root.render(<MindElixirView data={data} onRegenerate={vi.fn()} regenerating={false} controller={controller} />); });

    // The record format has no "starts collapsed" field (recordToMindElixir
    // never sets `expanded` -- every node renders expanded by default), so
    // collapsing "s1" first, the same way a real caret click would (via
    // mind-elixir's own public expandNode), is what actually removes "i1"'s
    // caret from the DOM entirely -- not a test fixture flag.
    const s1Topic = mind.findEle("s1");
    await act(async () => { mind.expandNode(s1Topic, false); });
    expect(findEpdFor(container, "i1")).toBeNull(); // i1 itself isn't even rendered while its parent s1 is collapsed

    await act(async () => {
      container.querySelector(".mm-overflow-trigger").click();
    });
    const item = [...document.body.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.includes("Mở rộng tất cả"));
    await act(async () => { item.click(); });

    const i1Epd = findEpdFor(container, "i1");
    expect(i1Epd).toBeTruthy(); // now rendered
    expect(i1Epd.getAttribute("role")).toBe("button"); // AND decorated -- not just present
  });

  it("7. unmount/remount: the observer is disconnected on unmount (no error triggering more mutations after), and a fresh mount gets its own working decoration", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const controller = makeController();
    await act(async () => { root.render(<MindElixirView data={dataFor("m1")} onRegenerate={vi.fn()} regenerating={false} controller={controller} />); });
    expect(findEpdFor(container, "s1")).toBeTruthy();

    await act(async () => { root.unmount(); });
    // Unmount wipes containerRef.current.innerHTML -- confirm no error was
    // thrown reaching this point (an observer still firing against a
    // disconnected/removed tree would be the failure mode here).
    expect(container.innerHTML).toBe("");

    // Fresh remount into the SAME container div -- a brand new component
    // instance must decorate correctly, proving the old instance's
    // teardown didn't leave anything broken behind for the next one.
    const root2 = createRoot(container);
    const controller2 = makeController();
    await act(async () => { root2.render(<MindElixirView data={dataFor("m2")} onRegenerate={vi.fn()} regenerating={false} controller={controller2} />); });
    expect(findEpdFor(container, "s1").getAttribute("role")).toBe("button");
    await act(async () => root2.unmount());
  });
});
