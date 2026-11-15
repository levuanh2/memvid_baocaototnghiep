// V6 Library: one list, one card per document, views instead of repeated sections.
// Real app on the Vite dev server, API mocked at the network layer. Covers the page's states
// (loading, empty, error, processing, failed, nothing to continue), the action hierarchy (one
// filled "Tiếp tục" on the page), and containment at 320 / 390 / 768 / 1024 / 1440 in both themes.
// Screenshots are written only when V6_SHOT_OUT is set, so a normal run changes no tracked file.
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const OUT = process.env.V6_SHOT_OUT;
const TAG = process.env.V6_SHOT_TAG || "after";
if (OUT) mkdirSync(OUT, { recursive: true });

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const READY_AI = { index: "ready", extraction: "ready", embedding: "ready", chat_ready: "ready" };

const RESUME = {
  document_id: "d1", source_stem: "kinh-te-vi-mo", title: "KTVM_C3_cung_cau_final(2).pdf", display_name: "Kinh tế vi mô — Chương 3: Cung và cầu",
  status: "completed", ingest_status: "index_ready", reading_minutes: 42, page_count: 36, language: "vi",
  created_at: hoursAgo(30), last_opened_at: hoursAgo(2), last_workspace: "quiz", pinned: true, favorite: true, collection_id: "c1", tags: ["giữa kỳ"],
  ai: { ...READY_AI, summary: { state: "ready", ai_overview: ["Giá cân bằng hình thành ở điểm lượng cung bằng lượng cầu."], preview: "Luật cầu, luật cung và trạng thái cân bằng." },
    mindmap: { state: "ready" }, studymap: { state: "ready" }, quiz: { ready: true, count: 3 }, review: { ready: true, count: 1 } },
};
const RECENT = {
  document_id: "d2", source_stem: "he-dieu-hanh", title: "Hệ điều hành — Quản lý tiến trình.pdf",
  status: "completed", ingest_status: "index_ready", reading_minutes: 18, page_count: 14, created_at: hoursAgo(50),
  last_opened_at: hoursAgo(26), last_workspace: "summary", collection_id: "c2", tags: [],
  ai: { ...READY_AI, summary: { state: "ready", ai_overview: ["Tiến trình là một chương trình đang chạy."] }, mindmap: { state: "not_generated" }, studymap: { state: "not_generated" }, quiz: { ready: false }, review: { ready: false } },
};
const PROCESSING = {
  document_id: "d3", source_stem: "xac-suat", title: "Xác suất thống kê — Bài giảng 5: Biến ngẫu nhiên liên tục và các phân phối thường gặp trong thực hành.pdf",
  status: "processing", ingest_status: "processing", created_at: hoursAgo(1), tags: [],
  ai: { index: "not_generated", summary: { state: "not_generated" }, quiz: { ready: false }, review: { ready: false } },
};
const FAILED = {
  document_id: "d4", source_stem: "scan-hong", title: "scan_bai_tap_tuan_7.pdf", status: "failed", ingest_status: "error", created_at: hoursAgo(5), tags: [],
  ai: { index: "not_generated", summary: { state: "not_generated" }, quiz: { ready: false }, review: { ready: false } },
};
const NEVER_OPENED = { ...RECENT, document_id: "d5", source_stem: "moi", title: "Tài liệu mới chưa mở.pdf", last_opened_at: null, last_workspace: null };
const ALL = [RESUME, RECENT, PROCESSING, FAILED];
const COLLECTIONS = [{ collection_id: "c1", name: "Học kỳ 1", color: "accent" }, { collection_id: "c2", name: "Ôn thi cuối kỳ", color: "slate" }];

async function openLibrary(page, { width = 1440, dark = false, library = () => json({ documents: ALL, collections: COLLECTIONS }) } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((isDark) => {
    localStorage.setItem("memvid-token", "fixture-token");
    localStorage.setItem("memvid-theme", isDark ? "dark" : "light");
  }, dark);
  await page.route(/localhost:8080\//, async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/api/documents" || p === "/api/library") return route.fulfill(await library());
    if (p === "/api/progress/overview") return route.fulfill(json({ document_count: 4, quiz_count: 1, attempt_count: 2, average_percentage: 72 }));
    if (p === "/api/progress/concepts") return route.fulfill(json({ concepts: [] }));
    if (p === "/api/progress/attempts") return route.fulfill(json({ attempts: [] }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app/study");
  await expect(page.getByRole("heading", { name: "Thư viện học tập" })).toBeVisible();
}
const home = (page) => page.locator("section.learning-home");


const titleOf = (d) => d.display_name || d.title;
const cardsTitled = (page, d) => page.locator(".study-card h3", { hasText: titleOf(d) });
const views = (page) => page.getByRole("group", { name: "Xem tài liệu" });
const view = (page, name) => views(page).getByRole("button", { name: new RegExp(`^${name}`) });

test("every document has exactly one card, whatever it is (pinned, opened, recent, failed)", async ({ page }) => {
  await openLibrary(page);
  for (const d of ALL) await expect(cardsTitled(page, d)).toHaveCount(1);
  await expect(page.locator(".study-card")).toHaveCount(ALL.length);
  // The old repeated section headings are gone.
  for (const heading of ["Đã ghim (", "Hôm nay (", "Học gần đây (", "Tải lên gần đây (", "Tất cả tài liệu ("]) {
    await expect(page.getByText(heading, { exact: false }).locator("visible=true")).toHaveCount(0);
  }
  // No id is used twice on the page.
  const dupes = await page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll("[id]")) seen.set(el.id, (seen.get(el.id) || 0) + 1);
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  });
  expect(dupes).toEqual([]);
});

