// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import DestructiveConfirmDialog from "./DestructiveConfirmDialog";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove(); container = null; root = null;
});

async function renderReady(props) {
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<DestructiveConfirmDialog open title="Delete map?" targetName="Map A" {...props} />));
  return document.body.querySelector('[role="dialog"]');
}

function confirmBtn(dialog) {
  return [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Xóa") || b.textContent.includes("Xoá"));
}
function checkbox(dialog) {
  return dialog.querySelector('input[type="checkbox"]');
}

describe("DestructiveConfirmDialog", () => {
  it("keeps the destructive button disabled until the acknowledgement checkbox is ticked", async () => {
    const onConfirm = vi.fn();
    const dialog = await renderReady({ onConfirm, onCancel: vi.fn() });
    const btn = confirmBtn(dialog);
    expect(btn.disabled).toBe(true);
    await act(async () => { checkbox(dialog).click(); });
    expect(confirmBtn(dialog).disabled).toBe(false);
    await act(async () => { confirmBtn(dialog).click(); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancel calls onCancel and not onConfirm", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const dialog = await renderReady({ onConfirm, onCancel });
    const cancelBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Huỷ");
    await act(async () => cancelBtn.click());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not call onConfirm twice for a rapid double click", async () => {
    let resolveConfirm;
    const onConfirm = vi.fn(() => new Promise((r) => { resolveConfirm = r; }));
    const dialog = await renderReady({ onConfirm, onCancel: vi.fn() });
    await act(async () => { checkbox(dialog).click(); });
    const btn = confirmBtn(dialog);
    await act(async () => { btn.click(); btn.click(); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await act(async () => { resolveConfirm(); await Promise.resolve(); });
  });

  it("shows an error and stays open when onConfirm rejects, instead of reporting false success", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("Server error."));
    const onCancel = vi.fn();
    const dialog = await renderReady({ onConfirm, onCancel });
    await act(async () => { checkbox(dialog).click(); });
    await act(async () => { confirmBtn(dialog).click(); });
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
    expect(dialog.textContent).toContain("Server error.");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("resets the acknowledgement checkbox and prior error when reopened for a different target", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("Previous failure."));
    let dialog = await renderReady({ onConfirm, onCancel: vi.fn(), targetName: "Map A" });
    await act(async () => { checkbox(dialog).click(); });
    await act(async () => { confirmBtn(dialog).click(); });
    expect(dialog.textContent).toContain("Previous failure.");

    if (root) act(() => root.unmount());
    dialog = await renderReady({ onConfirm: vi.fn(), onCancel: vi.fn(), targetName: "Map B" });
    expect(dialog.textContent).not.toContain("Previous failure.");
    expect(checkbox(dialog).checked).toBe(false);
    expect(confirmBtn(dialog).disabled).toBe(true);
  });
});
