import { test, expect } from "@playwright/test";
import { registerAndEnterApp } from "./fixtures.js";

test.describe("workspace study-library navigation", () => {
  test("keeps the learning library reachable across desktop, keyboard, history, and mobile", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await registerAndEnterApp(page);

    const home = page.getByRole("link", { name: "MemVidX — trang chủ" });
    const library = page.getByRole("link", { name: "Thư viện học tập" });

    // Desktop has a visible, named destination — separate from Công cụ học.
    await expect(library).toBeVisible();
    await expect(library).toContainText("Thư viện học tập");
    await expect(page.getByRole("button", { name: "Mở công cụ StudyMap" })).toBeVisible();

    // The destination follows the wordmark in the keyboard order.
    await home.focus();
    await page.keyboard.press("Tab");
    await expect(library).toBeFocused();

    // A real navigation round trip returns to the same workspace mode.
    const mindmapTab = page.getByRole("tab", { name: "Sơ đồ tư duy" });
    await mindmapTab.click();
    await expect(mindmapTab).toHaveAttribute("aria-selected", "true");

    await library.click();
    await expect(page).toHaveURL(/\/app\/study$/);
    await expect(page.getByRole("heading", { name: "Thư viện học tập" })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole("tablist", { name: "Chế độ Workspace" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sơ đồ tư duy" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab")).toHaveCount(3);

    // Narrow screens retain a separate, hit-testable library entry point.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(library).toBeVisible();
    const box = await library.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.width).toBeGreaterThanOrEqual(40);
    expect(box.height).toBeGreaterThanOrEqual(40);

    await library.click();
    await expect(page).toHaveURL(/\/app\/study$/);
  });
});
