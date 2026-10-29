// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import InlineDocumentNameEditor from "./InlineDocumentNameEditor";

let root;
let host;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  root = null;
  host = null;
});

function render(props = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<InlineDocumentNameEditor initialValue="Tên cũ" onSave={() => {}} onCancel={() => {}} {...props} />));
  return host.querySelector("input");
}

describe("InlineDocumentNameEditor", () => {
  const change = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  it("does not save an unchanged name and cancels on outside click", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const input = render({ onSave, onCancel });
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("shows validation errors and preserves empty-name fallback semantics", () => {
    const onSave = vi.fn();
    const input = render({ onSave });
    change(input, "x".repeat(201));
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    change(input, "");
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSave).toHaveBeenCalledWith(null);
  });
});
