// V4.1 W3-1: Command Palette actions do what their label says, also when the
// Workspace is already open. Real app on the Vite dev server, API mocked.
import { test, expect } from "@playwright/test";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const DOC = {
  document_id: "d1", source_stem: "tai-lieu-1", title: "Hệ điều hành.pdf", status: "completed",
  ingest_status: "index_ready", progress: 1, reading_minutes: 12, created_at: "2026-10-01T08:00:00Z",
  ai: { index: "ready", summary: { state: "ready" }, quiz: { ready: false }, review: {} },
};

async function openWorkspace(page) {
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
  await page.goto("/app");
  await expect(page.locator('nav[aria-label="Chế độ Workspace"]')).toBeVisible();
}

const palette = (page) => page.getByRole("combobox", { name: "Tìm kiếm toàn cục" }).or(page.getByLabel("Tìm kiếm toàn cục")).first();

test("'Mở Gia sư AI' opens the tutor view, not just the Workspace (D14)", async ({ page }) => {
  await openWorkspace(page);
  const tutor = page.getByText("Gia sư AI cần một tài liệu đang xem", { exact: false });
  await expect(tutor).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await palette(page).fill("Gia sư");
  await page.getByRole("option", { name: /Mở Gia sư AI/ }).or(page.getByRole("button", { name: /Mở Gia sư AI/ })).first().click();
  await expect(tutor).toBeVisible();
});

test("a palette document action on /app selects that document", async ({ page }) => {
  await openWorkspace(page);
  await expect(page.getByText(/1 đang chọn/)).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await palette(page).fill("Hệ điều hành");
  await page.getByRole("button", { name: /^Tóm tắt$/ }).first().click();
  await expect(page).toHaveURL(/source=tai-lieu-1/);
  await expect(page.getByText(/1 đang chọn/).first()).toBeVisible();
});
