// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { attachExpandDecorator } from "./mindElixirExpandDecorator";

let cleanup;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ""; });

// Mirrors mind-elixir's real DOM shape: <me-epd> is a sibling of <me-tpc>
// inside <me-parent>, and <me-tpc>.nodeObj is the live node data object
// (verified against node_modules/mind-elixir/dist/MindElixir.js — this is
// not an invented shape).
function buildParent({ id, topic, children = [], expanded = true }) {
  const parent = document.createElement("me-parent");
  const tpc = document.createElement("me-tpc");
  tpc.nodeObj = { id, topic, children, expanded };
  parent.appendChild(tpc);
  if (children.length) {
    const epd = document.createElement("me-epd");
    if (expanded) epd.className = "minus";
    parent.appendChild(epd);
  }
  return parent;
}

describe("attachExpandDecorator", () => {
  it("sets role/tabindex/aria-expanded/aria-label on an expanded node's caret", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(buildParent({ id: "a", topic: "Alpha", children: [{ id: "a1" }], expanded: true }));
    cleanup = attachExpandDecorator(container);
    await Promise.resolve();

    const epd = container.querySelector("me-epd");
    expect(epd.getAttribute("role")).toBe("button");
    expect(epd.tabIndex).toBe(0);
    expect(epd.getAttribute("aria-expanded")).toBe("true");
    expect(epd.getAttribute("aria-label")).toBe("Thu nhánh: Alpha");
  });

  it("sets aria-expanded=false and a hidden-descendant-count badge data attribute for a collapsed node", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const grandchildren = [{ id: "a1", children: [{ id: "a1x", children: [] }] }, { id: "a2", children: [] }];
    container.appendChild(buildParent({ id: "a", topic: "Alpha", children: grandchildren, expanded: false }));
    cleanup = attachExpandDecorator(container);
    await Promise.resolve();

    const epd = container.querySelector("me-epd");
    expect(epd.getAttribute("aria-expanded")).toBe("false");
    expect(epd.getAttribute("aria-label")).toBe("Mở nhánh: Alpha");
    // 3 hidden descendants: a1, a1x, a2
    expect(epd.dataset.hiddenCount).toBe("3");
  });

  it("does not inject any child element into <me-epd> (would break mind-elixir's raw event.target.tagName click check)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(buildParent({ id: "a", topic: "Alpha", children: [{ id: "a1" }], expanded: false }));
    cleanup = attachExpandDecorator(container);
    await Promise.resolve();

    const epd = container.querySelector("me-epd");
    expect(epd.children.length).toBe(0);
  });

  it("Enter/Space on the caret triggers a real click on the <me-epd> element itself", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(buildParent({ id: "a", topic: "Alpha", children: [{ id: "a1" }], expanded: true }));
    cleanup = attachExpandDecorator(container);
    await Promise.resolve();

    const epd = container.querySelector("me-epd");
    const onClick = vi.fn();
    epd.addEventListener("click", onClick);
    epd.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
    epd.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("re-scanning an already-decorated element does not double-bind the keydown listener", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(buildParent({ id: "a", topic: "Alpha", children: [{ id: "a1" }], expanded: true }));
    cleanup = attachExpandDecorator(container);
    await Promise.resolve();

    // Trigger a second mutation batch (an unrelated sibling addition) so the
    // observer re-scans the whole container, including the already-bound epd.
    const other = document.createElement("div");
    container.appendChild(other);
    await Promise.resolve();

    const epd = container.querySelector("me-epd");
    const onClick = vi.fn();
    epd.addEventListener("click", onClick);
    epd.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(1); // not 2 — listener bound exactly once
  });

  it("leaf nodes have no <me-epd> at all, so nothing to decorate (matches mind-elixir's own gating)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(buildParent({ id: "leaf", topic: "Leaf", children: [] }));
    cleanup = attachExpandDecorator(container);
    await Promise.resolve();
    expect(container.querySelector("me-epd")).toBeNull();
  });
});
