// Mobile global header: one row, 40x40 controls, no overlap, one owner per action.
// Runs the REAL workspace (MainLayout) on the Vite dev server with the API mocked at the
// network layer, so it needs no backend, no provider, and no production data.
import { test, expect } from "@playwright/test";

const API = /localhost:8080\//;
const MIN = 40;

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function openApp(page, { width, height, dark = false }) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(API, (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (pathname === "/usage/me") return route.fulfill(json({ plan: "Free", used: 120, reserved: 0, limit: 1000, remaining: 880, percentage: 12, reset_at: "2026-11-01T00:00:00Z", breakdown: {} }));
    if (pathname === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (pathname === "/list-indexed") return route.fulfill(json({ sources: [] }));
    if (pathname === "/api/documents") return route.fulfill(json({ documents: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app");
  await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor({ state: "visible", timeout: 30000 });
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
}

// Center point of a control must hit the control itself or one of its descendants.
const hitOwnership = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return { found: false };
  const b = el.getBoundingClientRect();
  const x = b.left + b.width / 2, y = b.top + b.height / 2;
  const top = document.elementFromPoint(x, y);
  return {
    found: true,
    w: Math.round(b.width),
    h: Math.round(b.height),
    ok: !!top && (top === el || el.contains(top)),
    at: top ? top.tagName + "." + String(top.getAttribute("class") || "").slice(0, 40) : null,
  };
}, selector);

const MOBILE = [
  { width: 320, height: 720 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
];

for (const vp of MOBILE) {
  for (const dark of [false, true]) {
    test.describe(`mobile header ${vp.width}x${vp.height} ${dark ? "dark" : "light"}`, () => {
      test("header stays one 56px row, page has no horizontal overflow", async ({ page }) => {
        await openApp(page, { ...vp, dark });
        const h = await page.evaluate(() => {
          const nav = document.querySelector('nav[role="tablist"]');
          return {
            height: Math.round(document.querySelector("header").getBoundingClientRect().height),
            docScroll: document.documentElement.scrollWidth,
            docClient: document.documentElement.clientWidth,
            navScroll: nav.scrollWidth,
            navClient: nav.clientWidth,
          };
        });
        expect(h.height).toBe(56);
        expect(h.docScroll).toBeLessThanOrEqual(h.docClient);
        expect(h.navScroll).toBeLessThanOrEqual(h.navClient);
      });

      test("MemVid home control is a real 40x40 link", async ({ page }) => {
        await openApp(page, { ...vp, dark });
        const r = await hitOwnership(page, 'header a[aria-label^="MemVidX"]');
        expect(r.found, "home link present").toBe(true);
        expect(r.w).toBeGreaterThanOrEqual(MIN);
        expect(r.h).toBeGreaterThanOrEqual(MIN);
        expect(r.ok, `center hit at ${r.at}`).toBe(true);
      });

      test("each mode tab is 40x40 and its center belongs to itself", async ({ page }) => {
        await openApp(page, { ...vp, dark });
        for (const name of ["Trò chuyện", "Sơ đồ tư duy", "Tóm tắt"]) {
          const r = await page.evaluate((label) => {
            const el = [...document.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute("title") === label);
            if (!el) return { found: false };
            const b = el.getBoundingClientRect();
            const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return {
              found: true,
              w: Math.round(b.width),
              h: Math.round(b.height),
              ok: !!top && (top === el || el.contains(top)),
              at: top ? top.tagName + "." + String(top.getAttribute("class") || "").slice(0, 40) : null,
            };
          }, name);
          expect(r.found, `${name} present`).toBe(true);
          expect(r.w, `${name} width`).toBeGreaterThanOrEqual(MIN);
          expect(r.h, `${name} height`).toBeGreaterThanOrEqual(MIN);
          expect(r.ok, `${name} center hit at ${r.at}`).toBe(true);
          await expect(page.getByRole("tab", { name })).toBeVisible();
        }
      });

      test("mode switch is fixed width, not clipped, and one tap changes aria-selected once", async ({ page }) => {
        await openApp(page, { ...vp, dark });
        const nav = await page.evaluate(() => {
          const n = document.querySelector('nav[role="tablist"]');
          return { sw: n.scrollWidth, cw: n.clientWidth, overflowX: getComputedStyle(n).overflowX };
        });
        expect(nav.sw).toBeLessThanOrEqual(nav.cw);
        expect(nav.overflowX).not.toBe("auto");
        await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
        await expect(page.getByRole("tab", { name: "Sơ đồ tư duy" })).toHaveAttribute("aria-selected", "true");
        await page.getByRole("tab", { name: "Tóm tắt" }).click();
        await expect(page.getByRole("tab", { name: "Tóm tắt" })).toHaveAttribute("aria-selected", "true");
        await page.getByRole("tab", { name: "Trò chuyện" }).click();
        await expect(page.getByRole("tab", { name: "Trò chuyện" })).toHaveAttribute("aria-selected", "true");
      });

      test("every control keeps its own center hit in each global mode", async ({ page }) => {
        await openApp(page, { ...vp, dark });
        const controls = [
          'header a[aria-label^="MemVidX"]',
          'nav[role="tablist"] [role="tab"][title="Trò chuyện"]',
          'nav[role="tablist"] [role="tab"][title="Sơ đồ tư duy"]',
          'nav[role="tablist"] [role="tab"][title="Tóm tắt"]',
          'header button[aria-label="Mở công cụ StudyMap"]',
          'header button[aria-label^="Mức sử dụng AI"]',
          'header button[aria-haspopup="menu"][aria-label^="Tài khoản"]',
        ];
        for (const mode of ["Trò chuyện", "Sơ đồ tư duy", "Tóm tắt"]) {
          await page.getByRole("tab", { name: mode }).click();
          for (const sel of controls) {
            const r = await hitOwnership(page, sel);
            expect(r.found, `${sel} present in ${mode}`).toBe(true);
            expect(r.w, `${sel} width in ${mode}`).toBeGreaterThanOrEqual(MIN);
            expect(r.h, `${sel} height in ${mode}`).toBeGreaterThanOrEqual(MIN);
            expect(r.ok, `${sel} center hit in ${mode} at ${r.at}`).toBe(true);
          }
        }
      });

      test("usage control is a compact 40x40 button with a status cue that opens the popover", async ({ page }) => {
        await openApp(page, { ...vp, dark });
        const usage = page.locator('header button[aria-label^="Mức sử dụng AI"]');
        await expect(usage).toHaveCount(1);
        const r = await hitOwnership(page, 'header button[aria-label^="Mức sử dụng AI"]');
        expect(r.w).toBeGreaterThanOrEqual(MIN);
        expect(r.h).toBeGreaterThanOrEqual(MIN);
        expect(r.ok, `center hit at ${r.at}`).toBe(true);
        await usage.click();
        await expect(page.getByRole("dialog", { name: "Mức sử dụng AI" })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog", { name: "Mức sử dụng AI" })).toHaveCount(0);
      });

      test("account avatar is a 40x40 control that opens the account menu", async ({ page }) => {
        await openApp(page, { ...vp, dark });
        const sel = 'header button[aria-haspopup="menu"][aria-label^="Tài khoản"]';
        await expect(page.locator(sel)).toHaveCount(1);
        const r = await hitOwnership(page, sel);
        expect(r.w).toBeGreaterThanOrEqual(MIN);
        expect(r.h).toBeGreaterThanOrEqual(MIN);
        expect(r.ok, `center hit at ${r.at}`).toBe(true);
        await page.locator(sel).click();
        await expect(page.getByRole("menu").filter({ hasText: "qa@example.test" })).toBeVisible();
      });

      test("exactly one workspace-tools owner on mobile, 40x40, with the moved actions inside it", async ({ page }) => {
        await openApp(page, { ...vp, dark });
        const owner = page.locator('header button[aria-label="Mở công cụ StudyMap"]');
        await expect(owner).toHaveCount(1);
        await expect(page.locator('header button[aria-label="Mở công cụ"]')).toHaveCount(0);
        await expect(page.locator('header button[aria-label="Mở thư mục nguồn"]')).toHaveCount(0);
        const r = await hitOwnership(page, 'header button[aria-label="Mở công cụ StudyMap"]');
        expect(r.w).toBeGreaterThanOrEqual(MIN);
        expect(r.h).toBeGreaterThanOrEqual(MIN);
        expect(r.ok, `center hit at ${r.at}`).toBe(true);
        await owner.click();
        const menu = page.getByRole("menu", { name: "Công cụ học" });
        await expect(menu).toBeVisible();
        const box = await menu.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
        await expect(menu.getByRole("menuitem", { name: /Gia sư AI/ })).toBeVisible();
        await expect(menu.getByRole("menuitem", { name: /Mở thư mục nguồn/ })).toBeVisible();
        await expect(menu.getByRole("menuitem", { name: /Mở công cụ/ })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
      });
    });
  }
}

test.describe("desktop and tablet header is not enlarged", () => {
  for (const vp of [{ width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 1024 }]) {
    test(`${vp.width}x${vp.height}: one 56px row, no overflow, mode tabs keep their labels`, async ({ page }) => {
      await openApp(page, vp);
      const h = await page.evaluate(() => ({
        height: Math.round(document.querySelector("header").getBoundingClientRect().height),
        docScroll: document.documentElement.scrollWidth,
        docClient: document.documentElement.clientWidth,
      }));
      expect(h.height).toBe(56);
      expect(h.docScroll).toBeLessThanOrEqual(h.docClient);
      await expect(page.getByRole("tab", { name: "Sơ đồ tư duy" })).toContainText("Sơ đồ tư duy");
    });
  }
});
