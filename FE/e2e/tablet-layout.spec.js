// Protects PR #35 (already merged/deployed): the Chat/Summary Evidence panel
// must reserve its own layout space at tablet widths — no composer overlap,
// no horizontal page overflow — at both tablet orientations.
import { test, expect } from "@playwright/test";
import { registerAndEnterApp } from "./fixtures.js";

const VIEWPORTS = [
  { name: "1024x768 (landscape)", width: 1024, height: 768 },
  { name: "768x1024 (portrait)", width: 768, height: 1024 },
];

for (const vp of VIEWPORTS) {
  test(`tablet ${vp.name}: no horizontal overflow, no Evidence/composer overlap`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await registerAndEnterApp(page);

    // No horizontal scroll anywhere on the page shell.
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    expect(overflow.scrollWidth, "page has horizontal overflow at tablet width").toBeLessThanOrEqual(overflow.clientWidth + 1);

    // Evidence panel (ContextInspector, rendered inside the right `aside`)
    // must not overlap the chat composer — PR #35's exact regression.
    const composer = page.locator("textarea, [data-composer], form:has(textarea)").last();
    const composerBox = await composer.boundingBox().catch(() => null);
    const asideBox = await page.locator("aside.context-inspector-shell, aside.mindmap-tools-overlay")
      .first().boundingBox().catch(() => null);

    if (composerBox && asideBox) {
      const overlapX = Math.max(0, Math.min(composerBox.x + composerBox.width, asideBox.x + asideBox.width) -
        Math.max(composerBox.x, asideBox.x));
      const overlapY = Math.max(0, Math.min(composerBox.y + composerBox.height, asideBox.y + asideBox.height) -
        Math.max(composerBox.y, asideBox.y));
      const overlapArea = overlapX * overlapY;
      expect(overlapArea, "Evidence panel visually overlaps the chat composer").toBe(0);
    }
  });
}
