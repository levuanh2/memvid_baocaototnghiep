// V9.3 token contract (Codex/agy review of PR #197). Reads the real stylesheet and the
// component sources: the defects it guards against were consumers that bypassed the paired
// tokens, so checking the token values alone is not enough.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve("src");
const read = (p) => fs.readFileSync(path.join(SRC, p), "utf8");
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const INDEX = read("index.css");

function themeTokens(selector) {
  const start = INDEX.indexOf(`  ${selector} {`);
  const end = INDEX.indexOf("\n  }", start);
  const block = stripComments(INDEX.slice(start, end));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const LIGHT = themeTokens(":root");
const DARK = { ...LIGHT, ...themeTokens("html.dark") };

function lum(hex) {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const CSS_FILES = ["index.css", "components/mindmap/mindmap.css", "components/mindmap/exportStudio.css",
  "components/mindmap/appearanceEditor.css", "components/study/libraryActionMatrix.css",
  "pages/study/quizJourney.css"];
function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(SRC, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (/\.jsx$/.test(e.name) && !/\.test\.jsx$/.test(e.name)) out.push(rel);
  }
  return out;
}
const JSX_FILES = walk(".");

describe.each([["light", LIGHT], ["dark", DARK]])("V9.3 tokens, %s theme", (_name, t) => {
  it("pairs foregrounds with their fills at WCAG AA", () => {
    expect(contrast(t["on-primary"], t["accent-cta"])).toBeGreaterThanOrEqual(4.5);
    for (const fg of ["text-primary", "text-secondary", "accent", "warn", "ok", "err", "focus"]) {
      expect([fg, contrast(t[fg], t["bg-card"])]).toEqual([fg, expect.any(Number)]);
      expect(contrast(t[fg], t["bg-card"]), fg).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps warning, action, success and danger as distinct roles", () => {
    const roles = ["warn", "accent", "ok", "err"].map((k) => t[k].toUpperCase());
    expect(new Set(roles).size).toBe(roles.length);
    expect(t.warn.toUpperCase()).not.toBe(t.seal.toUpperCase());
    expect(t["quiz-status-processing"].toUpperCase()).not.toBe(t.warn.toUpperCase());
  });
});

describe("V9.3 consumers", () => {
  const LIGHT_LITERAL = /color:\s*(#fff\b|#ffffff\b|#f5f1e8\b|white\b)/i;
  const SOLID_TOKEN_FILL = /background(-color)?:\s*var\(--(accent-cta|accent|seal|brand)\)/;

  it("no CSS rule puts a hard-coded light foreground on a token-filled background", () => {
    const bad = [];
    for (const f of CSS_FILES) {
      for (const block of stripComments(read(f)).split("}")) {
        if (SOLID_TOKEN_FILL.test(block) && LIGHT_LITERAL.test(block)) bad.push(`${f}: ${block.trim().slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("no inline style puts a hard-coded light foreground on a token-filled background", () => {
    const bad = [];
    for (const f of JSX_FILES) {
      for (const m of read(f).matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
        if (/var\(--(accent-cta|accent|seal|brand)\)/.test(m[1]) && /["'](#fff|#ffffff|white)["']/i.test(m[1])) bad.push(f);
      }
    }
    expect(bad).toEqual([]);
  });

  it("app chrome CSS has no legacy V5 action blue", () => {
    const bad = CSS_FILES.filter((f) => /#126cf2|rgba\(\s*18,\s*108,\s*242/i.test(stripComments(read(f))));
    expect(bad).toEqual([]);
  });

  it("app chrome CSS names no retired typeface", () => {
    const bad = [];
    for (const f of CSS_FILES) {
      for (const m of stripComments(read(f)).matchAll(/font(-family)?:[^;}]*/g)) {
        if (/Spectral|Aptos|\bInter\b/.test(m[0])) bad.push(`${f}: ${m[0].slice(0, 70)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("no focus ring falls back to a 2px accent outline instead of the 3px --focus ring", () => {
    const bad = CSS_FILES.filter((f) => /outline:\s*2px solid var\(--accent\)/.test(stripComments(read(f))));
    expect(bad).toEqual([]);
  });

  it("a 44px button class is never squeezed into a smaller fixed height", () => {
    const bad = [];
    for (const f of JSX_FILES) {
      for (const m of read(f).matchAll(/className="([^"]*\bbtn-(?:primary|seal|secondary|danger)\b[^"]*)"/g)) {
        if (/(^|\s)h-(8|9|10)(\s|$)/.test(m[1])) bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
