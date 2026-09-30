// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { attachBranchSelectionMode } from "./mindmapBranchSelectionMode";

let handle;
afterEach(() => { handle?.detach(); handle = null; document.body.innerHTML = ""; });

function buildParent({ id, topic }) {
  const parent = document.createElement("me-parent");
  const tpc = document.createElement("me-tpc");
  tpc.nodeObj = { id, topic };
  parent.appendChild(tpc);
  return parent;
}

describe("attachBranchSelectionMode", () => {
  it("injects no checkbox while inactive", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(buildParent({ id: "a", topic: "Alpha" }));
    const isActiveRef = { current: false };
    handle = attachBranchSelectionMode(container, { isActiveRef, isSelectedFn: () => false, onToggle: vi.fn() });
    await Promise.resolve();
    expect(container.querySelector("me-export-check")).toBeNull();
  });

  it("injects a checkbox per node once active, reflecting current selection", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(buildParent({ id: "a", topic: "Alpha" }));
    const isActiveRef = { current: true };
    const selected = new Set(["a"]);
    handle = attachBranchSelectionMode(container, { isActiveRef, isSelectedFn: (id) => selected.has(id), onToggle: vi.fn() });
    await Promise.resolve();
    const check = container.querySelector("me-export-check");
    expect(check).toBeTruthy();
    expect(check.getAttribute("role")).toBe("checkbox");
    expect(check.getAttribute("aria-checked")).toBe("true");
  });

  it("clicking the checkbox calls onToggle with the node id and does not bubble further", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(buildParent({ id: "a", topic: "Alpha" }));
    const isActiveRef = { current: true };
    const onToggle = vi.fn();
    handle = attachBranchSelectionMode(container, { isActiveRef, isSelectedFn: () => false, onToggle });
    await Promise.resolve();

    const outerClick = vi.fn();
    document.body.addEventListener("click", outerClick);
    container.querySelector("me-export-check").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onToggle).toHaveBeenCalledWith("a");
    expect(outerClick).not.toHaveBeenCalled();
    document.body.removeEventListener("click", outerClick);
  });

  it("clicking the node's own label (me-tpc) ALSO toggles selection, and suppresses the click from reaching mind-elixir's own listeners", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(buildParent({ id: "a", topic: "Alpha" }));
    const isActiveRef = { current: true };
    const onToggle = vi.fn();
    handle = attachBranchSelectionMode(container, { isActiveRef, isSelectedFn: () => false, onToggle });
    await Promise.resolve();

    const outerClick = vi.fn();
    document.body.addEventListener("click", outerClick);
    container.querySelector("me-tpc").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onToggle).toHaveBeenCalledWith("a");
    expect(outerClick).not.toHaveBeenCalled(); // stopPropagation reached before mind-elixir's own bubble-phase handler would
    document.body.removeEventListener("click", outerClick);
  });

  it("suppresses pointerdown on the label without toggling (avoids a double-toggle alongside the click)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(buildParent({ id: "a", topic: "Alpha" }));
    const isActiveRef = { current: true };
    const onToggle = vi.fn();
    handle = attachBranchSelectionMode(container, { isActiveRef, isSelectedFn: () => false, onToggle });
    await Promise.resolve();

    const outerDown = vi.fn();
    document.body.addEventListener("pointerdown", outerDown);
    container.querySelector("me-tpc").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(outerDown).not.toHaveBeenCalled();
    document.body.removeEventListener("pointerdown", outerDown);
  });

  it("does nothing when inactive — clicking the label does not toggle and does not suppress", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(buildParent({ id: "a", topic: "Alpha" }));
    const isActiveRef = { current: false };
    const onToggle = vi.fn();
    handle = attachBranchSelectionMode(container, { isActiveRef, isSelectedFn: () => false, onToggle });
    await Promise.resolve();

    const outerClick = vi.fn();
    document.body.addEventListener("click", outerClick);
    container.querySelector("me-tpc").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(outerClick).toHaveBeenCalledTimes(1); // not suppressed — reaches normal listeners
    document.body.removeEventListener("click", outerClick);
  });

  it("resync() updates an already-rendered checkbox's aria-checked without any DOM mutation (external selection change, e.g. clear-all)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(buildParent({ id: "a", topic: "Alpha" }));
    const isActiveRef = { current: true };
    let selected = new Set(["a"]);
    handle = attachBranchSelectionMode(container, { isActiveRef, isSelectedFn: (id) => selected.has(id), onToggle: vi.fn() });
    await Promise.resolve();
    expect(container.querySelector("me-export-check").getAttribute("aria-checked")).toBe("true");

    selected = new Set(); // e.g. a "Xóa chọn" button clearing React state — no DOM change at all
    handle.resync();
    expect(container.querySelector("me-export-check").getAttribute("aria-checked")).toBe("false");
  });

  it("resync() after isActiveRef flips to false removes every already-injected checkbox (mode-off cleanup, not just 'no new ones')", async () => {
    // Root cause this guards: `scan()` used to just `return` when inactive,
    // which correctly stopped creating NEW checkboxes but left whatever was
    // already in the DOM untouched — turning selection mode off (the
    // dialog's own "Tiếp tục"/"Hủy" buttons, which flip isActiveRef then
    // call resync()) left every already-rendered `<me-export-check>` sitting
    // on the live canvas, fully clickable once the separate pointer-events
    // bug was fixed. The "injects no checkbox while inactive" test above
    // only covers starting inactive — this covers the actual transition.
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(buildParent({ id: "a", topic: "Alpha" }));
    const isActiveRef = { current: true };
    handle = attachBranchSelectionMode(container, { isActiveRef, isSelectedFn: () => false, onToggle: vi.fn() });
    await Promise.resolve();
    expect(container.querySelector("me-export-check")).toBeTruthy();

    isActiveRef.current = false; // e.g. "Tiếp tục"/"Hủy" setting selectionModeActive(false)
    handle.resync();
    expect(container.querySelector("me-export-check")).toBeNull();
  });

  it("detach() removes every injected checkbox and stops further decoration", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(buildParent({ id: "a", topic: "Alpha" }));
    const isActiveRef = { current: true };
    const h = attachBranchSelectionMode(container, { isActiveRef, isSelectedFn: () => false, onToggle: vi.fn() });
    await Promise.resolve();
    expect(container.querySelector("me-export-check")).toBeTruthy();
    h.detach();
    expect(container.querySelector("me-export-check")).toBeNull();
    handle = null;
  });
});
