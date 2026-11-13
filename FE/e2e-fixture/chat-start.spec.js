// Chat start screen (V6): with documents in the library and nothing selected, the centre offers
// the documents themselves; once one is selected it offers first questions. Real app on the Vite
// dev server, API mocked at the network layer. Set CHAT_QA_DIR to also write captures.
import { test, expect } from "@playwright/test";
import path from "node:path";

const OUT = process.env.CHAT_QA_DIR;
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const DOCS = ["Kinh tế vi mô - Chương 2.pdf", "Triết học Mác-Lênin - Đề cương.docx", "Xác suất thống kê - Bài giảng 5.pptx", "Tội phạm mạng và máy tính.docx", "Ứng dụng công nghệ.docx"]
  .map((filename, i) => ({ video: `doc${i}`, video_stem: `doc${i}`, filename, num_chunks: 10 + i, status: "ready" }));

async function openChat(page, { width, height = 900, dark = false, blockFonts = false, url = "/app" }) {
  await page.setViewportSize({ width, height });
  await page.addInitScript((d) => {
    localStorage.setItem("memvid-token", "fixture-token");
    localStorage.setItem("memvid-theme", d ? "dark" : "light");
  }, dark);
  if (blockFonts) await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route(/localhost:8080\//, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: DOCS }));
    if (p === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (p === "/summaries") return route.fulfill(json({ summaries: [] }));
    return route.fulfill(json({}));
  });
  await page.goto(url);
  await expect(page.locator("[data-chat-start] .chat-start__row").first()).toBeVisible();
}

const start = (page) => page.locator("[data-chat-start]");
const rows = (page) => start(page).locator(".chat-start__row");

for (const [width, height] of [[320, 720], [390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
  for (const dark of [false, true]) {
    const tag = `${width}-${dark ? "dark" : "light"}`;
    test(`start screen at ${tag}: documents, then first questions`, async ({ page }) => {
      await openChat(page, { width, height, dark });

      // Nothing selected: the first four documents, each a full-width target inside the viewport.
      await expect(rows(page)).toHaveCount(4);
      await expect(rows(page).first()).toHaveText("Kinh tế vi mô - Chương 2.pdf");
      for (const row of await rows(page).all()) {
        const b = await row.boundingBox();
        expect(b.height).toBeGreaterThanOrEqual(44);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      if (OUT) await page.screenshot({ path: path.join(OUT, `chat-start-${tag}.png`) });

      // Picking a document selects it (same selection the source panel shows) and swaps the list
      // for first questions about that document.
      await rows(page).nth(1).click();
      await expect(start(page).getByText("Bắt đầu bằng một câu hỏi")).toBeVisible();
      await expect(rows(page)).toHaveCount(3);
      await expect(rows(page).nth(1)).toHaveText("Ý chính của Triết học Mác-Lênin - Đề cương là gì?");
      if (OUT) await page.screenshot({ path: path.join(OUT, `chat-start-selected-${tag}.png`) });

      // A question fills the composer and moves focus there; nothing is sent.
      await rows(page).nth(1).click();
      const composer = page.locator("textarea").first();
      await expect(composer).toHaveValue("Ý chính của Triết học Mác-Lênin - Đề cương là gì?");
      await expect(composer).toBeFocused();
      await expect(start(page)).toBeVisible();
    });
  }
}

test("picking in the centre checks the same document in the source panel", async ({ page }) => {
  await openChat(page, { width: 1440 });
  await rows(page).first().click();
  await expect(page.locator("aside").getByRole("checkbox", { name: "Chọn Kinh tế vi mô - Chương 2.pdf" })).toBeChecked();
  await expect(page.locator("aside").getByText("1 đang chọn")).toBeVisible();
});

test("keyboard: rows are reachable by Tab, Enter picks, and focus lands on the first question", async ({ page }) => {
  await openChat(page, { width: 1440 });
  // Tab from the conversation header until focus enters the start list (no direct .focus()).
  await page.getByRole("button", { name: "Đổi tên cuộc trò chuyện" }).focus().catch(() => {});
  let reached = false;
  for (let i = 0; i < 12 && !reached; i += 1) {
    await page.keyboard.press("Tab");
    reached = await rows(page).first().evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  await page.keyboard.press("Tab");
  await expect(rows(page).nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(start(page).getByText("Bắt đầu bằng một câu hỏi")).toBeVisible();
  // The picked row is gone; focus must not fall to <body>.
  await expect(rows(page).first()).toBeFocused();
  await expect(rows(page).first()).toHaveText("Tóm tắt Triết học Mác-Lênin - Đề cương.");
});

test("semantics: one h1, and both lists are named", async ({ page }) => {
  await openChat(page, { width: 1440 });
  await expect(start(page).getByRole("heading", { level: 1 })).toHaveText("Hỏi tài liệu của bạn, kèm dẫn chứng.");
  await expect(start(page).getByRole("list", { name: "Chọn tài liệu để hỏi" })).toBeVisible();
  await rows(page).first().click();
  await expect(start(page).getByRole("list", { name: "Bắt đầu bằng một câu hỏi" })).toBeVisible();
});

test("a deep link to a document that does not exist offers the pick list, not questions", async ({ page }) => {
  await openChat(page, { width: 1440, url: "/app?source=does-not-exist" });
  await expect(start(page).getByText("Bắt đầu bằng một câu hỏi")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).first()).toHaveText("Kinh tế vi mô - Chương 2.pdf");
});

test("320px with Google Fonts blocked: long names truncate inside the column", async ({ page }) => {
  await openChat(page, { width: 320, height: 720, blockFonts: true });
  for (const row of await rows(page).all()) {
    const b = await row.boundingBox();
    expect(b.x + b.width).toBeLessThanOrEqual(320);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
