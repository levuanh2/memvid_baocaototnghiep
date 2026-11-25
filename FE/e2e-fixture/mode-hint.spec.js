// V9.3 follow-up to #212 (owner decision 2026-11-25): below 1600px the five modes sit inside the
// "Chế độ học" select, so a learner may never see the new Đọc nguồn and Ghi chú modes. A one-time
// note under the select names them. Browser-only (localStorage), no request, never takes focus.
import { test, expect } from "@playwright/test";
import { MODE_SELECT, chooseMode, waitForModeControl } from "./workspaceMode.js";

const API = /localhost:8080\//;
const KEY = "studymap.hint.modes.v1";
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

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

const hint = (page) => page.locator('#workspace-mode-hint[role="note"]');

for (const width of [320, 375, 390, 1024, 1366, 1536]) {
  for (const dark of [false, true]) {
    test(`${width}px ${dark ? "dark" : "light"}: first visit names the modes in the select, fits, takes no focus`, async ({ page }) => {
      await openApp(page, { width, dark });
      const note = hint(page);
      await expect(note).toBeVisible();
      await expect(note).toContainText("Đọc nguồn");
      await expect(note).toContainText("Ghi chú");
      // The select points at the note, so a screen reader hears it with the control, and the
      // note's text does not collide with the select's own label.
      await expect(page.getByLabel("Chế độ học")).toHaveCount(1);
      const describedBy = await page.locator(MODE_SELECT).getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      // It points at the text only, so "Đã hiểu" is not read as part of the description.
      expect(await note.locator("p").getAttribute("id")).toBe(describedBy);
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
  // Keyboard: a pointer press anywhere already sets the note aside for this visit.
  await page.locator("[data-focus-toggle]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-focus-toggle]")).toHaveAttribute("aria-pressed", "true");
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

// Side-agent finding: the first full run had 51 specs blocked by the floating note. It must never
// block: its body lets clicks through to what is under it, and the first press anywhere outside
// "Đã hiểu" hides it for this visit (not saved, so it comes back on the next visit until seen).
for (const width of [390, 1024, 1366]) {
  test(`${width}px first visit: a click under the note reaches the page, and the note steps aside`, async ({ page }) => {
    await openApp(page, { width });
    const note = hint(page);
    await expect(note).toBeVisible();
    const target = await note.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const x = b.left + 12, y = b.top + 12; // on the text, away from the button
      el.style.visibility = "hidden";
      const under = document.elementFromPoint(x, y);
      el.style.visibility = "";
      under.setAttribute("data-under-note", "1");
      under.addEventListener("click", () => { window.__underClicked = true; }, { once: true });
      return { x, y };
    });
    await page.mouse.click(target.x, target.y);
    expect(await page.evaluate(() => window.__underClicked === true)).toBe(true);
    await expect(note).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
    await page.reload();
    await waitForModeControl(page);
    await expect(hint(page)).toBeVisible();
  });
}

test("opening the tools menu or a side drawer hides the note while it is open", async ({ page }) => {
  await openApp(page, { width: 1024 });
  await expect(hint(page)).toBeVisible();
  await page.locator('header button[aria-label="Mở công cụ học"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu", { name: "Công cụ học" })).toBeVisible();
  await expect(hint(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Công cụ học" })).toBeHidden();
  await expect(hint(page)).toBeVisible();
});

// Owner decision (2026-11-25): the note shows on at most 3 visits where it is actually on screen,
// then stops by itself. "Đã hiểu" or a mode change through the select still end it at once.
test("the note shows on three visits at most, then stops by itself", async ({ page }) => {
  await openApp(page, { width: 1366 });
  for (let visit = 1; visit <= 3; visit += 1) {
    if (visit > 1) { await page.reload(); await waitForModeControl(page); }
    await expect(hint(page), `visit ${visit}`).toBeVisible();
  }
  await page.reload();
  await waitForModeControl(page);
  await expect(hint(page)).toHaveCount(0);
});

test("visits where the note is not on screen (from 1600px) do not count", async ({ page }) => {
  await openApp(page, { width: 1600 });
  for (let visit = 1; visit <= 3; visit += 1) { await page.reload(); await waitForModeControl(page); }
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.reload();
  await waitForModeControl(page);
  await expect(hint(page)).toBeVisible();
});
