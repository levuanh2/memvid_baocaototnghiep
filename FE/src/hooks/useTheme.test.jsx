// @vitest-environment jsdom
//
// PR: mobile/tablet theme control. Approved checkpoint explicitly keeps
// useTheme.js's contract UNCHANGED (no matchMedia change-listener, no
// "System" mode) -- these are guard tests for the existing initial-mount
// fallback contract (storage key "memvid-theme"), not new behavior. Any
// Light<->Dark SWITCH via the UI is covered at the MainLayout integration
// level (real click), per the "no classList injection" rule -- this file
// only covers what happens before any click: the very first read.
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useTheme } from "./useTheme";

const STORAGE_KEY = "memvid-theme";
let container;
let root;

function Probe() {
  const { isDark } = useTheme();
  return <span data-testid="is-dark">{String(isDark)}</span>;
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Probe />));
}

function setMatchMedia(matches) {
  window.matchMedia = () => ({ matches, addEventListener() {}, removeEventListener() {} });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  localStorage.clear();
});

describe("useTheme — initial-mount fallback (contract unchanged)", () => {
  it("empty storage + OS prefers dark -> isDark true", async () => {
    localStorage.removeItem(STORAGE_KEY);
    setMatchMedia(true);
    await mount();
    expect(container.querySelector('[data-testid="is-dark"]').textContent).toBe("true");
  });

  it("empty storage + OS prefers light -> isDark false", async () => {
    localStorage.removeItem(STORAGE_KEY);
    setMatchMedia(false);
    await mount();
    expect(container.querySelector('[data-testid="is-dark"]').textContent).toBe("false");
  });

  it("explicit stored preference wins over a conflicting OS preference", async () => {
    localStorage.setItem(STORAGE_KEY, "light");
    setMatchMedia(true); // OS says dark, stored choice must still win
    await mount();
    expect(container.querySelector('[data-testid="is-dark"]').textContent).toBe("false");
  });
});
