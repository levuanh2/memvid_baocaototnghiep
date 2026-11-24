// V9.3 P5a — fake-data-only Reader fixture. No hosted DB, learner data or backend.
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chooseMode } from "./workspaceMode.js";

const OUT = process.env.P5A_SHOT_OUT;
if (OUT) mkdirSync(OUT, { recursive: true });
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const DOC = { document_id: "d1", source_stem: "alpha", title: "Hệ điều hành.md", status: "completed" };
const SECTIONS = [
  { section_id: "s1", title: "Tiến trình", level: 1, order_index: 0 },
  { section_id: "s2", title: "Bộ nhớ", level: 1, order_index: 1 },
];
const LONG_TEXT = Array.from({ length: 18 }, (_, i) => `Đoạn đọc ${i + 1}: **hệ điều hành** quản lý tài nguyên, tiến trình và bộ nhớ.`).join("\n\n");
const CHUNKS = [
  { chunk_id: "chunk-a", embedding_id: "301", chunk_index: 0, section_id: "s1", text: LONG_TEXT },
  { chunk_id: "chunk-b", embedding_id: "302", chunk_index: 1, section_id: "s2", text: "## Phân trang\n\nBộ nhớ ảo tách không gian địa chỉ khỏi bộ nhớ vật lý." },
];

async function openReader(page, { width, dark = false, failSectionsOnce = false }) {
  await page.setViewportSize({ width, height: 820 });
  await page.addInitScript((theme) => {
    localStorage.setItem("memvid-token", "fixture-token");
    localStorage.setItem("memvid-theme", theme ? "dark" : "light");
  }, dark);
  let sectionCalls = 0;
  await page.route(/localhost:8080\//, (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "reader@example.test", provider: "local" } }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [{ video_stem: "alpha", filename: "Hệ điều hành.md", status: "index_ready", can_query: true }] }));
    if (p === "/api/documents") return route.fulfill(json({ documents: [DOC] }));
    if (p === "/api/documents/d1/sections") {
      sectionCalls += 1;
      if (failSectionsOnce && sectionCalls === 1) return route.fulfill(json({ error: "Mất kết nối fixture" }, 503));
      return route.fulfill(json({ document_id: "d1", sections: SECTIONS }));
    }
    if (p === "/api/documents/d1/chunks") {
      const offset = Number(url.searchParams.get("offset") || 0);
      const limit = Math.min(500, Number(url.searchParams.get("limit") || 500));
      return route.fulfill(json({ document_id: "d1", total: CHUNKS.length, limit, offset, chunks: CHUNKS.slice(offset, offset + limit) }));
    }
    if (p === "/api/library") return route.fulfill(json({ documents: [DOC], collections: [] }));
    if (p === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (p === "/summaries") return route.fulfill(json({ summaries: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app?source=alpha&tab=reader");
  if (!failSectionsOnce) await expect(page.getByRole("heading", { name: "Tiến trình" })).toBeVisible();
}

for (const width of [390, 768, 1440]) {
  for (const dark of [false, true]) {
    test(`${width}px ${dark ? "dark" : "light"}: Reader renders real sections without page fiction`, async ({ page }) => {
      await openReader(page, { width, dark });
      const fileNote = width <= 700
        ? page.locator(".reader-file-note")
        : page.locator(".artifact-toolbar__identity small");
      await expect(fileNote).toContainText("không phải bản xem trước file gốc");
      await expect(fileNote).toBeVisible();
      await expect(page.getByText(/trang \d+/i)).toHaveCount(0);
      if (width <= 700) await expect(page.getByLabel("Chế độ học")).toHaveValue("reader");
      else await expect(page.getByRole("tab", { name: "Đọc nguồn" })).toHaveAttribute("aria-selected", "true");
      if (OUT) await page.screenshot({ path: path.join(OUT, `reader-${width}-${dark ? "dark" : "light"}.png`), fullPage: true });
    });
  }
}

test("keyboard reaches the Reader tab and TOC, and mode switches keep reading position", async ({ page }) => {
  await openReader(page, { width: 768 });
  const scroll = page.locator(".reader-scroll");
  // Set the position only after every chunk page has loaded: a page arriving later grew the
  // content and shifted scrollTop by a few pixels when specs ran together (flaky 424 vs 420).
  await expect(page.getByText(/Đang tải \d+/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Bộ nhớ" })).toBeAttached();
  // #211 merge review P2: the content height was still changing here (web fonts / late layout:
  // scrollHeight 1589 or 1544 before settling at 1571), and scroll anchoring then moved the
  // position by a few px after `before` was read. Wait for fonts and a stable height first.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect.poll(async () => {
    const first = await scroll.evaluate((node) => node.scrollHeight);
    await page.waitForTimeout(150);
    return first === await scroll.evaluate((node) => node.scrollHeight);
  }, { timeout: 5000 }).toBe(true);
  await scroll.evaluate((node) => { node.scrollTop = 420; });
  // The contract is "the same position after the round trip". Read the position the Reader
  // actually holds once the scroll settled (scroll anchoring can move it a few pixels).
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const before = await scroll.evaluate((node) => node.scrollTop);
  expect(Math.abs(before - 420)).toBeLessThan(16);
  await chooseMode(page, "Trò chuyện");
  const readerTab = page.getByRole("tab", { name: "Đọc nguồn" });
  await readerTab.focus();
  await page.keyboard.press("Enter");
  await expect(readerTab).toHaveAttribute("aria-selected", "true");
  // Wait until the restored position is stable across frames, then require it exactly.
  await expect.poll(async () => {
    const first = await scroll.evaluate((node) => node.scrollTop);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const second = await scroll.evaluate((node) => node.scrollTop);
    return first === second ? second : null;
  }, { timeout: 5000 }).toBe(before);
  const toc = page.getByRole("navigation", { name: "Mục lục tài liệu" }).getByRole("button", { name: "Bộ nhớ" });
  await toc.focus();
  await expect(toc).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Bộ nhớ" })).toBeVisible();
});

test("a failed sections request has an in-place retry", async ({ page }) => {
  await openReader(page, { width: 1440, failSectionsOnce: true });
  const retry = page.getByRole("button", { name: "Thử tải lại mục lục" });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(page.getByRole("heading", { name: "Tiến trình" })).toBeVisible();
});
