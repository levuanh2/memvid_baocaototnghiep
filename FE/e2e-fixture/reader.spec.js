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
  await scroll.evaluate((node) => { node.scrollTop = 420; });
  await chooseMode(page, "Trò chuyện");
  const readerTab = page.getByRole("tab", { name: "Đọc nguồn" });
  await readerTab.focus();
  await page.keyboard.press("Enter");
  await expect(readerTab).toHaveAttribute("aria-selected", "true");
  expect(await scroll.evaluate((node) => node.scrollTop)).toBe(420);
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
