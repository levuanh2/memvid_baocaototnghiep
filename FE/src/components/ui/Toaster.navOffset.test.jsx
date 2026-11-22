// @vitest-environment jsdom
// Codex P2 (PR #200): at <=700px the toast stack sits above the 64px bottom nav
// instead of covering it. jsdom has no layout, so this pins the class and the rule;
// the real-browser check is in the P1b screenshot metrics (toastOverNav).
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import Toaster, { toast, _resetToasts } from "./Toaster";

let container, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  _resetToasts();
});

it("renders the stack with the shared toast-stack class", async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Toaster />); });
  await act(async () => { toast("Đã lưu", { duration: 60_000 }); });
  const stack = document.querySelector(".toast-stack");
  expect(stack).not.toBeNull();
  expect(stack.className).not.toMatch(/\bbottom-4\b/);
});

it("offsets the stack above the nav at <=700px", () => {
  const css = readFileSync(resolve("src/index.css"), "utf-8");
  const block = css.slice(css.indexOf("V9.3 P1b shell"));
  expect(block).toMatch(/\.toast-stack\s*\{[^}]*bottom:\s*calc\(64px \+ 16px \+ env\(safe-area-inset-bottom\)\)/);
});
