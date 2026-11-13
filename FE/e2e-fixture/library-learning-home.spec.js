// V6 Library: the learning home (#172) and the document card (#171) on one page.
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
    if (p === "/api/progress/overview") return route.fulfill(json({ average_percentage: 72 }));
    if (p === "/api/progress/concepts") return route.fulfill(json({ concepts: [] }));
    if (p === "/api/progress/attempts") return route.fulfill(json({ attempts: [] }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app/study");
  await expect(page.getByRole("heading", { name: "Thư viện học tập" })).toBeVisible();
}
const home = (page) => page.locator("section.learning-home");
const cardOf = (page, title) => page.locator(".study-card", { has: page.getByRole("heading", { name: title, exact: true }) }).first();

test("the learning home names the document to pick up and holds the page's only filled 'Tiếp tục'", async ({ page }) => {
  await openLibrary(page);
  await expect(home(page).getByRole("heading", { name: "Học tiếp" })).toBeVisible();
  await expect(home(page).locator(".learning-home__title")).toHaveText(RESUME.display_name);
  await expect(home(page).getByText(/Mở lần cuối 2 giờ trước, ở Quiz\./)).toBeVisible();
  // One filled continue on the page: in the home. Every card's "Tiếp tục" is outlined.
  await expect(home(page).locator(".btn-seal")).toHaveCount(1);
  await expect(page.locator(".study-card .btn-seal")).toHaveCount(0);
  const cardResume = cardOf(page, RESUME.display_name).locator(".study-card__resume");
  await expect(cardResume).toHaveAttribute("data-emphasis", "secondary");
  // The other recently opened document is offered once, in "Mở gần đây", not as a second resume.
  await expect(home(page).locator(".learning-home__recent button")).toHaveCount(1);
  await expect(home(page).locator(".learning-home__recent-name")).toHaveText(RECENT.title);
});

test("continuing from the home works from the keyboard and leaves the Library", async ({ page }) => {
  await openLibrary(page);
  const cta = home(page).locator(".btn-seal");
  await cta.focus();
  await expect(cta).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/\/app\/study$/);
});

test("while the library is loading there is no learning home and no empty-library message", async ({ page }) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  await openLibrary(page, { library: async () => { await gate; return json({ documents: ALL, collections: COLLECTIONS }); } });
  await expect(home(page)).toHaveCount(0);
  await expect(page.getByText("Chưa có tài liệu nào đang học dở")).toHaveCount(0);
  await expect(page.locator(".study-card")).toHaveCount(0);
  release();
  await expect(home(page)).toBeVisible();
});

test("an empty library has no learning home", async ({ page }) => {
  await openLibrary(page, { library: () => json({ documents: [], collections: [] }) });
  await expect(page.locator(".study-card")).toHaveCount(0);
  await expect(home(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Tải tài liệu lên/ }).first()).toBeVisible();
});

test("a failed library load shows the error and a retry, not a learning home", async ({ page }) => {
  let fail = true;
  await openLibrary(page, { library: () => (fail ? json({ error: "boom" }, 500) : json({ documents: ALL, collections: COLLECTIONS })) });
  await expect(home(page)).toHaveCount(0);
  const retry = page.getByRole("button", { name: "Thử lại" });
  await expect(retry).toBeVisible();
  fail = false;
  await retry.click();
  await expect(home(page)).toBeVisible();
});

test("with nothing to continue the home says so and has no filled button", async ({ page }) => {
  await openLibrary(page, { library: () => json({ documents: [NEVER_OPENED, PROCESSING], collections: [] }) });
  await expect(home(page).getByText("Chưa có tài liệu nào đang học dở")).toBeVisible();
  await expect(home(page).locator(".btn-seal")).toHaveCount(0);
  await expect(home(page).locator(".learning-home__recent")).toHaveCount(0);
});

test("a processing document and a failed one say so in words and offer no study tools", async ({ page }) => {
  await openLibrary(page);
  const processing = cardOf(page, PROCESSING.title);
  await expect(processing.locator(".study-card__state")).toContainText("Tài liệu chưa được lập chỉ mục.");
  await expect(processing.locator(".study-card__tool")).toHaveCount(0);
  await expect(processing.locator("button[disabled]")).toHaveCount(0);
  const failed = cardOf(page, FAILED.title);
  await expect(failed.locator(".study-card__state")).toContainText("Xử lý tài liệu này bị lỗi.");
  await expect(failed.locator(".study-card__tool")).toHaveCount(0);
  // A ready document still reaches every study tool that is not its "Tiếp tục" destination.
  const ready = cardOf(page, RESUME.display_name);
  for (const name of ["Tóm tắt", "Bản đồ kiến thức", "Ôn tập", "Hỏi AI"]) {
    await expect(ready.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(ready.getByRole("button", { name: /Tiếp tục · Quiz/ })).toBeVisible();
});

for (const width of [320, 390, 768, 1024, 1440]) {
  for (const dark of [false, true]) {
    test(`${width}px ${dark ? "dark" : "light"}: home and cards stay inside the viewport, targets are large enough`, async ({ page }) => {
      await openLibrary(page, { width, dark });
      await expect(home(page)).toBeVisible();
      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        const wide = [...document.querySelectorAll(".learning-home, .learning-home *, .study-card, .study-card *")]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > root.clientWidth + 0.5 || r.left < -0.5); })
          .map((el) => el.className || el.tagName);
        return { doc: root.scrollWidth - root.clientWidth, wide: [...new Set(wide)].slice(0, 5) };
      });
      expect(overflow.doc, "horizontal page overflow").toBeLessThanOrEqual(0);
      expect(overflow.wide, "elements past the viewport edge").toEqual([]);

      if (width < 768) {
        // Phones: the controls a thumb uses on the home and on a card are at least 44px tall.
        const px = (value) => Math.round(value * 100) / 100;
        const targets = page.locator(".learning-home__cta, .learning-home__recent button, .study-card__resume, .study-card__tool, .study-card__details, .study-card__menu-trigger");
        const count = await targets.count();
        expect(count).toBeGreaterThan(6);
        for (let i = 0; i < count; i += 1) {
          const box = await targets.nth(i).boundingBox();
          if (!box) continue;
          expect(px(box.height), `target ${i} height`).toBeGreaterThanOrEqual(44);
        }
      }
      if (OUT) await page.screenshot({ path: path.join(OUT, `library-${width}-${dark ? "dark" : "light"}-${TAG}.png`), fullPage: true });
    });
  }
}

test("arrow keys move focus between the cards of the list, and keys on a tool stay with the tool", async ({ page }) => {
  await openLibrary(page);
  const tabStop = page.locator('.study-card[tabindex="0"]');
  await expect(tabStop).toHaveCount(1);
  await tabStop.focus();
  const first = await tabStop.locator("h3").textContent();
  await page.keyboard.press("ArrowDown");
  // Focus moved with the tab stop (it used to stay on the card that had just become untabbable).
  const focused = page.locator(".study-card:focus");
  await expect(focused).toHaveCount(1);
  await expect(focused).toHaveAttribute("tabindex", "0");
  expect(await focused.locator("h3").textContent()).not.toBe(first);

  // Space on a tool inside a card activates the tool; it does not select the card.
  const ready = cardOf(page, RESUME.display_name);
  await ready.getByRole("button", { name: "Tóm tắt", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page).toHaveURL(/tab=summary/);
});
