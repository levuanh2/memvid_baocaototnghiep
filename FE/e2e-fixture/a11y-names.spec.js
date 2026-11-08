// V4.1 W5-4: programmatic names for the Workspace source checkboxes and the
// chat box, and the closed usage chip never sits above a modal.
import { test, expect } from "@playwright/test";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const src = (stem, filename) => ({ video: stem, video_stem: stem, filename, status: "index_ready" });

async function openWorkspace(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(/localhost:8080\//, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [src("a", "Hệ điều hành.pdf"), src("b", "Mạng máy tính.pdf")] }));
    if (p === "/usage/me") return route.fulfill(json({ limit: 100, used: 10, remaining: 90, percentage: 10 }));
    if (p === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (p === "/summaries") return route.fulfill(json({ summaries: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app");
  await expect(page.locator('nav[aria-label="Chế độ Workspace"]')).toBeVisible();
}

test("source checkboxes and the chat box have names", async ({ page }) => {
  await openWorkspace(page, 1280);
  await expect(page.getByRole("checkbox", { name: "Chọn tất cả tài liệu sẵn sàng" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Chọn Hệ điều hành.pdf" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Chọn Mạng máy tính.pdf" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Câu hỏi cho tài liệu đã chọn" })).toBeVisible();
});

test("closed usage chip stays below modals; open chip is lifted", async ({ page }) => {
  await openWorkspace(page, 390);
  const chip = page.locator(".usage-chip__trigger").first();
  await expect(chip).toBeVisible();
  const wrapperZ = () => chip.evaluate((el) => getComputedStyle(el.parentElement).zIndex);
  // Modal overlay is z-50; the closed chip must not create a higher layer.
  expect(await wrapperZ()).toBe("auto");
  await chip.click();
  expect(await wrapperZ()).toBe("60");
});
