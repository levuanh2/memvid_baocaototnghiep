// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import StudyToolsMenu from "./StudyToolsMenu";

vi.mock("../ui/Icon", () => ({ Icon: ({ name }) => <span data-icon={name} /> }));

let container;
afterEach(() => {
  if (container) document.body.removeChild(container);
  container = null;
});

// Mobile theme control PR — focus-restoration contract (StudyToolsMenu owns
// this for every action, existing or new; the trigger lives outside this
// component, so the harness renders a real sibling <button> and passes its
// ref in exactly like MainLayout will). `onClosed` is called AFTER the menu
// has actually unmounted (real React state, not a closed-over flag), which
// is when focus-restoration must have already happened.
function renderWithTrigger({ onSelect, extraActions, onClosed } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const triggerRef = { current: null };
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" ref={(el) => { triggerRef.current = el; }} data-testid="trigger">
          trigger
        </button>
        <StudyToolsMenu open={open} onClose={() => { setOpen(false); onClosed?.(); }}
          onSelect={onSelect} extraActions={extraActions} triggerRef={triggerRef} />
      </>
    );
  }
  return { root, triggerRef, Harness };
}

describe("StudyToolsMenu", () => {
  it("exposes exactly the three existing study tools and no evidence duplicate", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelect = vi.fn();
    await act(async () => root.render(<StudyToolsMenu open onClose={vi.fn()} onSelect={onSelect} />));
    expect(container.querySelectorAll('[role="menuitem"]')).toHaveLength(3);
    expect(container.textContent).toContain("Gia sư AI");
    expect(container.textContent).toContain("Dòng thời gian");
    expect(container.textContent).toContain("Kiến thức");
    expect(container.textContent).not.toContain("Bằng chứng");
    await act(async () => container.querySelectorAll('[role="menuitem"]')[1].click());
    expect(onSelect).toHaveBeenCalledWith("timeline");
  });

  it("renders no transient surface while closed", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<StudyToolsMenu open={false} />));
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });
});

// Mobile theme control PR, approved checkpoint — Escape/select/outside-click
// must return focus to the trigger (existing gap, true for every action,
// not just the new theme one). Contract:
//   - Escape -> close, focus -> trigger
//   - selecting any item -> close, focus -> trigger
//   - outside click on a focusable control -> close, focus stays on that
//     control (never stolen back)
//   - outside click on inert background -> close, focus -> trigger
describe("StudyToolsMenu — focus restoration on close", () => {
  it("Escape returns focus to the trigger", async () => {
    const onClosed = vi.fn();
    const { root, triggerRef, Harness } = renderWithTrigger({ onClosed });
    await act(async () => root.render(<Harness />));

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onClosed).toHaveBeenCalled();
    expect(document.activeElement).toBe(triggerRef.current);
  });

  it("selecting a tool closes the menu and returns focus to the trigger", async () => {
    const onClosed = vi.fn();
    const { root, triggerRef, Harness } = renderWithTrigger({ onClosed, onSelect: vi.fn() });
    await act(async () => root.render(<Harness />));

    await act(async () => {
      container.querySelector('[role="menuitem"]').click();
    });

    expect(onClosed).toHaveBeenCalled();
    expect(document.activeElement).toBe(triggerRef.current);
  });

  it("an outside click on another focusable control does not steal its focus back to the trigger", async () => {
    const onClosed = vi.fn();
    const { root, Harness } = renderWithTrigger({ onClosed });
    const other = document.createElement("button");
    other.type = "button";
    other.textContent = "other control";
    document.body.appendChild(other);
    await act(async () => root.render(<Harness />));

    // Mimic the browser's own default action: a mousedown on a focusable
    // element moves focus to it before/independently of our listener.
    other.focus();
    await act(async () => {
      other.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(onClosed).toHaveBeenCalled();
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it("an outside click on inert background returns focus to the trigger", async () => {
    const onClosed = vi.fn();
    const { root, triggerRef, Harness } = renderWithTrigger({ onClosed });
    const background = document.createElement("div");
    document.body.appendChild(background);
    await act(async () => root.render(<Harness />));

    await act(async () => {
      background.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(onClosed).toHaveBeenCalled();
    expect(document.activeElement).toBe(triggerRef.current);
    background.remove();
  });

  it("does not create a focus loop: closing twice in a row is a no-op the second time", async () => {
    const { root, triggerRef, Harness } = renderWithTrigger();
    await act(async () => root.render(<Harness />));

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    const focusAfterFirst = document.activeElement;
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(document.activeElement).toBe(focusAfterFirst);
    expect(document.activeElement).toBe(triggerRef.current);
  });
});
