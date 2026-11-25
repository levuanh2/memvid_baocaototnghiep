// V9.3 follow-up to #212 (owner decision 2026-11-25): below 1600px the five modes sit inside the
// "Chế độ học" select, so a learner may never see the new Đọc nguồn and Ghi chú modes. A one-time
// note under the select names them. Browser-only (localStorage), no request, never takes focus.
import { test, expect } from "@playwright/test";
import { MODE_SELECT, chooseMode, waitForModeControl } from "./workspaceMode.js";

const API = /localhost:8080\//;
const KEY = "studymap.hint.modes.v1";
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

// The configs pre-seed the note as seen for every other spec; this one starts fresh.
test.use({ storageState: { cookies: [], origins: [] } });

async function openApp(page, { width, dark = false, blockStorage = false, seen = false } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ block, key, wasSeen }) => {
    localStorage.setItem("memvid-token", "fixture-token");
    if (wasSeen) localStorage.setItem(key, "1");
    if (block) {
      const realGet = Storage.prototype.getItem;
      const realSet = Storage.prototype.setItem;
      Storage.prototype.getItem = function (k) { if (k === key) throw new DOMException("blocked", "SecurityError"); return realGet.call(this, k); };
      Storage.prototype.setItem = function (k, v) { if (k === key) throw new DOMException("blocked", "SecurityError"); return realSet.call(this, k, v); };
    }
  }, { block: blockStorage, key: KEY, wasSeen: seen });
  const requests = [];
  page.on("request", (r) => { if (API.test(r.url())) requests.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await page.route(API, (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (pathname === "/usage/me") return route.fulfill(json({ plan: "Free", used: 120, reserved: 0, limit: 1000, remaining: 880, percentage: 12, reset_at: "2026-11-01T00:00:00Z", breakdown: {} }));
    if (pathname === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app");
  await waitForModeControl(page);
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForLoadState("networkidle");
  return { requests };
}

const hint = (page) => page.getByRole("note", { name: "Các chế độ học" });

for (const width of [390, 1024, 1366, 1536]) {
  for (const dark of [false, true]) {
    test(`${width}px ${dark ? "dark" : "light"}: first visit names the modes in the select, fits, takes no focus`, async ({ page }) => {
      await openApp(page, { width, dark });
      const note = hint(page);
      await expect(note).toBeVisible();
      await expect(note).toContainText("Đọc nguồn");
      await expect(note).toContainText("Ghi chú");
      // The select points at the note, so a screen reader hears it with the control.
      const describedBy = await page.locator(MODE_SELECT).getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(await note.getAttribute("id")).toBe(describedBy);
      // Never steals focus, never grows the header, never overflows the page.
      expect(await page.evaluate(() => document.activeElement?.closest?.('[role="note"]') ?? null)).toBeNull();
      const box = await note.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      const layout = await page.evaluate(() => ({
        header: Math.round(document.querySelector("header").getBoundingClientRect().height),
        docScroll: document.documentElement.scrollWidth, docClient: document.documentElement.clientWidth,
      }));
      expect(layout.header).toBe(56);
      expect(layout.docScroll).toBeLessThanOrEqual(layout.docClient);
      const ok = page.getByRole("button", { name: "Đã hiểu" });
      expect((await ok.boundingBox()).height).toBeGreaterThanOrEqual(40);
    });
  }
}

test("'Đã hiểu' hides the note for good, by mouse or keyboard, and sends nothing", async ({ page }) => {
  const { requests } = await openApp(page, { width: 1366 });
  const before = requests.length;
  const ok = page.getByRole("button", { name: "Đã hiểu" });
  await ok.focus();
  await page.keyboard.press("Enter");
  await expect(hint(page)).toHaveCount(0);
  // Focus lands on the select the note was about, not on the page body.
  await expect(page.locator(MODE_SELECT)).toBeFocused();
  expect(await page.locator(MODE_SELECT).getAttribute("aria-describedby")).toBeNull();
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe("1");
  expect(requests.slice(before)).toEqual([]);
  await page.reload();
  await waitForModeControl(page);
  await expect(hint(page)).toHaveCount(0);
});

test("choosing a mode in the select counts as seen", async ({ page }) => {
  await openApp(page, { width: 1366 });
  await expect(hint(page)).toBeVisible();
  await chooseMode(page, "Đọc nguồn");
  await expect(hint(page)).toHaveCount(0);
  await page.reload();
  await waitForModeControl(page);
  await expect(hint(page)).toHaveCount(0);
});

test("from 1600px the five tabs are on screen: no note", async ({ page }) => {
  await openApp(page, { width: 1600 });
  await expect(page.getByRole("tab", { name: "Ghi chú" })).toBeVisible();
  await expect(hint(page)).toBeHidden();
});

test("resizing to the tab band hides the note; back below 1600px shows it again until seen", async ({ page }) => {
  await openApp(page, { width: 1366 });
  await expect(hint(page)).toBeVisible();
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(hint(page)).toBeHidden();
  await page.setViewportSize({ width: 1366, height: 900 });
  await expect(hint(page)).toBeVisible();
});

test("Focus Mode hides the note; leaving it brings the note back", async ({ page }) => {
  await openApp(page, { width: 1366 });
  await page.locator("[data-focus-toggle]").click();
  await expect(hint(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-focus-toggle]")).toHaveAttribute("aria-pressed", "false");
  await expect(hint(page)).toBeVisible();
});

test("a returning learner who has seen it gets no note", async ({ page }) => {
  await openApp(page, { width: 1366, seen: true });
  await expect(hint(page)).toHaveCount(0);
});

test("blocked storage: the note still shows and 'Đã hiểu' still closes it", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openApp(page, { width: 1366, blockStorage: true });
  await expect(hint(page)).toBeVisible();
  await page.getByRole("button", { name: "Đã hiểu" }).click();
  await expect(hint(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
