// W3-4 (owner decision O4): the right panel's own tab row (Bằng chứng / Gia
// sư AI / Dòng thời gian / Kiến thức) is back; the legacy artifact block
// stays off. Real app on the Vite dev server, API mocked at the network
// layer (pattern copied from FE/e2e-fixture/library-mode-navigation.spec.js).
import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const DOC = {
  document_id: "d1", source_stem: "tai-lieu-1", title: "Hệ điều hành.pdf", status: "completed",
  ingest_status: "index_ready", progress: 1, reading_minutes: 12, created_at: "2026-10-01T08:00:00Z",
  ai: { index: "ready", summary: { state: "ready" }, quiz: { ready: false }, review: {} },
};

const EVIDENCE_DIR = "../docs/ui-ux-v4-1/evidence/w3-4";
test.beforeAll(async () => { await mkdir(new URL(EVIDENCE_DIR, import.meta.url), { recursive: true }); });

async function openChatWithSource(page, { panelRightWidth } = {}) {
  await page.addInitScript((rightWidth) => {
    localStorage.setItem("memvid-token", "fixture-token");
    // Seeds the exact shape panelLayout.js's readStored()/writeStored()
    // use (key "memvidx.panels.v1") so the right panel opens at a specific
    // user-resized width (320-480px) instead of the 360px default -- the
    // review fix's own fit constraint is this width, not the viewport.
    if (rightWidth) {
      localStorage.setItem("memvidx.panels.v1", JSON.stringify({
        width: { left: 252, right: rightWidth },
        collapsed: { left: false, right: false },
      }));
    }
  }, panelRightWidth);
  await page.route(/localhost:8080\//, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [{ video: "tai-lieu-1", video_stem: "tai-lieu-1", filename: DOC.title, status: "index_ready", can_query: true }] }));
    if (p === "/api/documents" || p === "/api/library") return route.fulfill(json({ documents: [DOC], collections: [] }));
    if (p === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (p === "/summaries") return route.fulfill(json({ summaries: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app?source=tai-lieu-1");
  await expect(page.getByText("Hỏi tài liệu của bạn")).toBeVisible();
}

const tablist = (page) => page.locator('[role="tablist"][aria-label="Chế độ cột phải"]');
const panelTitle = (page) => page.locator(".study-surface-header strong");

test("1440px: tab row visible by default, switching tabs updates content and the header title, legacy block absent", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChatWithSource(page);

  await expect(tablist(page)).toBeVisible();
  const tabs = tablist(page).getByRole("tab");
  await expect(tabs).toHaveCount(4);
  await expect(panelTitle(page)).toHaveText("Bằng chứng câu trả lời");
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: `${EVIDENCE_DIR}/1440-before-evidence.png` });

  await tablist(page).getByRole("tab", { name: "Gia sư AI" }).click();
  await expect(panelTitle(page)).toHaveText("Gia sư AI");
  await expect(tablist(page).getByRole("tab", { name: "Gia sư AI" })).toHaveAttribute("aria-selected", "true");
  await expect(tablist(page).getByRole("tab", { name: "Bằng chứng" })).toHaveAttribute("aria-selected", "false");
  await page.screenshot({ path: `${EVIDENCE_DIR}/1440-after-gia-su-ai.png` });

  // Arrow-key navigation: focus the active tab, ArrowRight moves to Timeline.
  await tablist(page).getByRole("tab", { name: "Gia sư AI" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(panelTitle(page)).toHaveText("Dòng thời gian");

  // Legacy artifact block never renders regardless of tab.
  await expect(page.getByText("Tạo từ tài liệu")).toHaveCount(0);
});

// Review fix: stacked icon+label tabs, grid of 4 equal-width cells, must
// fit without clipping or truncation at BOTH ends of the user-resizable
// right panel (320-480px), independent of the desktop viewport itself.
for (const panelRightWidth of [320, 480]) {
  test(`panel width ${panelRightWidth}px: every tab label fully visible (no clip/scroll), each tab >= 40x40`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openChatWithSource(page, { panelRightWidth });

    await expect(tablist(page)).toBeVisible();
    const tabs = tablist(page).getByRole("tab");
    await expect(tabs).toHaveCount(4);

    for (let i = 0; i < 4; i += 1) {
      const tab = tabs.nth(i);
      const box = await tab.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(40);
      expect(box.height).toBeGreaterThanOrEqual(40);
      // "Fully visible, not clipped": neither the tab button itself nor its
      // label text overflows its own box (the label WRAPS to a second line
      // instead -- "Dòng thời gian" is the one that can need it at 320px --
      // never a hard one-line truncation/clip).
      const tabOverflow = await tab.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(tabOverflow.scrollWidth).toBeLessThanOrEqual(tabOverflow.clientWidth + 1);
      const labelOverflow = await tab.locator("span").evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(labelOverflow.scrollWidth).toBeLessThanOrEqual(labelOverflow.clientWidth + 1);
    }
    await page.screenshot({ path: `${EVIDENCE_DIR}/panel-${panelRightWidth}px.png` });
  });
}

for (const width of [320, 390]) {
  test(`${width}px: tab row opens in the drawer, fits without clipping (stacked icon+label), switching tabs works`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openChatWithSource(page);

    // Right panel is a closed bottom-sheet drawer below 768px -- open it the
    // same way a real user would, via the header's compact context row.
    await page.getByRole("button", { name: /Mở bằng chứng/ }).click();
    await expect(tablist(page)).toBeVisible();
    const tabs = tablist(page).getByRole("tab");
    await expect(tabs).toHaveCount(4);

    // No clipping: every tab's bounding box stays within the viewport.
    for (let i = 0; i < 4; i += 1) {
      const box = await tabs.nth(i).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }

    if (width === 390) await page.screenshot({ path: `${EVIDENCE_DIR}/390-before-evidence.png` });
    await tablist(page).getByRole("tab", { name: "Kiến thức" }).click();
    await expect(panelTitle(page)).toHaveText("Kiến thức");
    if (width === 390) await page.screenshot({ path: `${EVIDENCE_DIR}/390-after-kien-thuc.png` });
  });
}
