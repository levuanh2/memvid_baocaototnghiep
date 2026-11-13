import fs from "node:fs";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(new URL("../index.css", import.meta.url), "utf8");

function themeBlock(theme) {
  if (theme === "dark") return css.match(/html\.dark\s*\{([\s\S]*?)\n\s*\}/)?.[1] || "";
  return css.match(/:root\s*\{([\s\S]*?)\n\s*\}/)?.[1] || "";
}

function token(block, name) {
  const value = block.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
  expect(value, `--${name} is declared`).toBeTruthy();
  return value;
}

function rgb(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("landing wordmark brand text contrast", () => {
  it.each([
    ["light", "#F1333A"],
    ["dark", "#D86A53"],
  ])("keeps the seal unchanged and gives %s brand text 4.5:1 against the header", (theme, seal) => {
    const block = themeBlock(theme);
    expect(token(block, "seal").toUpperCase()).toBe(seal);
    expect(contrast(token(block, "brand-text"), token(block, "bg-sidebar"))).toBeGreaterThanOrEqual(4.5);
  });
});
