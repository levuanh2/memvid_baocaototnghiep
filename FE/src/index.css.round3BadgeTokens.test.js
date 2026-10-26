// Round 3 QA closure. jsdom has no real stylesheet cascade (component tests
// never import index.css, and getComputedStyle only reflects inline styles),
// so computed-contrast assertions aren't possible here — this instead locks
// the actual CSS source against the two regressions Codex2's review found:
//
// 1. White-text badges (`.source-rail__toggle span`, `.mobile-context b`)
//    must use `--accent-cta` (the token Round 2 built specifically for
//    white-text fills, 5.17:1 in dark mode), not `--accent` (deliberately
//    light in dark mode for its OWN text/icon role — white-on-it measured
//    2.77:1, the same UX-VIS-001 class of failure).
// 2. The rail's selected-source dot (`.source-rail__file::after`) must use
//    `--accent` (selection role), not `--ok` (success/ready role) — a
//    document being selected is not the same signal as it being ready.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.css"), "utf8");

function ruleFor(selector) {
  const idx = css.indexOf(selector);
  expect(idx, `selector not found: ${selector}`).toBeGreaterThan(-1);
  const close = css.indexOf("}", idx);
  return css.slice(idx, close + 1);
}

describe("index.css Round 3 badge/selection token roles", () => {
  it("source rail toggle count badge uses --accent-cta, not --accent, for its white text fill", () => {
    const rule = ruleFor(".source-rail__toggle span {");
    expect(rule).toContain("background: var(--accent-cta)");
    expect(rule).not.toContain("background: var(--accent)");
  });

  it("mobile context chip badges use --accent-cta, not --accent, for their white text fill", () => {
    const rule = ruleFor(".mobile-context b {");
    expect(rule).toContain("background: var(--accent-cta)");
    expect(rule).not.toContain("background: var(--accent)");
  });

  it("the rail's selected-source dot reads selection (--accent), not success/ready (--ok)", () => {
    const rule = ruleFor(".source-rail__file::after {");
    expect(rule).toContain("background: var(--accent)");
    expect(rule).not.toContain("var(--ok)");
  });
});
