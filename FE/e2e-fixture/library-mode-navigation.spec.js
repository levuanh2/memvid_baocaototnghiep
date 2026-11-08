// P0-3 (V4.1 audit D04): Library card actions must open the Workspace mode they
// name. Real app on the Vite dev server, API mocked at the network layer.
import { test, expect } from "@playwright/test";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const DOC = {
  document_id: "d1", source_stem: "tai-lieu-1", title: "Hệ điều hành.pdf", status: "completed",
  ingest_status: "index_ready", progress: 1, reading_minutes: 12, created_at: "2026-10-01T08:00:00Z",
  ai: { index: "ready", summary: { state: "ready" }, quiz: { ready: false }, review: {} },
};

async function openLibrary(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(/localhost:8080\//, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [{ video: "tai-lieu-1", video_stem: "tai-lieu-1", filename: DOC.title, status: "index_ready" }] }));
    if (p === "/api/documents" || p === "/api/library") return route.fulfill(json({ documents: [DOC], collections: [] }));
    if (p === "/api/documents/d1") return route.fulfill(json(DOC));
    if (p === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (p === "/summaries") return route.fulfill(json({ summaries: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app/study");
  await expect(page.getByRole("button", { name: /^Tóm tắt$/ }).first()).toBeVisible();
}

const activeMode = (page) => page.locator('nav[aria-label="Chế độ Workspace"] [role="tab"][aria-selected="true"]');

test("Library 'Tóm tắt' opens Summary mode with the document selected, and survives reload and Back", async ({ page }) => {
  await openLibrary(page);
  await page.getByRole("button", { name: /^Tóm tắt$/ }).first().click();
  await expect(page).toHaveURL(/\/app\?source=tai-lieu-1&tab=summary$/);
  await expect(activeMode(page)).toHaveAttribute("title", "Tóm tắt");
  await expect(page.getByText(/1 đang chọn/).first()).toBeVisible();

  await page.reload();
  await expect(activeMode(page)).toHaveAttribute("title", "Tóm tắt");

  await page.goBack();
  await expect(page).toHaveURL(/\/app\/study$/);
  await page.goForward();
  await expect(activeMode(page)).toHaveAttribute("title", "Tóm tắt");
});

test("Library 'Hỏi AI' stays in Chat", async ({ page }) => {
  await openLibrary(page);
  await page.getByRole("button", { name: /^Hỏi AI$/ }).first().click();
  await expect(page).toHaveURL(/\/app\?source=tai-lieu-1$/);
  await expect(activeMode(page)).toHaveAttribute("title", "Trò chuyện");
});

test("Library knowledge-map action keeps its own document route", async ({ page }) => {
  await openLibrary(page);
  await page.getByRole("button", { name: /^Bản đồ kiến thức$/ }).first().click();
  await expect(page).toHaveURL(/\/app\/study\/map\/d1$/);
});

test("Library document menu opens and closes from the keyboard", async ({ page }) => {
  await openLibrary(page);
  const trigger = page.locator('[aria-haspopup="menu"]').first();
  await trigger.focus();
  await page.keyboard.press("Enter");

  const menu = page.getByRole("menu");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitem").first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
});

// Review finding on #117: the same URL navigated from inside /app (Command
// Palette) keeps the Workspace mounted, so `tab` must also apply after mount.
test("Command Palette 'Tóm tắt' while already on /app switches to Summary mode", async ({ page }) => {
  await openLibrary(page);
  await page.goto("/app");
  await expect(activeMode(page)).toHaveAttribute("title", "Trò chuyện");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Tìm kiếm toàn cục" }).or(page.getByLabel("Tìm kiếm toàn cục")).first().fill("Hệ điều hành");
  await page.getByRole("button", { name: /^Tóm tắt$/ }).first().click();
  await expect(page).toHaveURL(/tab=summary/);
  await expect(activeMode(page)).toHaveAttribute("title", "Tóm tắt");
  // Clicking another mode still works and is reflected in the URL.
  await page.locator('nav[aria-label="Chế độ Workspace"] [role="tab"][title="Trò chuyện"]').click();
  await expect(activeMode(page)).toHaveAttribute("title", "Trò chuyện");
  await expect(page).not.toHaveURL(/tab=/);
});
