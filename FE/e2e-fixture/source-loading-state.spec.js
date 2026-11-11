// V6 (audit finding W1): "the library is empty" must not be shown before the app knows it.
// Seen on the live site: an account with 4 documents got "0 tài liệu", "Chưa có tài liệu nào"
// and the first-upload call to action until `/list-indexed` answered, and for as long as the
// source panel stayed collapsed (the collapsed panel does not mount the component that fetches).
// Real app on the Vite dev server, API mocked at the network layer.
import { test, expect } from "@playwright/test";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const DOC = { video: "kinh_te_vi_mo.pdf", video_stem: "kinh_te_vi_mo", filename: "kinh_te_vi_mo.pdf", num_chunks: 12, status: "ready" };

async function openApp(page, { listDelayMs = 0, sources = [DOC], listStatus = 200, collapsedLeft = false, width = 1440 } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((collapsed) => {
    localStorage.setItem("memvid-token", "fixture-token");
    if (collapsed) {
      localStorage.setItem("memvidx.panels.v1", JSON.stringify({ width: { left: 252, right: 320 }, collapsed: { left: true, right: true } }));
    }
  }, collapsedLeft);
  let listCalls = 0;
  await page.route(/localhost:8080\//, async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/list-indexed") {
      listCalls += 1;
      if (listDelayMs) await new Promise((resolve) => setTimeout(resolve, listDelayMs));
      if (listStatus !== 200) return route.fulfill({ status: listStatus, contentType: "application/json", body: JSON.stringify({ error: "boom" }) });
      return route.fulfill(json({ sources }));
    }
    if (p === "/api/documents" || p === "/api/library") return route.fulfill(json({ documents: [], collections: [] }));
    if (p === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (p === "/summaries") return route.fulfill(json({ summaries: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app");
  await expect(page.getByText("Hỏi tài liệu của bạn")).toBeVisible();
  return { listCalls: () => listCalls };
}

// The chat's first-upload call to action (the panel has its own upload button).
const chatUploadCta = (page) => page.locator("[data-upload-cta]").filter({ has: page.locator("xpath=preceding-sibling::p[contains(., 'Tải tài liệu đầu tiên lên')]") });

test("while the list is loading, neither the panel nor the chat claims the library is empty", async ({ page }) => {
  await openApp(page, { listDelayMs: 2500 });

  // During the wait: a loading state, no "empty" copy, no first-upload call to action in the chat.
  // Both the panel and the chat say so.
  await expect(page.getByText("Đang tải danh sách tài liệu")).toHaveCount(2);
  await expect(page.getByText("Chưa có tài liệu nào.")).toHaveCount(0);
  await expect(page.getByText("0 tài liệu")).toHaveCount(0);
  await expect(chatUploadCta(page)).toHaveCount(0);
  await expect(page.getByText("Tải tài liệu đầu tiên lên")).toHaveCount(0);

  // After the answer: the document is listed and the chat asks to choose a document.
  await expect(page.getByText("kinh_te_vi_mo").first()).toBeVisible();
  await expect(page.getByText("Đang tải danh sách tài liệu")).toHaveCount(0);
  await expect(chatUploadCta(page)).toHaveCount(0);
});

test("an empty library still gets its upload call to action once the list has answered", async ({ page }) => {
  await openApp(page, { listDelayMs: 600, sources: [] });
  await expect(chatUploadCta(page)).toBeVisible();
  await expect(page.getByText("Chưa có tài liệu nào.")).toBeVisible();
});

test("with the source panel collapsed, the app still learns that the library has documents", async ({ page }) => {
  const app = await openApp(page, { collapsedLeft: true });
  const spine = page.locator(".panel-spine--left");
  await expect(spine).toBeVisible();
  await expect(spine.locator(".panel-spine__count")).toHaveText("1");
  await expect(chatUploadCta(page)).toHaveCount(0);
  await expect(page.getByText("Tải tài liệu đầu tiên lên")).toHaveCount(0);
  // (React StrictMode runs the effect twice on the dev server; production asks once.)
  expect(app.listCalls()).toBeGreaterThanOrEqual(1);

  // Expanding mounts the panel, which keeps the row and fetches for itself.
  await spine.click();
  await expect(page.getByText("kinh_te_vi_mo").first()).toBeVisible();
});

test("a failed list load shows the error, not an empty library", async ({ page }) => {
  await openApp(page, { listStatus: 500 });
  await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible();
  await expect(page.getByText("Chưa có tài liệu nào.")).toHaveCount(0);
  await expect(page.getByText("Tải tài liệu đầu tiên lên")).toHaveCount(0);
});

// Phone (drawer) and tablet (rail): the panel is mounted but not showing its list, so only the
// chat can be checked. It must wait for the list on every layout.
for (const width of [390, 900]) {
  test(`at ${width}px the chat waits for the list instead of offering a first upload`, async ({ page }) => {
    await openApp(page, { listDelayMs: 2000, width });
    await expect(page.getByText("Tải tài liệu đầu tiên lên")).toHaveCount(0);
    await expect(page.getByRole("main").getByText("Đang tải danh sách tài liệu").first()).toBeVisible();
    await expect(page.getByRole("main").getByText("Đang tải danh sách tài liệu")).toHaveCount(0, { timeout: 8000 });
    await expect(page.getByText("Tải tài liệu đầu tiên lên")).toHaveCount(0);
  });
}

test("collapsing the panel while the list is loading still ends with the real list", async ({ page }) => {
  await openApp(page, { listDelayMs: 2000 });
  await page.getByRole("button", { name: "Thu gọn cột" }).first().click();
  const spine = page.locator(".panel-spine--left");
  await expect(spine).toBeVisible();
  // The panel's own request was abandoned with the unmount; the layout asks again.
  await expect(spine.locator(".panel-spine__count")).toHaveText("1", { timeout: 8000 });
  await expect(page.getByText("Tải tài liệu đầu tiên lên")).toHaveCount(0);
});

test("a failed load can be retried from the panel, and the chat follows", async ({ page }) => {
  let fail = true;
  await openApp(page, { listStatus: 200 });
  await page.unroute(/localhost:8080\//);
  await page.route(/localhost:8080\//, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/list-indexed") return fail ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : route.fulfill(json({ sources: [DOC] }));
    return route.fulfill(json({}));
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible();
  await expect(page.getByText("Chưa tải được danh sách tài liệu")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Thử lại" }).click();
  await expect(page.getByText("kinh_te_vi_mo").first()).toBeVisible();
  await expect(page.getByText("Chưa tải được danh sách tài liệu")).toHaveCount(0);
});
