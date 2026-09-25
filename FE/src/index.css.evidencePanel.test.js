// @vitest-environment node
//
// jsdom does not apply real stylesheet CSS (no cascade, no @media
// evaluation), so the P1 layout defect's actual fix -- removing a CSS rule
// -- cannot be verified by rendering a component in jsdom and checking
// computed style; that part is verified live via Playwright
// (before/after getBoundingClientRect measurements at 1024x768 and
// 768x1024, see docs/EVIDENCE_PANEL_LAYOUT_FIX.md). This test guards the
// one thing that CAN be checked deterministically and fast: the source
// file itself no longer contains the specific rule that caused it.
//
// Root cause: `@media (min-width: 768px) and (max-width: 1279px) {
// .context-inspector-shell { position: fixed !important; ... } }` took the
// Chat/Summary Evidence panel out of flex flow at tablet widths, so
// `<main>` (flex-1, min-w-0) never learned to shrink to make room for it --
// the panel then floated OVER the hero/composer/send button instead of
// reserving space, confirmed live via getBoundingClientRect overlap checks.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.css");
const css = readFileSync(cssPath, "utf-8");

describe("index.css — Evidence panel must not be forced out of flex flow at tablet widths", () => {
  it("no tablet-range (768-1279px) rule sets .context-inspector-shell to position: fixed", () => {
    // Find every @media block whose range overlaps 768-1279px, and check
    // NONE of them force `.context-inspector-shell` (the Chat/Summary
    // reserved-pane element) into `position: fixed`. Mind Map's own
    // floating overlay uses a DIFFERENT class (`.mindmap-tools-overlay`,
    // applied via a `fixed` Tailwind utility directly in the JSX
    // className, not through this stylesheet) and is untouched by this
    // check -- Chat/Summary and Mind Map are structurally distinct
    // elements, never the same DOM node.
    const mediaBlockRe = /@media\s*\(min-width:\s*(\d+)px\)\s*and\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/g;
    let match;
    const offendingBlocks = [];
    while ((match = mediaBlockRe.exec(css))) {
      const [, minStr, maxStr, body] = match;
      const min = Number(minStr), max = Number(maxStr);
      const overlapsTabletRange = min <= 1279 && max >= 768;
      if (!overlapsTabletRange) continue;
      if (/\.context-inspector-shell\s*\{[^}]*position:\s*fixed/.test(body)) {
        offendingBlocks.push(`@media (min-width:${min}px) and (max-width:${max}px)`);
      }
    }
    expect(offendingBlocks).toEqual([]);
  });

  it("the resize-handle hit target no longer consumes real layout width (widened hitbox, still 1px visible)", () => {
    // Spec: 16-24px pointer hit target, but transparent and overlapping the
    // divider via negative margin -- never a real reserved-width column
    // (the old "white gutter"). Checks the two rules stay in sync: the
    // margin's magnitude must net the box down to exactly 1px of real
    // width, and the grip's inset must match so the visible line itself
    // also stays 1px.
    const dividerMatch = css.match(/\.panel-divider\s*\{([^}]*)\}/);
    expect(dividerMatch).toBeTruthy();
    const dividerBody = dividerMatch[1];
    const widthMatch = dividerBody.match(/width:\s*([\d.]+)px/);
    const marginMatch = dividerBody.match(/margin:\s*0\s*-([\d.]+)px/);
    expect(widthMatch).toBeTruthy();
    expect(marginMatch).toBeTruthy();
    const width = Number(widthMatch[1]);
    const marginMagnitude = Number(marginMatch[1]);
    expect(width).toBeGreaterThanOrEqual(16);
    expect(width).toBeLessThanOrEqual(24);
    // net real width = box width - (margin taken back on both sides)
    expect(Math.round((width - 2 * marginMagnitude) * 10) / 10).toBe(1);

    const gripMatch = css.match(/\.panel-divider__grip\s*\{([^}]*)\}/);
    expect(gripMatch).toBeTruthy();
    const insetMatch = gripMatch[1].match(/inset:\s*0\s*([\d.]+)px/);
    expect(insetMatch).toBeTruthy();
    const inset = Number(insetMatch[1]);
    // visible strip width = box width - 2*inset, must also be 1px
    expect(Math.round((width - 2 * inset) * 10) / 10).toBe(1);
  });
});
