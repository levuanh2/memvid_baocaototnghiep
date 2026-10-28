// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import Modal from "./Modal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove(); container = null; root = null;
});

async function renderReady(children, props = {}) {
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(
    <Modal open title="Test dialog" onClose={props.onClose ?? vi.fn()} {...props}>{children}</Modal>,
  ));
  return document.body.querySelector('[role="dialog"]');
}

describe("Round 7.1 Modal findings", () => {
  // Round 7's report speculated the header close button, lacking type="button",
  // could submit a <form> rendered inside a Modal consumer (NksVerifyDialog,
  // ChangePasswordDialog). The actual DOM: the close button is a SIBLING of the
  // children wrapper, never a descendant of any <form> the consumer renders, so
  // it was never form-associated and could never have submitted it -- verified
  // here with jsdom's programmatic click, not merely asserted from JSX shape.
  // `type="button"` is still added as defensive hardening (any button without an
  // explicit type defaults to type=submit, which is the wrong default for a
  // close control regardless of today's DOM shape).
  it("close button carries explicit type=button and never submits a <form> rendered as Modal's children", async () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    const onClose = vi.fn();
    const dialog = await renderReady(
      <form onSubmit={onSubmit}><input type="password" /></form>,
      { onClose },
    );
    const closeBtn = dialog.querySelector('button[aria-label="Đóng hộp thoại"]');
    expect(closeBtn.getAttribute("type")).toBe("button");

    await act(async () => { closeBtn.click(); });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("initial focus lands on the first focusable element in DOM order (currently the header close button when one exists) -- a separate, pre-existing focus-order property, not changed by the type=button hardening above", async () => {
    const dialog = await renderReady(<form><input type="text" aria-label="first-field" /></form>);
    expect(document.activeElement).toBe(dialog.querySelector('button[aria-label="Đóng hộp thoại"]'));
  });

  // Focus-trap cycling (bayTab) filters candidates by `el.offsetParent !== null`
  // for visibility -- jsdom never computes real layout, so offsetParent is null
  // for every element and the trap can't be meaningfully exercised here. Verified
  // instead in a real browser (see report); not re-asserted in jsdom.

  it("Escape calls onClose", async () => {
    const onClose = vi.fn();
    await renderReady(<div />, { onClose });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the element that opened the dialog, on close", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
    let open = true;
    const render = () => act(async () => root.render(<Modal open={open} title="T" onClose={() => {}}><div /></Modal>));
    await render();
    expect(document.activeElement).not.toBe(trigger);

    open = false;
    await render();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
