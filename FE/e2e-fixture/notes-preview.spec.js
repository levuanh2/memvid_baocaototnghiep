// V9.3 P5b — Notes Preview on the real app (Vite dev server, API mocked, fake users and
// documents only). Browser-only notes per user and document; nothing is sent to the server.
// Screenshots only when P5B_SHOT_OUT is set.
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chooseMode } from "./workspaceMode.js";

const OUT = process.env.P5B_SHOT_OUT;
const TAG = process.env.P5B_SHOT_TAG || "after";
if (OUT) mkdirSync(OUT, { recursive: true });

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const SOURCE = { video: "tai-lieu-1", video_stem: "tai-lieu-1", filename: "Tài liệu 1.pdf", status: "index_ready" };
const DOCS = [
  { document_id: "doc-1", source_stem: "tai-lieu-1", title: "Tài liệu 1.pdf", status: "ready" },
  { document_id: "doc-2", source_stem: "tai-lieu-2", title: "Tài liệu 2.pdf", status: "ready" },
];

async function openWorkspace(page, { width = 1440, dark = false, userId = "u1", blockNotes = false } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ isDark, block }) => {
    localStorage.setItem("memvid-token", "fixture-token");
    localStorage.setItem("memvid-theme", isDark ? "dark" : "light");
    if (block) {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).startsWith("studymap.notes.") && !window.__unblockNotes) throw new DOMException("blocked", "SecurityError");
        return real.call(this, k, v);
      };
    }
  }, { isDark: dark, block: blockNotes });
  const sent = [];
  await page.route(/localhost:8080\//, (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (req.method() !== "GET") sent.push(`${req.method()} ${p}`);
    if (p === "/auth/me") return route.fulfill(json({ user: { id: userId, email: `${userId}@example.test`, display_name: userId, provider: "local" } }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [SOURCE] }));
    if (p === "/api/documents") return route.fulfill(json({ documents: DOCS }));
    if (p === "/api/library") return route.fulfill(json({ documents: [], collections: [] }));
    if (p === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (p === "/summaries") return route.fulfill(json({ summaries: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app?source=tai-lieu-1");
  await expect(page.locator("main#main-content")).toBeVisible();
  return sent;
}

const note = (page) => page.getByRole("textbox", { name: /Ghi chú cho/ });
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: path.join(OUT, `${name}-${TAG}.png`) }); };
const headerOverflow = (page) => page.evaluate(() => { const h = document.querySelector("header"); return h.scrollWidth - h.clientWidth; });

for (const width of [390, 768, 1440]) {
  for (const dark of [false, true]) {
    test(`${width}px ${dark ? "dark" : "light"}: a note saves in this browser and comes back after reload`, async ({ page }) => {
      const sent = await openWorkspace(page, { width, dark });
      await chooseMode(page, "Ghi chú");
      await expect(page.getByText("Bản xem trước · chỉ lưu trên trình duyệt này")).toBeVisible();
      await expect(note(page)).toBeVisible();
      await expect(note(page)).toHaveAccessibleName("Ghi chú cho Tài liệu 1.pdf");
      expect(await headerOverflow(page)).toBeLessThanOrEqual(0);
      // The first version left the select and textarea on the browser's white default in dark
      // mode, with light token text on it (unreadable). Both must use the theme's card surface.
      const surfaces = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--bg-card)";
        document.body.appendChild(probe);
        const card = getComputedStyle(probe).color;
        probe.remove();
        const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
        return { card, text: bg(".notes-pane__text"), select: bg(".notes-pane__select") };
      });
      expect(surfaces.text).toBe(surfaces.card);
      expect(surfaces.select).toBe(surfaces.card);
      await note(page).fill("Cầu co giãn khi có nhiều hàng thay thế.");
      await expect(page.getByText(/Đã lưu trên trình duyệt này lúc \d{2}:\d{2}/)).toBeVisible();
      await shot(page, `notes-${width}-${dark ? "dark" : "light"}`);
      await page.reload();
      await chooseMode(page, "Ghi chú");
      await expect(note(page)).toHaveValue("Cầu co giãn khi có nhiều hàng thay thế.");
      expect(sent.filter((s) => !s.startsWith("POST /auth")), "notes never reach the server").toEqual([]);
    });
  }
}

