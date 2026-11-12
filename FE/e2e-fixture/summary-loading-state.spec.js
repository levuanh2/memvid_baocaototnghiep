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
// The mind-map pane (hidden in Summary mode) can show the same line while /mindmaps loads.
const loadingLine = (page) => page.locator("main p:visible", { hasText: "Đang tải…" });

test("while the list is loading the screen says so and does not claim there are no summaries", async ({ page }) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  await openWorkspace(page, async (route) => { await gate; return route.fulfill(json({ summaries: [SAVED] })); });

  await expect(loadingLine(page)).toBeVisible();
  await expect(summaryPane(page).getByText("Chưa có tóm tắt", { exact: true })).toHaveCount(0);
  await expect(summaryPane(page).getByRole("button", { name: "Tạo tóm tắt" })).toHaveCount(0);

  release();
  await expect(summaryPane(page).getByRole("combobox", { name: "Chọn tóm tắt" })).toBeVisible();
  await expect(loadingLine(page)).toHaveCount(0);
});

test("a failed load says so, and 'Tải lại danh sách' recovers the saved summaries", async ({ page }) => {
  let fail = true;
  await openWorkspace(page, (route) => route.fulfill(fail ? json({ error: "boom" }, 500) : json({ summaries: [SAVED] })));

  await expect(summaryPane(page).getByText("Chưa tải được danh sách tóm tắt.")).toBeVisible();
  await expect(summaryPane(page).getByText("Chưa có tóm tắt", { exact: true })).toHaveCount(0);

  fail = false;
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route(/localhost:8080\/summaries/, async (route) => { await gate; return route.fulfill(json({ summaries: [SAVED] })); });
  await summaryPane(page).getByRole("button", { name: "Tải lại danh sách" }).click();
  // While the reload runs: loading, no stale error, no second reload button to press.
  await expect(loadingLine(page)).toBeVisible();
  await expect(summaryPane(page).getByText("Chưa tải được danh sách tóm tắt.")).toHaveCount(0);
  await expect(summaryPane(page).getByRole("button", { name: "Tải lại danh sách" })).toHaveCount(0);
  release();
  await expect(summaryPane(page).getByRole("combobox", { name: "Chọn tóm tắt" })).toBeVisible();
  await expect(summaryPane(page).getByText("Chưa tải được danh sách tóm tắt.")).toHaveCount(0);
});

test("an account with no summaries still gets the create screen", async ({ page }) => {
  await openWorkspace(page, (route) => route.fulfill(json({ summaries: [] })));
  await expect(summaryPane(page).getByText("Chưa có tóm tắt", { exact: true })).toBeVisible();
  await expect(summaryPane(page).getByRole("button", { name: "Tạo tóm tắt" })).toBeEnabled();
});

// First frame: before the right panel (owner of both lists) has published anything, the centre
// screen must already be "loading", not "empty". A settled-DOM assertion cannot see a one-commit
// flash, so the page records every text it ever rendered.
async function recordEverSeen(page, phrases) {
  await page.addInitScript((list) => {
    window.__everSeen = [];
    const check = () => {
      const text = document.body ? document.body.innerText : "";
      for (const phrase of list) if (text.includes(phrase) && !window.__everSeen.includes(phrase)) window.__everSeen.push(phrase);
    };
    new MutationObserver(check).observe(document, { childList: true, subtree: true, characterData: true });
  }, phrases);
}

test("the Summary screen never shows 'Chưa có tóm tắt' while its list is still loading", async ({ page }) => {
  await recordEverSeen(page, ["Chưa có tóm tắt"]);
  let release;
  const gate = new Promise((r) => { release = r; });
  await openWorkspace(page, async (route) => { await gate; return route.fulfill(json({ summaries: [] })); });
  await expect(loadingLine(page)).toBeVisible();
  expect(await page.evaluate(() => window.__everSeen)).toEqual([]);
  release();
  await expect(summaryPane(page).getByText("Chưa có tóm tắt", { exact: true })).toBeVisible();
});

test("the Mind map screen never shows 'Chưa có sơ đồ tư duy' while its list is still loading", async ({ page }) => {
  await recordEverSeen(page, ["Chưa có sơ đồ tư duy"]);
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(/localhost:8080\//, async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [{ video: "tai-lieu-1", video_stem: "tai-lieu-1", filename: "Hệ điều hành.pdf", status: "index_ready" }] }));
    if (p === "/mindmaps") { await gate; return route.fulfill(json({ mindmaps: [] })); }
    return route.fulfill(json({ summaries: [] }));
  });
  await page.goto("/app?source=tai-lieu-1&tab=mindmap");
  await expect(page.locator('[role="tab"][title="Sơ đồ tư duy"][aria-selected="true"]')).toBeVisible();
  await expect(loadingLine(page)).toBeVisible();
  expect(await page.evaluate(() => window.__everSeen)).toEqual([]);
  release();
  // Really empty: now, and only now, the create screen.
  await expect(page.locator("main").getByText("Chưa có sơ đồ tư duy").first()).toBeVisible();
});
