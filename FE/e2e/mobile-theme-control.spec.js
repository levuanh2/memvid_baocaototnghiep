// Phase 4 — mobile/tablet theme control, real browser matrix. Against the
// REAL app shell (MainLayout + StudyToolsMenu) via a real backend-backed
// user, not the backend-free fixture harness (which only mounts
// MindElixirView and has no header at all). Never fakes a theme switch
// with classList injection -- every Light/Dark change here is a real click
// on the real control.
import { test, expect } from "@playwright/test";
import { registerAndEnterApp } from "./fixtures.js";

const STORAGE_KEY = "memvid-theme";
const LIGHT_LABEL = "Chuyển sang nền tối";
const DARK_LABEL = "Chuyển sang nền sáng";
const MIN_TARGET = 40;

// Round 8.1 (R8-001): the header stays compact through 1100px (index.css
// `@media (max-width: 1100px)`), so 1024 and 1100 are compact widths and the
// desktop toggle first appears at 1101.
const MOBILE_TABLET = [
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1100x768", width: 1100, height: 768 },
];
const DESKTOP = [
  { name: "1101x768", width: 1101, height: 768 },
  { name: "1440x1024", width: 1440, height: 1024 },
];

async function openOverflow(page) {
  await page.getByRole("button", { name: "Mở công cụ học" }).click();
  await expect(page.locator(".study-tools-menu")).toHaveCount(1);
}

function themeMenuItem(page) {
  return page.locator('[role="menuitem"]').filter({ hasText: /Chuyển sang nền/ });
}

test.describe("mobile/tablet: exactly one reachable theme action", () => {
  for (const vp of MOBILE_TABLET) {
    test(`${vp.name}: overflow menu exposes exactly one theme action, no desktop toggle visible`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await registerAndEnterApp(page);

      // Desktop toggle carries `hidden lg:flex`, and the compact header rule
      // hides it through 1100px -- real CSS cascade, not a JS branch.
      const desktopToggle = page.locator('[role="group"][aria-label="Chế độ sáng/tối"]');
      await expect(desktopToggle).toBeHidden();

      await openOverflow(page);
      await expect(themeMenuItem(page)).toHaveCount(1);
      await expect(themeMenuItem(page)).toBeVisible();
    });
  }

  for (const vp of DESKTOP) {
    test(`${vp.name}: only the desktop toggle is visible, mobile action stays hidden`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await registerAndEnterApp(page);

      const desktopToggle = page.locator('[role="group"][aria-label="Chế độ sáng/tối"]');
      await expect(desktopToggle).toBeVisible();

      // The overflow trigger itself is phone/tablet-only chrome; at these
      // widths it must not be the way to reach theme (desktop toggle is).
      const overflowTrigger = page.locator(".study-tools-trigger");
      const overflowVisible = await overflowTrigger.isVisible().catch(() => false);
      if (overflowVisible) {
        await openOverflow(page);
        await expect(themeMenuItem(page)).toBeHidden();
      }
    });
  }
});

test.describe("mobile: real Light<->Dark via the real control", () => {
  test("390x844: click flips class+storage+label, and persists across reload", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await registerAndEnterApp(page);

    const html = page.locator("html");
    await expect(html).not.toHaveClass(/dark/);

    await openOverflow(page);
    await expect(themeMenuItem(page)).toHaveText(new RegExp(LIGHT_LABEL));
    await themeMenuItem(page).click();

    await expect(html).toHaveClass(/dark/);
    expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBe("dark");

    await page.reload();
    await expect(html).toHaveClass(/dark/);

    await openOverflow(page);
    await expect(themeMenuItem(page)).toHaveText(new RegExp(DARK_LABEL));
    await themeMenuItem(page).click();
    await expect(html).not.toHaveClass(/dark/);
    expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBe("light");
  });

  test("Enter and Space activate the real native button", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await registerAndEnterApp(page);
    const html = page.locator("html");

    await openOverflow(page);
    await themeMenuItem(page).focus();
    await page.keyboard.press("Enter");
    await expect(html).toHaveClass(/dark/);

    await openOverflow(page);
    await themeMenuItem(page).focus();
    await page.keyboard.press("Space");
    await expect(html).not.toHaveClass(/dark/);
  });

  test("Escape closes the menu and returns focus to the trigger", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await registerAndEnterApp(page);

    await openOverflow(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(".study-tools-menu")).toHaveCount(0);
    await expect(page.locator(".study-tools-trigger")).toBeFocused();
  });

  test("selecting the theme action closes the menu and returns focus to the trigger", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await registerAndEnterApp(page);

    await openOverflow(page);
    await themeMenuItem(page).click();
    await expect(page.locator(".study-tools-menu")).toHaveCount(0);
    await expect(page.locator(".study-tools-trigger")).toBeFocused();
  });

  test("hit target is at least 40x40, no horizontal page overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await registerAndEnterApp(page);

    await openOverflow(page);
    const box = await themeMenuItem(page).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(box.height).toBeGreaterThanOrEqual(MIN_TARGET);

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });

  test("resizing across the 1100<->1101 breakpoint keeps theme state and exactly one trigger at each step", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await registerAndEnterApp(page);

    await openOverflow(page);
    await themeMenuItem(page).click(); // light -> dark
    const html = page.locator("html");
    await expect(html).toHaveClass(/dark/);

    await page.setViewportSize({ width: 1101, height: 768 });
    await expect(html).toHaveClass(/dark/);
    await expect(page.locator('[role="group"][aria-label="Chế độ sáng/tối"]')).toBeVisible();

    await page.setViewportSize({ width: 1100, height: 768 });
    await expect(html).toHaveClass(/dark/);
    await expect(page.locator('[role="group"][aria-label="Chế độ sáng/tối"]')).toBeHidden();
  });

  test("does not remount the workspace shell (tab state survives the click)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await registerAndEnterApp(page);

    await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
    await expect(page.getByRole("tab", { name: "Sơ đồ tư duy" })).toHaveAttribute("aria-selected", "true");

    await openOverflow(page);
    await themeMenuItem(page).click();

    await expect(page.getByRole("tab", { name: "Sơ đồ tư duy" })).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("desktop: toggle unaffected", () => {
  // V6 header (owner decision): one theme button in place of the two-button group.
  test("1440x1024: one desktop theme button, named by its next action, switches and persists", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 });
    await registerAndEnterApp(page);

    await expect(page.locator('[role="group"][aria-label="Chế độ sáng/tối"]')).toHaveCount(0);
    const toggle = page.locator("header .workspace-theme-toggle");
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-label", LIGHT_LABEL);

    await toggle.click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(toggle).toHaveAttribute("aria-label", DARK_LABEL);

    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("header .workspace-theme-toggle")).toHaveAttribute("aria-label", DARK_LABEL);
  });
});
