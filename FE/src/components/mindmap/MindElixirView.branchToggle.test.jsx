// @vitest-environment jsdom
//
// Round 8 redesign: one contextual branch toggle (not two always-present
// buttons), global expand/collapse + depth presets moved to the overflow
// menu, and the hard viewport invariant from the brief — none of these
// actions may call scaleFit or toCenter. Uses the REAL mind-elixir package
// in jsdom (same pattern as MindElixirView.lifecycle.test.jsx), not a hand
// mock, so these assertions exercise the actual library behavior.
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
      { id: "i1", kind: "idea", title: "Idea 1", parent: "s1" },
      { id: "leaf", kind: "section", title: "Leaf Section", parent: "root" },
    ],
    relations: [], sources: [], schema_version: 2,
    mindMaps: [{ id, title: `Map ${id}`, sources: [] }],
  };
}

function makeController(selected, onRegister) {
  return {
    registerMindInstance: onRegister || vi.fn(),
    onNodeSelected: vi.fn(), selected, sidecarRef: { current: new Map() },
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

describe("MindElixirView branch toggle (Round 8 redesign)", () => {
  it("shows no contextual branch toggle when nothing is selected", async () => {
    await render(makeController(null));
    expect(container.querySelector('[aria-label="Thu nhánh"]')).toBeNull();
    expect(container.querySelector('[aria-label="Mở nhánh"]')).toBeNull();
  });

  it("shows no contextual branch toggle when the selected node is a leaf", async () => {
    await render(makeController({ id: "i1" }));
    expect(container.querySelector('[aria-label="Thu nhánh"]')).toBeNull();
    expect(container.querySelector('[aria-label="Mở nhánh"]')).toBeNull();
  });

  it("shows the toggle labeled 'Thu nhánh' with aria-expanded=true for an expanded node with children", async () => {
    await render(makeController({ id: "s1" }));
    const btn = container.querySelector('[aria-label="Thu nhánh"]');
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("clicking the toggle collapses the branch and flips the label to 'Mở nhánh'", async () => {
    await render(makeController({ id: "s1" }));
    await act(async () => { container.querySelector('[aria-label="Thu nhánh"]').click(); });
    expect(container.querySelector('[aria-label="Mở nhánh"]')).toBeTruthy();
  });

  it("toggling the branch does not call scaleFit (viewport must not reset)", async () => {
    let mind = null;
    await render(makeController({ id: "s1" }, (m) => { mind = m; }));
    const fitSpy = vi.spyOn(mind, "scaleFit");
    await act(async () => { container.querySelector('[aria-label="Thu nhánh"]').click(); });
    expect(fitSpy).not.toHaveBeenCalled();
  });

  it("overflow menu offers global expand/collapse-all and depth presets", async () => {
    await render(makeController(null));
    await act(async () => { container.querySelector(".mm-overflow-trigger").click(); });
    const items = [...container.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
    expect(items.some((t) => t.includes("Mở rộng tất cả"))).toBe(true);
    expect(items.some((t) => t.includes("Thu gọn về chủ đề chính"))).toBe(true);
    expect(items.some((t) => t.includes("Mở đến cấp 2"))).toBe(true);
    expect(items.some((t) => t.includes("Mở đến cấp 3"))).toBe(true);
  });

  it("'Mở rộng tất cả' targets the map root regardless of the current selection, and does not call scaleFit", async () => {
    let mind = null;
    await render(makeController({ id: "i1" }, (m) => { mind = m; }));
    const fitSpy = vi.spyOn(mind, "scaleFit");
    const expandAllSpy = vi.spyOn(mind, "expandNodeAll");
    await act(async () => { container.querySelector(".mm-overflow-trigger").click(); });
    const item = [...container.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.includes("Mở rộng tất cả"));
    await act(async () => { item.click(); });
    expect(fitSpy).not.toHaveBeenCalled();
    expect(expandAllSpy).toHaveBeenCalled();
    expect(expandAllSpy.mock.calls[0][0].nodeObj.id).toBe("root"); // root, not the selected "i1"
  });

  it("'Mở đến cấp 2' does not call scaleFit or toCenter", async () => {
    let mind = null;
    await render(makeController(null, (m) => { mind = m; }));
    const fitSpy = vi.spyOn(mind, "scaleFit");
    const centerSpy = vi.spyOn(mind, "toCenter");
    await act(async () => { container.querySelector(".mm-overflow-trigger").click(); });
    const item = [...container.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.includes("Mở đến cấp 2"));
    await act(async () => { item.click(); });
    expect(fitSpy).not.toHaveBeenCalled();
    expect(centerSpy).not.toHaveBeenCalled();
  });

  it("per-node caret elements are decorated with role/tabindex/aria-expanded", async () => {
    await render(makeController(null));
    const epds = container.querySelectorAll("me-epd");
    expect(epds.length).toBeGreaterThan(0); // root and s1 both have children
    epds.forEach((epd) => {
      expect(epd.getAttribute("role")).toBe("button");
      expect(epd.tabIndex).toBe(0);
      expect(["true", "false"]).toContain(epd.getAttribute("aria-expanded"));
    });
  });

  it("leaf nodes render no caret at all", async () => {
    await render(makeController(null));
    // "leaf" and "i1" are the two leaf nodes in dataFor() — neither has a
    // <me-tpc> whose sibling <me-epd> exists (mind-elixir only appends one
    // when the node actually has children).
    const leafTpc = [...container.querySelectorAll("me-tpc")].find((t) => t.nodeObj?.id === "leaf");
    expect(leafTpc).toBeTruthy();
    expect(leafTpc.parentElement.querySelector("me-epd")).toBeNull();
  });
});
