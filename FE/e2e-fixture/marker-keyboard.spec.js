// Keyboard path for branch markers on the fixture harness (fake data only).
// Tab order is stable, Space/Enter toggle the focused marker itself, and the focus ring
// is drawn on the visible dot rather than on the 40px host.
import { test, expect } from "@playwright/test";

async function openSelection(page) {
  await page.locator('[aria-label="Xuất sơ đồ"]').first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
  await page.locator(".export-inline-action").click();
  await expect(page.locator(".mm-selection-bar")).toBeVisible();
  await page.waitForTimeout(300);
}

const focusedLabel = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el && el.tagName.toLowerCase() === "me-export-check" ? el.getAttribute("aria-label") : null;
});

for (const [w, h] of [[1440, 1024], [1024, 768], [390, 844]]) {
  test(`keyboard: stable Tab order, Space/Enter on focused marker, dot focus ring at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/fixture-harness.html");
    await expect(page.getByTestId("fixture-harness-root")).toBeVisible();
    await openSelection(page);

    const total = await page.locator("me-export-check").count();
    expect(total).toBeGreaterThan(0);
    const domOrder = await page.evaluate(() => [...document.querySelectorAll("me-export-check")].map((el) => el.getAttribute("aria-label")));

    // Walk Tab until focus lands on the first marker, then step through all of them.
    await page.locator("me-export-check").first().focus();
    const walk = [];
    for (let i = 0; i < total; i++) {
      walk.push(await focusedLabel(page));
      await page.keyboard.press("Tab");
    }
    // Stable: the same walk again gives the same order, and it matches DOM order.
    await page.locator("me-export-check").first().focus();
    const walk2 = [];
    for (let i = 0; i < total; i++) {
      walk2.push(await focusedLabel(page));
      await page.keyboard.press("Tab");
    }
    expect(walk).toEqual(domOrder);
    expect(walk2).toEqual(walk);

    // Space on the focused marker toggles that marker, and the counter follows.
    await page.locator("me-export-check").first().focus();
    const f0 = await focusedLabel(page);
    await page.keyboard.press("Space");
    await expect(page.locator(".mm-selection-bar")).toContainText("1 nhánh đã chọn");
    expect(await focusedLabel(page)).toBe(f0);
    expect(await page.locator("me-export-check").first().getAttribute("aria-checked")).toBe("true");

    // Enter on the next marker toggles that marker only.
    await page.keyboard.press("Tab");
    const f1 = await focusedLabel(page);
    await page.keyboard.press("Enter");
    await expect(page.locator(".mm-selection-bar")).toContainText("2 nhánh đã chọn");
    const checked = await page.evaluate(() => [...document.querySelectorAll("me-export-check")].filter((el) => el.getAttribute("aria-checked") === "true").map((el) => el.getAttribute("aria-label")));
    expect(checked.sort()).toEqual([f0, f1].sort());

    // Untick both from the keyboard, back to zero.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await expect(page.locator(".mm-selection-bar")).toContainText("Chọn các nhánh muốn xuất");

    // Focus ring: on the dot, not on the host. Host outline is none; dot box-shadow carries the accent.
    await page.locator("me-export-check").first().focus();
    const ring = await page.evaluate(() => {
      const host = document.activeElement;
      const dot = host.querySelector(".mm-export-check__dot");
      return { hostOutline: getComputedStyle(host).outlineStyle, dotShadow: getComputedStyle(dot).boxShadow };
    });
    expect(ring.hostOutline).toBe("none");
    expect(ring.dotShadow).toContain("rgb(18, 108, 242)");
  });
}
