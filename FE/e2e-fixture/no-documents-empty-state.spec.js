// W1-4 (item 2): when the account has NO documents at all, the centre empty
// state (Chat, and Mind Map/Summary once reached) shows one primary "Tải
// tài liệu lên" button that opens the real upload file picker -- reusing
// SidebarLeft's own hidden input, not a duplicate. Real app on the Vite dev
// server, API mocked at the network layer (pattern copied from
// FE/e2e-fixture/library-mode-navigation.spec.js).
import { test, expect } from "@playwright/test";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function openEmptyLibraryApp(page) {
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(/localhost:8080\//, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [] }));
    if (p === "/api/documents" || p === "/api/library") return route.fulfill(json({ documents: [], collections: [] }));
    if (p === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (p === "/summaries") return route.fulfill(json({ summaries: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app");
  await expect(page.getByText("Hỏi tài liệu của bạn")).toBeVisible();
}

test("Chat: shows the upload CTA and clicking it opens the real file picker", async ({ page }) => {
  await openEmptyLibraryApp(page);

  const upload = page.getByRole("button", { name: "Tải tài liệu lên" }).first();
  await expect(upload).toBeVisible();
  // No stale "chọn tài liệu bên trái/nguồn" copy from item 1's hint -- there
  // is nothing to select or open a drawer to yet.
  await expect(page.getByText("bên trái")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mở thư mục nguồn" }).first()).toBeHidden();

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    upload.click(),
  ]);
  expect(chooser).toBeTruthy();
});

test("Mind Map empty state (no documents): shows the upload CTA, not the disabled create button", async ({ page }) => {
  await openEmptyLibraryApp(page);
  await page.locator('nav[aria-label="Chế độ Workspace"] [role="tab"][title="Sơ đồ tư duy"]').click();

  const upload = page.getByRole("button", { name: "Tải tài liệu lên" }).first();
  await expect(upload).toBeVisible();
  await expect(page.getByRole("button", { name: "Tạo sơ đồ tư duy" })).toHaveCount(0);

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    upload.click(),
  ]);
  expect(chooser).toBeTruthy();
});
