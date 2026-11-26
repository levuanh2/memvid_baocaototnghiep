// V9.3 five-item bottom nav (owner approval after P3b): Tổng quan | Thư viện | Học tập |
// Luyện tập | Tiến độ, shown at <=700px. Real app on the Vite dev server, API mocked.
// Checks: one current item per route, 44px targets, labels not clipped, nothing past the
// viewport, keyboard reach, the chat composer never under the bar, hidden at 768px.
// 640px stands in for 1280px at 200% browser zoom (same CSS viewport).
import { test, expect } from "@playwright/test";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const DOC = {
  document_id: "d1", source_stem: "a", title: "A.pdf", display_name: "Tài liệu A", status: "completed",
  ingest_status: "index_ready", ai: { index: "ready", summary: { state: "ready" }, quiz: { ready: true }, review: { ready: false } },
};

async function open(page, path, { width = 390, dark = false } = {}) {
  await page.setViewportSize({ width, height: 800 });
  await page.addInitScript((isDark) => {
    localStorage.setItem("memvid-token", "fixture-token");
    localStorage.setItem("memvid-theme", isDark ? "dark" : "light");
  }, dark);
  await page.route(/localhost:8080\//, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/api/documents" || p === "/api/library") return route.fulfill(json({ documents: [DOC], collections: [] }));
    if (p === "/api/progress/overview") return route.fulfill(json({ document_count: 1, quiz_count: 0, attempt_count: 0, average_percentage: null }));
    if (p === "/api/progress/concepts") return route.fulfill(json({ concepts: [] }));
    if (p === "/api/progress/attempts") return route.fulfill(json({ attempts: [] }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [{ video: "a", video_stem: "a", filename: "A.pdf", status: "index_ready" }] }));
    if (p === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (p === "/summaries") return route.fulfill(json({ summaries: [] }));
    return route.fulfill(json({}));
  });
  await page.goto(path);
  await expect(page.locator("nav.app-bottom-nav")).toBeAttached();
}
const nav = (page) => page.locator("nav.app-bottom-nav");

const ROUTES = [
  ["/app/study/dashboard", "Tổng quan"],
  ["/app/study", "Thư viện"],
  ["/app", "Học tập"],
  ["/app/study/quiz/new", "Luyện tập"],
  ["/app/study/progress", "Tiến độ"],
];

for (const [path, label] of ROUTES) {
  test(`${path}: exactly one current item, "${label}"`, async ({ page }) => {
    await open(page, path);
    await expect(nav(page).locator("a")).toHaveText(["Tổng quan", "Thư viện", "Học tập", "Luyện tập", "Tiến độ"]);
    await expect(nav(page).locator("a[aria-current='page']")).toHaveText([label]);
  });
}

for (const width of [320, 390, 640]) {
  for (const dark of [false, true]) {
    test(`${width}px ${dark ? "dark" : "light"}: five targets fit, none clipped or past the edge`, async ({ page }) => {
      await open(page, "/app/study/dashboard", { width, dark });
      await expect(nav(page)).toBeVisible();
      const m = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll("nav.app-bottom-nav a")].map((a) => {
          const r = a.getBoundingClientRect();
          const label = a.querySelector("span");
          return { h: r.height, left: r.left, right: r.right, vw,
            clipped: label.scrollWidth > label.clientWidth + 0.5 || a.scrollWidth > a.clientWidth + 0.5 };
        });
      });
      expect(m).toHaveLength(5);
      for (const item of m) {
        expect(item.h).toBeGreaterThanOrEqual(44);
        expect(item.left).toBeGreaterThanOrEqual(-0.5);
        expect(item.right).toBeLessThanOrEqual(item.vw + 0.5);
        expect(item.clipped).toBe(false);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }
}

test("768px: the bottom nav is hidden", async ({ page }) => {
  await open(page, "/app/study/dashboard", { width: 768 });
  await expect(nav(page)).toBeHidden();
});

test("every item is reachable from the keyboard and shows its focus", async ({ page }) => {
  await open(page, "/app/study/dashboard");
  const links = nav(page).locator("a");
  for (let i = 0; i < 5; i += 1) {
    await links.nth(i).focus();
    await expect(links.nth(i)).toBeFocused();
  }
  await page.keyboard.press("Shift+Tab");
  await expect(links.nth(3)).toBeFocused();
  const outline = await links.nth(3).evaluate((a) => getComputedStyle(a).outlineStyle);
  expect(outline).not.toBe("none");
});

for (const width of [320, 390]) {
  test(`${width}px: the chat composer is never under the bar`, async ({ page }) => {
    await open(page, "/app", { width });
    const composer = page.locator("textarea:visible").last();
    await expect(composer).toBeVisible();
    const [c, n] = await Promise.all([composer.boundingBox(), nav(page).boundingBox()]);
    expect(c.y + c.height).toBeLessThanOrEqual(n.y + 0.5);
  });
}
