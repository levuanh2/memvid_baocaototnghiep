// V9.3 typography (owner decision 2026-11-25): Be Vietnam Pro (UI) and IBM Plex Mono (technical
// text) are bundled with the app through @fontsource, not fetched from Google Fonts.
// getComputedStyle().fontFamily only echoes the CSS stack, so these tests check what the browser
// really loaded: FontFaceSet status, app-hosted WOFF2 responses, and rendered glyph widths.
import { test, expect } from "@playwright/test";
import { chooseMode, waitForModeControl } from "./workspaceMode.js";

const API = /localhost:8080\//;
const THIRD_PARTY_FONTS = /fonts\.googleapis\.com|fonts\.gstatic\.com/;
const VIETNAMESE = "Tiếng Việt có dấu: ắ ặ ẫ ữ ỡ ự ệ ộ ơ ư đ Đ";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const DOC = { document_id: "d1", source_stem: "alpha", title: "Hệ điều hành.md", status: "completed" };
const SECTIONS = [{ section_id: "s1", title: "Tiến trình", level: 1, order_index: 0 }];
const CHUNKS = [{ chunk_id: "chunk-a", embedding_id: "301", chunk_index: 0, section_id: "s1", text: "Hệ điều hành quản lý tiến trình, bộ nhớ và thiết bị ngoại vi." }];

async function openApp(page, { width = 1366, blockFonts = false } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  const fontResponses = [];
  const thirdParty = [];
  page.on("request", (r) => { if (THIRD_PARTY_FONTS.test(r.url())) thirdParty.push(r.url()); });
  page.on("response", (r) => { if (/\.woff2?(\?|$)/.test(r.url())) fontResponses.push({ url: r.url(), status: r.status() }); });
  if (blockFonts) await page.route(/\.woff2?(\?|$)/, (route) => route.abort());
  await page.route(API, (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "font@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/usage/me") return route.fulfill(json({ plan: "Free", used: 120, reserved: 0, limit: 1000, remaining: 880, percentage: 12, reset_at: "2026-11-01T00:00:00Z", breakdown: {} }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [{ video_stem: "alpha", filename: "Hệ điều hành.md", status: "index_ready", can_query: true }] }));
    if (p === "/api/documents") return route.fulfill(json({ documents: [DOC] }));
    if (p === "/api/documents/d1/sections") return route.fulfill(json({ document_id: "d1", sections: SECTIONS }));
    if (p === "/api/documents/d1/chunks") return route.fulfill(json({ document_id: "d1", total: 1, limit: 500, offset: 0, chunks: CHUNKS }));
    if (p === "/api/library") return route.fulfill(json({ documents: [DOC], collections: [] }));
    if (p === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (p === "/summaries") return route.fulfill(json({ summaries: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app?source=alpha");
  await waitForModeControl(page);
  return { fontResponses, thirdParty };
}

const settledFaces = (page) => page.evaluate(async () => {
  await document.fonts.ready;
  return [...document.fonts].map((f) => ({
    family: f.family.replace(/["']/g, ""), weight: String(f.weight), status: f.status, range: f.unicodeRange,
  }));
});

// Rendered proof: the same text measured with the app font first vs the bare fallback differs only
// when the app font really renders those glyphs.
const rendersWith = (page, family, weight, text) => page.evaluate(({ family: fam, weight: w, text: t }) => {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `${w} 20px "${fam}", monospace`;
  const withFont = ctx.measureText(t).width;
  ctx.font = `${w} 20px monospace`;
  return Math.abs(withFont - ctx.measureText(t).width) > 1;
}, { family, weight, text });

const firstFamily = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  return el ? getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim() : null;
}, selector);

test("Be Vietnam Pro and IBM Plex Mono load from the app's own assets, none from Google Fonts", async ({ page }) => {
  const { fontResponses, thirdParty } = await openApp(page);
  const faces = await settledFaces(page);
  const loaded = (family) => faces.filter((f) => f.family === family && f.status === "loaded");
  expect(loaded("Be Vietnam Pro").map((f) => f.weight)).toEqual(expect.arrayContaining(["400", "600"]));
  // The Vietnamese subset face (Latin Extended Additional, U+1EA0-1EF9) is the one in use.
  expect(loaded("Be Vietnam Pro").some((f) => /U\+1EA0/i.test(f.range))).toBe(true);
  expect(loaded("IBM Plex Mono").length).toBeGreaterThan(0);
  const origin = new URL(page.url()).origin;
  expect(fontResponses.length).toBeGreaterThan(0);
  for (const r of fontResponses) {
    expect(new URL(r.url).origin, r.url).toBe(origin);
    expect(r.status, r.url).toBe(200);
  }
  expect(thirdParty, "no request to Google Fonts").toEqual([]);
  expect(await rendersWith(page, "Be Vietnam Pro", 400, VIETNAMESE)).toBe(true);
  expect(await rendersWith(page, "Be Vietnam Pro", 600, VIETNAMESE)).toBe(true);
  expect(await rendersWith(page, "IBM Plex Mono", 400, "0 tài liệu · 0 đang chọn")).toBe(true);
});

test("body, headings, buttons, inputs, Reader and Notes use Be Vietnam Pro", async ({ page }) => {
  await openApp(page);
  await settledFaces(page);
  for (const sel of ["body", "header button", "#workspace-mode-select", 'textarea[aria-label="Câu hỏi cho tài liệu đã chọn"]']) {
    expect(await firstFamily(page, sel), sel).toBe("Be Vietnam Pro");
  }
  await chooseMode(page, "Đọc nguồn");
  await expect(page.getByRole("heading", { name: "Tiến trình" })).toBeVisible();
  expect(await firstFamily(page, ".reader-paper")).toBe("Be Vietnam Pro");
  expect(await firstFamily(page, ".reader-paper h1, .reader-paper h2, .reader-paper h3")).toBe("Be Vietnam Pro");
  await chooseMode(page, "Ghi chú");
  const note = page.getByRole("textbox", { name: /Ghi chú cho/ });
  await expect(note).toBeVisible();
  expect(await firstFamily(page, ".notes-pane__text")).toBe("Be Vietnam Pro");
  await note.fill(VIETNAMESE);
  const faces = await settledFaces(page);
  expect(faces.some((f) => f.family === "Be Vietnam Pro" && f.status === "loaded" && /U\+1EA0/i.test(f.range))).toBe(true);
});

for (const width of [390, 1366, 1600]) {
  test(`${width}px with font files blocked: the fallback keeps the header and the app usable`, async ({ page }) => {
    await openApp(page, { width, blockFonts: true });
    await page.evaluate(() => document.fonts.ready);
    const box = await page.evaluate(() => {
      const header = document.querySelector("header");
      return {
        height: Math.round(header.getBoundingClientRect().height),
        headerScroll: header.scrollWidth, headerClient: header.clientWidth,
        docScroll: document.documentElement.scrollWidth, docClient: document.documentElement.clientWidth,
      };
    });
    expect(box.height).toBe(56);
    expect(box.headerScroll).toBeLessThanOrEqual(box.headerClient);
    expect(box.docScroll).toBeLessThanOrEqual(box.docClient);
    await chooseMode(page, "Tóm tắt");
    await chooseMode(page, "Trò chuyện");
  });
}
