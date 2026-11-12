// The Summary screen said "Chưa có tóm tắt" while /summaries was still loading and after it
// failed, for an account that has summaries. The mind map screen already told the three states
// apart; the summary one was never given the signals. Real app on the Vite dev server, API mocked
// at the network layer (setup copied from summary-mode-recovery.spec.js).
import { test, expect } from "@playwright/test";

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const SAVED = {
  id: "s1", title: "Tóm tắt: Hệ điều hành", sources: ["tai-lieu-1"], created_at: "2026-11-01T00:00:00Z",
  content: "## Tổng quan\nHệ điều hành quản lý tiến trình.", summary: "Hệ điều hành quản lý tiến trình.",
};

async function openWorkspace(page, summariesHandler) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(/localhost:8080\//, async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [{ video: "tai-lieu-1", video_stem: "tai-lieu-1", filename: "Hệ điều hành.pdf", status: "index_ready" }] }));
    if (p === "/summaries") return summariesHandler(route);
    if (p === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app?source=tai-lieu-1&tab=summary");
  await expect(page.locator('[role="tab"][title="Tóm tắt"][aria-selected="true"]')).toBeVisible();
}

const summaryPane = (page) => page.locator("main");

test("while the list is loading the screen says so and does not claim there are no summaries", async ({ page }) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  await openWorkspace(page, async (route) => { await gate; return route.fulfill(json({ summaries: [SAVED] })); });

  await expect(summaryPane(page).getByText("Đang tải…")).toBeVisible();
  await expect(summaryPane(page).getByText("Chưa có tóm tắt", { exact: true })).toHaveCount(0);
  await expect(summaryPane(page).getByRole("button", { name: "Tạo tóm tắt" })).toHaveCount(0);

  release();
  await expect(summaryPane(page).getByRole("combobox", { name: "Chọn tóm tắt" })).toBeVisible();
  await expect(summaryPane(page).getByText("Đang tải…")).toHaveCount(0);
});

test("a failed load says so, and 'Tải lại danh sách' recovers the saved summaries", async ({ page }) => {
  let fail = true;
  await openWorkspace(page, (route) => route.fulfill(fail ? json({ error: "boom" }, 500) : json({ summaries: [SAVED] })));

  await expect(summaryPane(page).getByText("Chưa tải được danh sách tóm tắt.")).toBeVisible();
  await expect(summaryPane(page).getByText("Chưa có tóm tắt", { exact: true })).toHaveCount(0);

  fail = false;
  await summaryPane(page).getByRole("button", { name: "Tải lại danh sách" }).click();
  await expect(summaryPane(page).getByRole("combobox", { name: "Chọn tóm tắt" })).toBeVisible();
  await expect(summaryPane(page).getByText("Chưa tải được danh sách tóm tắt.")).toHaveCount(0);
});

test("an account with no summaries still gets the create screen", async ({ page }) => {
  await openWorkspace(page, (route) => route.fulfill(json({ summaries: [] })));
  await expect(summaryPane(page).getByText("Chưa có tóm tắt", { exact: true })).toBeVisible();
  await expect(summaryPane(page).getByRole("button", { name: "Tạo tóm tắt" })).toBeEnabled();
});
