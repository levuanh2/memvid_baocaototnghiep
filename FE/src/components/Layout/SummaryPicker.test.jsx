// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import SummaryPicker from "./SummaryPicker";
import WorkspaceEmptyState from "./WorkspaceEmptyState";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container, root;
afterEach(() => { act(() => root?.unmount()); container?.remove(); container = root = null; });
function render(ui) {
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container); act(() => root.render(ui));
}
const ITEMS = [{ id: "s1", title: "Tóm tắt A" }, { id: "s2", title: "Tóm tắt B" }];

describe("SummaryPicker", () => {
  it("selecting a saved summary passes the whole record", () => {
    const onSelect = vi.fn();
    render(<SummaryPicker items={ITEMS} onSelect={onSelect} />);
    const select = container.querySelector('select[aria-label="Chọn tóm tắt"]');
    act(() => { select.value = "s2"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onSelect).toHaveBeenCalledWith(ITEMS[1]);
  });

  it("hides the select when there are no summaries and disables create while creating", () => {
    render(<SummaryPicker items={[]} onCreate={() => {}} creating />);
    expect(container.querySelector("select")).toBeNull();
    const button = container.querySelector("button");
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });
});

describe("WorkspaceEmptyState summary", () => {
  it("shows the summary job label while creating instead of a dead CTA", () => {
    render(<WorkspaceEmptyState kind="summary" selectedCount={1} creating jobLabel="Đang tóm tắt…" />);
    expect(container.textContent).toContain("Đang tóm tắt…");
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders extra content (saved-summary picker) under the CTA", () => {
    render(<WorkspaceEmptyState kind="summary" selectedCount={0}><span data-testid="extra">x</span></WorkspaceEmptyState>);
    expect(container.querySelector('[data-testid="extra"]')).not.toBeNull();
  });
});
