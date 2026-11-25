// V9.3 laptop header (owner option 2, tab threshold moved to 1600px by the owner on 2026-11-25):
// below 1600px the five mode tabs are the labelled "Chế độ học" select; from 1600px five labelled
// tabs. The width the select saves gives the
// laptop header its text labels (Nguồn, Dẫn chứng, Tập trung, Thư viện học tập).
// Fixture only: the API is mocked at the network layer; no backend, no provider.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { MODE_SELECT, chooseMode, waitForModeControl } from "./workspaceMode.js";

const OUT = process.env.HEADER_SHOTS_DIR || "";
const API = /localhost:8080\//;
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const MODES = ["Trò chuyện", "Đọc nguồn", "Sơ đồ tư duy", "Tóm tắt", "Ghi chú"];
// A wide stand-in for the Linux fallback (DejaVu Sans): Be Vietnam Pro is never loaded, so CI
// renders system-ui = DejaVu, which made a Windows-fitting header overflow on Linux before.
const WIDE_FONT = "body,button,select,input,textarea,a,span{font-family:Verdana,'DejaVu Sans',sans-serif!important}";
const DOC = { document_id: "d1", title: "Hệ điều hành.md", status: "completed", ingest_status: "index_ready", progress: 1, source_stem: "alpha" };

