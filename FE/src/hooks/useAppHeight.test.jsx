// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  let h = height, top = 0, scale = 1;
  Object.defineProperty(vv, "height", { configurable: true, get: () => h });
  Object.defineProperty(vv, "offsetTop", { get: () => top });
  Object.defineProperty(vv, "scale", { get: () => scale });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  return {
    resize: (next) => { h = next; vv.dispatchEvent(new Event("resize")); },
    // iOS pans the visual viewport to a focused input: that is a `scroll`, not a `resize`.
    pan: (next) => { top = next; vv.dispatchEvent(new Event("scroll")); },
    zoom: (s, next) => { scale = s; h = next; vv.dispatchEvent(new Event("resize")); },
    vv,
  };
}
const mount = () => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  act(() => root.render(<Probe />));
};
const appHeight = () => document.documentElement.style.getPropertyValue("--app-height");
const offsetTop = () => document.documentElement.style.getPropertyValue("--app-offset-top");
const panned = () => document.documentElement.classList.contains("vv-panned");

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

  it("removes the variables and the class and stops listening when the workspace unmounts", () => {
    const { resize, pan } = fakeViewport(700);
    mount();
    act(() => pan(120));
    expect(panned()).toBe(true);
    act(() => root.unmount()); root = null;
    expect(appHeight()).toBe("");
    expect(offsetTop()).toBe("");
    expect(panned()).toBe(false);
    act(() => { resize(300); pan(40); });
    expect(appHeight()).toBe("");
    expect(panned()).toBe(false);
  });

  it("iOS panning the visual viewport (offsetTop, a scroll event) moves the shell with it", () => {
    const { resize, pan } = fakeViewport(844);
    mount();
    expect(offsetTop()).toBe("0px");
    expect(panned()).toBe(false);
    act(() => { resize(508); pan(336); });
    expect(appHeight()).toBe("508px");
    expect(offsetTop()).toBe("336px");
    expect(panned()).toBe(true);
    // Keyboard closes: Safari un-pans and grows the viewport again.
    act(() => { pan(0); resize(844); });
    expect(offsetTop()).toBe("0px");
    expect(panned()).toBe(false);
    expect(appHeight()).toBe("844px");
  });

  it("pinch zoom does not shrink the shell (height is scaled back to layout pixels)", () => {
    const { zoom } = fakeViewport(844);
    mount();
    act(() => zoom(2, 422));
    expect(appHeight()).toBe("844px");
  });

  it("identical events do not rewrite the style (no work per toolbar animation frame)", () => {
    const { resize, vv } = fakeViewport(844);
    mount();
    const spy = vi.spyOn(document.documentElement.style, "setProperty");
    act(() => { resize(700); vv.dispatchEvent(new Event("resize")); vv.dispatchEvent(new Event("scroll")); });
    expect(spy.mock.calls.filter(([name]) => name === "--app-height")).toEqual([["--app-height", "700px"]]);
    spy.mockRestore();
  });

  it("an orientation change re-reads the viewport", () => {
    const { vv } = fakeViewport(844);
    mount();
    let h = 390;
    Object.defineProperty(vv, "height", { configurable: true, get: () => h });
    act(() => window.dispatchEvent(new Event("orientationchange")));
    expect(appHeight()).toBe("390px");
  });

  it("without visualViewport it uses the window height", () => {
    fakeViewport(0);
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    mount();
    expect(appHeight()).toBe(`${window.innerHeight}px`);
  });
});
