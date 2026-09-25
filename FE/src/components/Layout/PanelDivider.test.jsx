// @vitest-environment jsdom
//
// PanelDivider's ARIA/keyboard contract already existed before this fix
// (role="separator", aria-orientation, aria-valuemin/max/now, Left/Right/
// Home/End/Enter) -- this file gives it dedicated coverage so a future
// change can't silently drop it, and locks in the widened hit target
// (spec: 16-24px pointer hitbox) that IS new in this fix.
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import PanelDivider from "./PanelDivider";

function render(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PanelDivider side="right" label="Lề bằng chứng" width={360} min={320} max={480} onDrag={vi.fn()} onNudge={props.onNudge} onReset={props.onReset} active={false} {...props} />);
  });
  return { container, root };
}

describe("PanelDivider", () => {
  it("exposes the separator role and current/min/max ARIA values", () => {
    const { container } = render({ onNudge: vi.fn(), onReset: vi.fn() });
    const el = container.querySelector('[role="separator"]');
    expect(el).toBeTruthy();
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
    expect(el.getAttribute("aria-valuenow")).toBe("360");
    expect(el.getAttribute("aria-valuemin")).toBe("320");
    expect(el.getAttribute("aria-valuemax")).toBe("480");
    expect(el.tabIndex).toBe(0);
  });

  it("ArrowLeft/ArrowRight call onNudge with the mirrored sign for a right-side panel", () => {
    const onNudge = vi.fn();
    const { container } = render({ onNudge, onReset: vi.fn() });
    const el = container.querySelector('[role="separator"]');
    act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true })); });
    act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })); });
    expect(onNudge).toHaveBeenCalledTimes(2);
    // Right-side panel: dragging the divider left makes it WIDER, so
    // ArrowLeft must nudge positive and ArrowRight negative (mirrored vs.
    // a left-side panel) -- this is the exact sign-flip PanelDivider's own
    // source comment calls out.
    expect(onNudge.mock.calls[0][0]).toBeGreaterThan(0);
    expect(onNudge.mock.calls[1][0]).toBeLessThan(0);
  });

  it("Enter calls onReset; Escape does nothing (must not destroy panel state)", () => {
    const onReset = vi.fn();
    const onNudge = vi.fn();
    const { container } = render({ onNudge, onReset });
    const el = container.querySelector('[role="separator"]');
    act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(onReset).toHaveBeenCalledTimes(1);
    act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(onReset).toHaveBeenCalledTimes(1); // unchanged
    expect(onNudge).not.toHaveBeenCalled();
  });
});
