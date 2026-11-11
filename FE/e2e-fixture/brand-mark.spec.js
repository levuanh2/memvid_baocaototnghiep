// V5-A: the StudyMap mark replaces the retired "M" seal on the landing header and the app shell.
// Below lg the shell hides the wordmark, so the mark alone carries the brand there.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.BRAND_QA_DIR || path.join(process.cwd(), "qa-artifacts", "brand-mark");
fs.mkdirSync(OUT, { recursive: true });
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function expectMark(page, scope) {
  const mark = scope.locator("[data-brand-mark]").first();
  await expect(mark).toBeVisible();
  const box = await mark.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(28);
  expect(Math.abs(box.width - box.height)).toBeLessThan(0.5);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const width of [320, 390, 768, 1024, 1440]) {
  for (const dark of [false, true]) {
    const tag = `${width}-${dark ? "dark" : "light"}`;
    test(`landing header shows the StudyMap mark at ${tag}`, async ({ page }) => {
      await page.addInitScript((d) => localStorage.setItem("memvid-theme", d ? "dark" : "light"), dark);
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      const header = page.locator("header").first();
      await expectMark(page, header);
      await expect(header.getByText("M", { exact: true })).toHaveCount(0);
      await page.screenshot({ path: path.join(OUT, `landing-${tag}.png`), clip: { x: 0, y: 0, width, height: 72 } });
    });

    test(`app shell home link shows the StudyMap mark at ${tag}`, async ({ page }) => {
      await page.addInitScript((d) => {
        localStorage.setItem("memvid-token", "fixture-token");
        localStorage.setItem("memvid-theme", d ? "dark" : "light");
      }, dark);
      await page.route(/localhost:8080\//, (route) => {
        const p = new URL(route.request().url()).pathname;
        if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
        if (p === "/list-indexed") return route.fulfill(json({ sources: [] }));
        return route.fulfill(json({}));
      });
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/app");
      const home = page.getByRole("link", { name: "StudyMap — trang chủ" });
      await expectMark(page, home);
      await expect(home.getByText("M", { exact: true })).toHaveCount(0);
      const link = await home.boundingBox();
      expect(link.height).toBeGreaterThanOrEqual(40);
      expect(link.width).toBeGreaterThanOrEqual(40);
      // The tile follows the theme: #F1333A (light) / #D86A53 (dark).
      const fill = await home.locator("[data-brand-mark] rect").evaluate((el) => getComputedStyle(el).fill);
      expect(fill).toBe(dark ? "rgb(216, 106, 83)" : "rgb(241, 51, 58)");
      await page.screenshot({ path: path.join(OUT, `app-${tag}.png`), clip: { x: 0, y: 0, width, height: 56 } });
    });
  }
}

test("the favicon link points at the StudyMap mark and the file is served", async ({ page }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="icon"]').getAttribute("href");
  expect(href).toBe("/studymap-mark.svg");
  const res = await page.request.get(href);
  expect(res.ok()).toBe(true);
  expect(await res.text()).toContain("<title>StudyMap</title>");
});