test("another account on the same browser does not see the note", async ({ page, context }) => {
  await openWorkspace(page, { userId: "u1" });
  await chooseMode(page, "Ghi chú");
  await note(page).fill("của u1");
  await expect(page.getByText(/Đã lưu trên trình duyệt này/)).toBeVisible();
  const other = await context.newPage();
  await openWorkspace(other, { userId: "u2" });
  await chooseMode(other, "Ghi chú");
  await expect(note(other)).toHaveValue("");
});

test("each document has its own note, and switching saves the previous one", async ({ page }) => {
  await openWorkspace(page);
  await chooseMode(page, "Ghi chú");
  await note(page).fill("ghi chú tài liệu 1");
  await page.getByLabel("Tài liệu", { exact: true }).selectOption("doc-2");
  await expect(note(page)).toHaveValue("");
  await page.getByLabel("Tài liệu", { exact: true }).selectOption("doc-1");
  await expect(note(page)).toHaveValue("ghi chú tài liệu 1");
});

test("blocked browser storage: the learner is told, the text stays, retry saves", async ({ page }) => {
  await openWorkspace(page, { blockNotes: true });
  await chooseMode(page, "Ghi chú");
  await note(page).fill("không lưu được");
  await expect(page.getByRole("alert")).toContainText("Chưa lưu được");
  await expect(note(page)).toHaveValue("không lưu được");
  await shot(page, "notes-blocked-1440");
  await page.evaluate(() => { window.__unblockNotes = true; });
  await page.getByRole("button", { name: "Thử lưu lại" }).click();
  await expect(page.getByText(/Đã lưu trên trình duyệt này/)).toBeVisible();
});

test("Focus Mode and mode switches keep the typed note", async ({ page }) => {
  await openWorkspace(page);
  await chooseMode(page, "Ghi chú");
  await note(page).fill("đang viết dở");
  await page.locator("button[data-focus-toggle]").click();
  await expect(note(page)).toHaveValue("đang viết dở");
  await page.keyboard.press("Escape");
  await chooseMode(page, "Trò chuyện");
  await chooseMode(page, "Ghi chú");
  await expect(note(page)).toHaveValue("đang viết dở");
});

test("the note stops at its limit and says so", async ({ page }) => {
  await openWorkspace(page, { width: 1024 });
  await chooseMode(page, "Ghi chú");
  await note(page).fill("x".repeat(20000));
  await expect(page.getByText(/Đã đến giới hạn của một ghi chú/)).toBeVisible();
  await expect(note(page)).toHaveAttribute("maxlength", "20000");
});

test("delete asks first, then removes only this note", async ({ page }) => {
  await openWorkspace(page);
  await chooseMode(page, "Ghi chú");
  await note(page).fill("sẽ xoá");
  await expect(page.getByText(/Đã lưu trên trình duyệt này/)).toBeVisible();
  await page.getByRole("button", { name: "Xoá ghi chú trên trình duyệt này" }).click();
  await expect(page.getByRole("group", { name: "Xác nhận xoá ghi chú" })).toBeVisible();
  await page.getByRole("button", { name: "Huỷ" }).click();
  await expect(note(page)).toHaveValue("sẽ xoá");
  await page.getByRole("button", { name: "Xoá ghi chú trên trình duyệt này" }).click();
  await page.getByRole("button", { name: "Xoá", exact: true }).click();
  await expect(note(page)).toHaveValue("");
  expect(await page.evaluate(() => localStorage.getItem("studymap.notes.v1:u1:doc-1"))).toBeNull();
});

test("logout keeps the saved note for the next login of the same account", async ({ page }) => {
  await openWorkspace(page);
  await chooseMode(page, "Ghi chú");
  await note(page).fill("giữ qua đăng xuất");
  await expect(page.getByText(/Đã lưu trên trình duyệt này/)).toBeVisible();
  await page.locator('header button[aria-haspopup="menu"][aria-label^="Tài khoản"]').click();
  await page.getByRole("menuitem", { name: /Đăng xuất/ }).click();
  await expect(page).not.toHaveURL(/\/app/);
  expect(await page.evaluate(() => localStorage.getItem("studymap.notes.v1:u1:doc-1"))).toContain("giữ qua đăng xuất");
  await page.evaluate(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.goto("/app?source=tai-lieu-1");
  await chooseMode(page, "Ghi chú");
  await expect(note(page)).toHaveValue("giữ qua đăng xuất");
});
