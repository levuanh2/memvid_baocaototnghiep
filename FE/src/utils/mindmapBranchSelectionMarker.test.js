// @vitest-environment jsdom
//
// Branch-selection marker shell: side-aware placement and keyboard toggle.
// Side comes from mind-elixir's own `me-main` class (`lhs` / `rhs`); the root
// has no `me-main` ancestor and is marked "root". Selection logic is unchanged.
import { describe, it, expect, vi, afterEach } from "vitest";
import { attachBranchSelectionMode } from "./mindmapBranchSelectionMode";

let host;

afterEach(() => {
  if (host) host.remove();
  host = null;
});

function build(sideClass) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <me-root><me-tpc></me-tpc></me-root>`;
  const root = wrapper.querySelector("me-root");
  root.querySelector("me-tpc").nodeObj = { id: "root", topic: "Gốc" };
  host.appendChild(root);
  if (sideClass) {
    const main = document.createElement("me-main");
    main.className = sideClass;
    const w = document.createElement("me-wrapper");
    const p = document.createElement("me-parent");
    const tpc = document.createElement("me-tpc");
    tpc.nodeObj = { id: "n1", topic: "Nhánh một" };
    p.appendChild(tpc);
    w.appendChild(p);
    main.appendChild(w);
    host.appendChild(main);
  }
  return host;
}

describe("branch selection marker shell", () => {
  it("marks a left-branch marker with data-side=left", () => {
    build("lhs");
    attachBranchSelectionMode(host, { isActiveRef: { current: true }, isSelectedFn: () => false, onToggle: vi.fn() });
    const check = host.querySelector("me-parent > me-export-check");
    expect(check).toBeTruthy();
    expect(check.dataset.side).toBe("left");
  });

  it("marks a right-branch marker with data-side=right", () => {
    build("rhs");
    attachBranchSelectionMode(host, { isActiveRef: { current: true }, isSelectedFn: () => false, onToggle: vi.fn() });
    expect(host.querySelector("me-parent > me-export-check").dataset.side).toBe("right");
  });

  it("marks the root marker with data-side=root", () => {
    build(null);
    attachBranchSelectionMode(host, { isActiveRef: { current: true }, isSelectedFn: () => false, onToggle: vi.fn() });
    expect(host.querySelector("me-root > me-export-check").dataset.side).toBe("root");
  });

  it("toggles on Space and on Enter with the keyboard, and reflects aria-checked", () => {
    build("rhs");
    const onToggle = vi.fn();
    let selected = false;
    attachBranchSelectionMode(host, { isActiveRef: { current: true }, isSelectedFn: () => selected, onToggle });
    const check = host.querySelector("me-parent > me-export-check");
    expect(check.getAttribute("role")).toBe("checkbox");
    expect(check.getAttribute("aria-checked")).toBe("false");
    check.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(onToggle).toHaveBeenCalledWith("n1");
    check.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});