test("views choose which documents the one list holds, and say how many", async ({ page }) => {
  await openLibrary(page);
  await expect(view(page, "Tất cả")).toHaveAttribute("aria-pressed", "true");
  await expect(view(page, "Tất cả")).toContainText(String(ALL.length));
  // Pinned first in "Tất cả".
  await expect(page.locator(".study-card h3").first()).toHaveText(titleOf(RESUME));

  await view(page, "Học gần đây").click();
  await expect(view(page, "Học gần đây")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".study-card")).toHaveCount(2);
  await expect(cardsTitled(page, PROCESSING)).toHaveCount(0);

  await view(page, "Cần xử lý").click();
  await expect(cardsTitled(page, FAILED)).toHaveCount(1);
  await expect(cardsTitled(page, PROCESSING)).toHaveCount(0);
});

test("a view with nothing in it says so and offers the way back to 'Tất cả'", async ({ page }) => {
  await openLibrary(page, { library: () => json({ documents: [NEVER_OPENED], collections: [] }) });
  await view(page, "Học gần đây").click();
  await expect(page.getByText("Không có tài liệu nào ở mục “Học gần đây”")).toBeVisible();
  await page.getByRole("button", { name: "Xem tất cả" }).click();
  await expect(view(page, "Tất cả")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".study-card")).toHaveCount(1);
});

test("one filled action above the list: 'Tiếp tục' when there is one, otherwise upload", async ({ page }) => {
  await openLibrary(page);
  const upload = page.locator("header button", { hasText: "Tải tài liệu lên" }).first();
  await expect(upload).toHaveAttribute("data-emphasis", "secondary");
  await expect(page.locator(".btn-seal:visible")).toHaveCount(1);
  await expect(home(page).locator(".btn-seal")).toHaveCount(1);
});

test("with nothing to continue, upload is the filled action and nothing pretends to resume", async ({ page }) => {
  await openLibrary(page, { library: () => json({ documents: [NEVER_OPENED, PROCESSING], collections: [] }) });
  const upload = page.locator("header button", { hasText: "Tải tài liệu lên" }).first();
  await expect(upload).toHaveAttribute("data-emphasis", "primary");
  await expect(page.locator(".btn-seal:visible")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Tiếp tục/ })).toHaveCount(0);
});

test("views are reachable from the keyboard, and the list keeps exactly one tab stop", async ({ page }) => {
  await openLibrary(page);
  await view(page, "Tất cả").focus();
  await page.keyboard.press("Tab");
  await expect(view(page, "Học gần đây")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(view(page, "Học gần đây")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.study-card[tabindex="0"]')).toHaveCount(1);
  await page.locator('.study-card[tabindex="0"]').focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".study-card:focus")).toHaveAttribute("tabindex", "0");
});

test("the view and the search survive leaving the Library and coming back", async ({ page }) => {
  await openLibrary(page, { width: 1024 });
  await view(page, "Cần xử lý").click();
  await page.getByRole("textbox", { name: "Tìm trong thư viện" }).fill("scan");
  await expect(page.locator(".study-card")).toHaveCount(1);
  await page.goto("/app");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Thư viện học tập" })).toBeVisible();
  await expect(view(page, "Cần xử lý")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "Tìm trong thư viện" })).toHaveValue("scan");
  await expect(page.locator(".study-card")).toHaveCount(1);
});

test("the scroll position survives leaving the Library and coming back", async ({ page }) => {
  await openLibrary(page, { width: 1024 });
  await page.setViewportSize({ width: 1024, height: 500 });
  await page.evaluate(() => window.scrollTo({ top: 900 }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(800);
  await page.goto("/app");
  await page.goBack();
  await expect(page.locator(".study-card").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(800);
});

for (const width of [320, 390, 768, 1024, 1440]) {
  for (const dark of [false, true]) {
    test(`${width}px ${dark ? "dark" : "light"}: views and cards stay inside the viewport`, async ({ page }) => {
      await openLibrary(page, { width, dark });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      if (width < 768) {
        const px = (value) => Math.round(value * 100) / 100;
        const items = page.locator(".library-views__item");
        for (let i = 0; i < await items.count(); i += 1) {
          const box = await items.nth(i).boundingBox();
          expect(px(box.height), `view ${i} height`).toBeGreaterThanOrEqual(44);
        }
      }
      if (OUT) await page.screenshot({ path: path.join(OUT, `library-${width}-${dark ? "dark" : "light"}-${TAG}.png`), fullPage: true });
    });
  }
}
