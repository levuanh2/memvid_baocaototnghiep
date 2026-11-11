// V4.1 W1-5: Library header containment across phone and desktop widths.
// Real app on the Vite fixture server; APIs are mocked at the network layer.
import { test, expect } from "@playwright/test";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const DOC = {
  document_id: "d1", source_stem: "tai-lieu-1", title: "Hệ điều hành.pdf", status: "completed",
  ingest_status: "index_ready", progress: 1, reading_minutes: 12, created_at: "2026-10-01T08:00:00Z",
  ai: { index: "ready", summary: { state: "ready" }, quiz: { ready: false }, review: {} },
};

async function openLibrary(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(/localhost:8080\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (path === "/list-indexed") return route.fulfill(json({ sources: [{ video: "tai-lieu-1", video_stem: "tai-lieu-1", filename: DOC.title, status: "index_ready" }] }));
    if (path === "/api/documents" || path === "/api/library") return route.fulfill(json({ documents: [DOC], collections: [] }));
    if (path === "/api/documents/d1") return route.fulfill(json(DOC));
    if (path === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (path === "/summaries") return route.fulfill(json({ summaries: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app/study");
  const header = page.locator("header").first();
  await expect(header.getByRole("heading", { name: "Thư viện học tập" })).toBeVisible();
  await expect(header.locator("button")).toHaveCount(2);
  return header;
}

async function assertInsideViewport(locator, viewportWidth) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 0.5);
  return box;
}

for (const width of [320, 390, 768, 1440]) {
  test(`Library header stays contained at ${width}px`, async ({ page }) => {
    const header = await openLibrary(page, width);
    const title = header.getByRole("heading", { name: "Thư viện học tập" });
    const buttons = header.locator("button");

    await assertInsideViewport(title, width);
    const titleFits = await title.evaluate((element) => element.scrollWidth <= element.clientWidth);
    expect(titleFits).toBe(true);

    const buttonBoxes = [];
    for (let index = 0; index < await buttons.count(); index += 1) {
      buttonBoxes.push(await assertInsideViewport(buttons.nth(index), width));
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    if (width < 768) {
      expect(buttonBoxes[0].width).toBeGreaterThanOrEqual(width - 42);
      expect(buttonBoxes[1].y).toBeGreaterThanOrEqual(buttonBoxes[0].y + buttonBoxes[0].height);
    } else {
      const firstCenter = buttonBoxes[0].y + buttonBoxes[0].height / 2;
      const secondCenter = buttonBoxes[1].y + buttonBoxes[1].height / 2;
      expect(Math.abs(firstCenter - secondCenter)).toBeLessThan(1);
    }
  });
}
