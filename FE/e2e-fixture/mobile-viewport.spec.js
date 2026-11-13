// Mobile viewport: the workspace shell follows the VISIBLE viewport, so the chat composer and the
// bottom controls are not hidden behind the on-screen keyboard or the browser's toolbars.
//
// SIMULATION, not a real keyboard: headless Chromium cannot open one. iOS Safari keeps the layout
// viewport (100vh) when the keyboard opens and shrinks only `window.visualViewport`. The init script
// below replaces `visualViewport` with an object whose height the test controls and fires its
// `resize` event, which is exactly what the app listens to. Real-device behaviour is NOT covered.
import { test, expect } from "@playwright/test";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const STEM = "kinh-te-vi-mo";

async function openWorkspace(page, { width = 390, height = 844 } = {}) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    localStorage.setItem("memvid-token", "fixture-token");
    const target = new EventTarget();
    let h = window.innerHeight;
    const vv = Object.assign(target, { offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1 });
    Object.defineProperty(vv, "height", { get: () => h });
    Object.defineProperty(vv, "width", { get: () => window.innerWidth });
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => vv });
    window.__setVisualHeight = (next) => { h = next; vv.dispatchEvent(new Event("resize")); };
  });
  await page.route(/localhost:8080\//, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [{ video: STEM, video_stem: STEM, filename: "Kinh tế vi mô.pdf", status: "index_ready", can_query: true }] }));
    return route.fulfill(json({}));
  });
  await page.goto(`/app?source=${STEM}`);
  await expect(page.locator("textarea").first()).toBeVisible();
}

const bottomOf = (locator) => locator.evaluate((el) => el.getBoundingClientRect().bottom);

for (const [width, height, keyboard] of [[390, 844, 336], [320, 640, 280], [768, 1024, 320]]) {
  test(`${width}x${height}: with a ${keyboard}px keyboard open (simulated) the composer stays above it`, async ({ page }) => {
    await openWorkspace(page, { width, height });
    const input = page.locator("textarea").first();
    await input.focus();
    const visible = height - keyboard;
    await page.evaluate((v) => window.__setVisualHeight(v), visible);
    await expect.poll(() => bottomOf(input)).toBeLessThanOrEqual(visible);
    await expect.poll(() => bottomOf(page.getByRole("button", { name: "Gửi câu hỏi" }))).toBeLessThanOrEqual(visible);
    // The page itself must not scroll sideways or grow: the shell shrinks instead.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Keyboard closed again: the shell grows back to the full height.
    await page.evaluate((v) => window.__setVisualHeight(v), height);
    await expect.poll(() => page.evaluate(() => document.querySelector(".app-shell-height")?.getBoundingClientRect().height))
      .toBe(height);
  });
}

test("the viewport meta asks Android Chrome to resize the content for the keyboard", async ({ page }) => {
  await openWorkspace(page);
  const meta = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(meta).toContain("interactive-widget=resizes-content");
});

test("capture: 390x844 with a simulated 336px keyboard", async ({ page }) => {
  const out = process.env.V6_SHOT_OUT;
  test.skip(!out, "set V6_SHOT_OUT to capture");
  await openWorkspace(page, { width: 390, height: 844 });
  await page.locator("textarea").first().focus();
  await page.evaluate(() => window.__setVisualHeight(508));
  await page.waitForTimeout(200);
  // Only the part above the keyboard is what the learner sees.
  await page.screenshot({ path: `${out}/mobile-keyboard-390-${process.env.V6_SHOT_TAG || "after"}.png`, clip: { x: 0, y: 0, width: 390, height: 508 } });
});