async function openApp(page, { width, dark = false, wideFont = false, source = "" } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  const requests = [];
  page.on("request", (r) => { if (API.test(r.url())) requests.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await page.route(API, (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (pathname === "/usage/me") return route.fulfill(json({ plan: "Free", used: 120, reserved: 0, limit: 1000, remaining: 880, percentage: 12, reset_at: "2026-11-01T00:00:00Z", breakdown: {} }));
    if (pathname === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (pathname === "/list-indexed") return route.fulfill(json({ sources: [{ video_stem: "alpha", filename: "Hệ điều hành.md", status: "index_ready", can_query: true }] }));
    if (pathname === "/api/documents" || pathname === "/api/library") return route.fulfill(json({ documents: [DOC], collections: [] }));
    return route.fulfill(json({}));
  });
  await page.goto(source ? `/app?source=${source}` : "/app");
  await waitForModeControl(page);
  if (wideFont) await page.addStyleTag({ content: WIDE_FONT });
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForLoadState("networkidle");
  return { requests };
}

const visibleText = (page, selector) => page.evaluate((sel) => {
  const n = document.querySelector(sel);
  return n && n.checkVisibility() ? n.innerText.trim() : "";
}, selector);

const LABELS = {
  library: ".workspace-global-header .study-library-link",
  sources: '[data-panel-toggle="sources"]',
  evidence: '[data-panel-toggle="evidence"]',
  focus: "[data-focus-toggle]",
};

// The header's natural width: what its visible children need, against what it has.
const headerFit = (page) => page.evaluate(() => {
  const header = document.querySelector("header");
  const style = getComputedStyle(header);
  const visible = [...header.children].filter((n) => getComputedStyle(n).display !== "none");
  const widths = visible.reduce((sum, n) => sum + n.getBoundingClientRect().width, 0);
  const gap = Number.parseFloat(style.columnGap) || 0;
  const controls = [...header.querySelectorAll("a, button, select")].filter((n) => n.checkVisibility());
  return {
    height: Math.round(header.getBoundingClientRect().height),
    slack: Math.round(header.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
      - widths - gap * Math.max(0, visible.length - 1)),
    headerScroll: header.scrollWidth, headerClient: header.clientWidth,
    docScroll: document.documentElement.scrollWidth, docClient: document.documentElement.clientWidth,
    small: controls.filter((n) => n.getBoundingClientRect().height < 40 || n.getBoundingClientRect().width < 40)
      .map((n) => n.getAttribute("aria-label") || n.textContent.trim()),
    unnamed: controls.filter((n) => !(n.getAttribute("aria-label") || n.labels?.length || n.textContent.trim())).length,
  };
});

// The longest option must fit the select's text box (the chevron is drawn over the padding).
const selectFits = (page) => page.evaluate((sel) => {
  const select = document.querySelector(sel);
  const style = getComputedStyle(select);
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const longest = Math.max(...[...select.options].map((o) => ctx.measureText(o.text).width));
  const room = select.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
  return { longest: Math.ceil(longest), room };
}, MODE_SELECT);

const SELECT_WIDTHS = [320, 375, 390, 700, 701, 1024, 1280, 1366, 1440, 1536, 1599];
const TAB_WIDTHS = [1600, 1800, 1920];

for (const wideFont of [false, true]) {
  for (const dark of [false, true]) {
    for (const width of [...SELECT_WIDTHS, ...TAB_WIDTHS]) {
      test(`${width}px ${dark ? "dark" : "light"}${wideFont ? " wide-font" : ""}: one row, no overflow, the mode is named in text`, async ({ page }) => {
        await openApp(page, { width, dark, wideFont });
        const fit = await headerFit(page);
        expect(fit.height).toBe(56);
        expect(fit.headerScroll).toBeLessThanOrEqual(fit.headerClient);
        expect(fit.docScroll).toBeLessThanOrEqual(fit.docClient);
        // Laptop and desktop: Linux renders wider than this machine, keep real room, not a 1px fit.
        // Phones have their own tighter contract in mobile-header.spec.js; here they must fit.
        if (width >= 1024) expect(fit.slack, "natural header slack").toBeGreaterThanOrEqual(wideFont ? 16 : 40);
        else expect(fit.slack, "natural header slack").toBeGreaterThanOrEqual(0);
        expect(fit.small, "controls under 40px").toEqual([]);
        expect(fit.unnamed).toBe(0);
        const select = page.locator(MODE_SELECT);
        if (width < 1600) {
          await expect(select).toBeVisible();
          await expect(page.getByRole("tablist", { name: "Chế độ Workspace" })).toBeHidden();
          await expect(select.locator("option:checked")).toHaveText("Trò chuyện");
          const box = await selectFits(page);
          expect(box.longest, "longest mode name fits the select").toBeLessThanOrEqual(box.room);
        } else {
          await expect(select).toBeHidden();
          for (const name of MODES) {
            await expect(page.locator(`nav[role="tablist"] [role="tab"][title="${name}"] .workspace-mode-label`)).toBeVisible();
          }
        }
        if (OUT && [1280, 1366, 1440, 1536, 1600].includes(width) && !wideFont) {
          fs.mkdirSync(OUT, { recursive: true });
          await page.locator("header").screenshot({ path: path.join(OUT, `header-${width}-${dark ? "dark" : "light"}.png`) });
        }
      });
    }
  }
}

// Labels by width, from the measured budget (header-measure-*.json in the QA evidence):
// select band (< 1600px): panel labels from 1280px, library label from 1366px, so the whole
// 1366-1599px laptop range has every label; tab band: library label, panel labels from 1800px
// (five labelled tabs need the room below that).
const EXPECT_LABELS = {
  1024: { library: "", sources: "", evidence: "", focus: "" },
  1280: { library: "", sources: "Nguồn", evidence: "Dẫn chứng", focus: "Tập trung" },
  1366: { library: "Thư viện học tập", sources: "Nguồn", evidence: "Dẫn chứng", focus: "Tập trung" },
  1440: { library: "Thư viện học tập", sources: "Nguồn", evidence: "Dẫn chứng", focus: "Tập trung" },
  1536: { library: "Thư viện học tập", sources: "Nguồn", evidence: "Dẫn chứng", focus: "Tập trung" },
  1599: { library: "Thư viện học tập", sources: "Nguồn", evidence: "Dẫn chứng", focus: "Tập trung" },
  1600: { library: "Thư viện học tập", sources: "", evidence: "", focus: "" },
  1800: { library: "Thư viện học tập", sources: "Nguồn", evidence: "Dẫn chứng", focus: "Tập trung" },
};
for (const [width, want] of Object.entries(EXPECT_LABELS)) {
  test(`${width}px: text labels where they fit`, async ({ page }) => {
    await openApp(page, { width: Number(width) });
    const got = {};
    for (const [key, sel] of Object.entries(LABELS)) got[key] = await visibleText(page, sel);
    expect(got).toEqual(want);
  });
}

test("resizing between the select and the tabs keeps the mode, Focus Mode, drafts, and sends nothing", async ({ page }) => {
  const { requests } = await openApp(page, { width: 1600, source: "alpha" });
  const chat = page.locator('textarea[aria-label="Câu hỏi cho tài liệu đã chọn"]');
  await chat.fill("Nháp câu hỏi chưa gửi");
  await chooseMode(page, "Ghi chú");
  const note = page.getByRole("textbox", { name: /Ghi chú cho/ });
  await note.fill("Ghi chú đang viết");
  await chooseMode(page, "Tóm tắt");
  await page.waitForLoadState("networkidle");
  const before = requests.length;
  for (const width of [1366, 1600, 1024, 1536, 1280, 1920, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(`nav[role="tablist"] [role="tab"][title="Tóm tắt"]`)).toHaveAttribute("aria-selected", "true");
    if (width < 1600) await expect(page.locator(MODE_SELECT)).toHaveValue("summary");
  }
  await page.getByRole("button", { name: "Tập trung" }).click();
  await page.setViewportSize({ width: 1366, height: 900 });
  await expect(page.locator("[data-focus-toggle]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(MODE_SELECT)).toHaveValue("summary");
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(page.locator("[data-focus-toggle]")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-focus-toggle]")).toHaveAttribute("aria-pressed", "false");
  expect(requests.slice(before), "a display change sends nothing").toEqual([]);
  // Reader was never opened: it loaded nothing.
  expect(requests.filter((r) => /\/sections|\/chunks/.test(r))).toEqual([]);
  await chooseMode(page, "Ghi chú");
  await expect(note).toHaveValue("Ghi chú đang viết");
  await chooseMode(page, "Trò chuyện");
  await expect(chat).toHaveValue("Nháp câu hỏi chưa gửi");
});

test("1366px keyboard: Tab reaches the mode select and the arrow keys change the mode", async ({ page }) => {
  await openApp(page, { width: 1366 });
  const select = page.locator(MODE_SELECT);
  await select.focus();
  await expect(select).toBeFocused();
  const ring = await select.evaluate((n) => getComputedStyle(n).outlineStyle);
  expect(ring).not.toBe("none");
  await page.keyboard.press("ArrowDown");
  await expect(select).toHaveValue("reader");
  await expect(page.locator(`nav[role="tablist"] [role="tab"][title="Đọc nguồn"]`)).toHaveAttribute("aria-selected", "true");
});

test("1600px keyboard: every mode tab is reachable and selectable", async ({ page }) => {
  await openApp(page, { width: 1600 });
  for (const name of MODES) {
    const tab = page.getByRole("tab", { name });
    await tab.focus();
    await expect(tab).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(tab).toHaveAttribute("aria-selected", "true");
  }
});

// Browser zoom 200% halves the CSS viewport: a 1366px laptop becomes 683px, a 1536px one 768px.
for (const width of [683, 768]) {
  test(`zoom 200% (${width}px CSS): the header still fits and names the mode`, async ({ page }) => {
    await openApp(page, { width });
    const fit = await headerFit(page);
    expect(fit.headerScroll).toBeLessThanOrEqual(fit.headerClient);
    expect(fit.docScroll).toBeLessThanOrEqual(fit.docClient);
    await expect(page.locator(MODE_SELECT)).toBeVisible();
    await chooseMode(page, "Sơ đồ tư duy");
    await expect(page.locator(MODE_SELECT)).toHaveValue("mindmap");
  });
}
