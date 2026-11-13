// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useAppHeight } from "./useAppHeight";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe() { useAppHeight(); return null; }
let container, root, original;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove(); container = null; root = null;
  Object.defineProperty(window, "visualViewport", { configurable: true, value: original });
});

function fakeViewport(height) {
  original = window.visualViewport;
  const vv = new EventTarget();
  let h = height;
  Object.defineProperty(vv, "height", { get: () => h });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  return { resize: (next) => { h = next; vv.dispatchEvent(new Event("resize")); }, vv };
}
const mount = () => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  act(() => root.render(<Probe />));
};
const appHeight = () => document.documentElement.style.getPropertyValue("--app-height");

describe("useAppHeight", () => {
  it("follows the visible viewport, including when the keyboard shrinks it", () => {
    const { resize } = fakeViewport(844);
    mount();
    expect(appHeight()).toBe("844px");
    act(() => resize(507.6));
    expect(appHeight()).toBe("508px");
    act(() => resize(844));
    expect(appHeight()).toBe("844px");
  });

  it("removes the variable and stops listening when the workspace unmounts", () => {
    const { resize } = fakeViewport(700);
    mount();
    act(() => root.unmount()); root = null;
    expect(appHeight()).toBe("");
    act(() => resize(300));
    expect(appHeight()).toBe("");
  });

  it("without visualViewport it uses the window height", () => {
    fakeViewport(0);
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    mount();
    expect(appHeight()).toBe(`${window.innerHeight}px`);
  });
});
