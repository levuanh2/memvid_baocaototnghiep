// W3-4 (owner decision O4): the right panel's own tab row (Bằng chứng / Gia
// sư AI / Dòng thời gian / Kiến thức) is back; the legacy artifact block
// stays off. Real app on the Vite dev server, API mocked at the network
// layer (pattern copied from FE/e2e-fixture/library-mode-navigation.spec.js).
//
// R2 (owner A5): re-captured AFTER screenshots here under before-main-*/
// after-*.png naming; the true "before" (origin/main, no tab row at all) was
// captured separately from a throwaway worktree at origin/main and copied in
// -- this file cannot produce that one itself (it IS the "after" branch).
// Each test below checks every item A5 asked to state in the PR body:
// visible tab discoverability, no clipped labels, correct header title per
// view, keyboard (arrows/Home/End/Tab), no inactive decorative tab (every
// tab is a real, clickable control), legacy artifact block still disabled.
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
    // user-resized width (320-480px) instead of the 360px default.
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
const TAB_TITLES = {
  "Bằng chứng": "Bằng chứng câu trả lời",
  "Gia sư AI": "Gia sư AI",
  "Dòng thời gian": "Dòng thời gian",
  "Kiến thức": "Kiến thức",
};

// Full checklist, run once per view (A5 wants each item checked and stated
// per view, not just once overall).
async function checkFullTabRowBehavior(page, { widthForClipCheck } = {}) {
  // 1. Visible tab discoverability: all four real labels, not icon-only.
  await expect(tablist(page)).toBeVisible();
  const tabs = tablist(page).getByRole("tab");
  await expect(tabs).toHaveCount(4);
  await expect(tabs).toHaveText(["Bằng chứng", "Gia sư AI", "Dòng thời gian", "Kiến thức"]);

  // 2. No clipped labels: neither the tab box nor its label text overflows
  // its own box (wraps instead, never truncates); and if a viewport width
  // was given, the box also stays within it (no horizontal clipping off
  // the edge of the screen either).
  for (let i = 0; i < 4; i += 1) {
    const tab = tabs.nth(i);
    const box = await tab.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(40);
    expect(box.height).toBeGreaterThanOrEqual(40);
    const tabOverflow = await tab.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(tabOverflow.scrollWidth).toBeLessThanOrEqual(tabOverflow.clientWidth + 1);
    const labelOverflow = await tab.locator("span").evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(labelOverflow.scrollWidth).toBeLessThanOrEqual(labelOverflow.clientWidth + 1);
    if (widthForClipCheck) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(widthForClipCheck);
    }
  }

  // 3. No inactive decorative tab: every one of the 4 is a REAL control --
  // clicking each one actually switches both the selected tab and the
  // header title to match (not a dead/no-op button).
  for (const [label, title] of Object.entries(TAB_TITLES)) {
    await tablist(page).getByRole("tab", { name: label }).click();
    await expect(panelTitle(page)).toHaveText(title); // 4. correct header title per view
    await expect(tablist(page).getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
    const others = Object.keys(TAB_TITLES).filter((l) => l !== label);
    for (const other of others) {
      await expect(tablist(page).getByRole("tab", { name: other })).toHaveAttribute("aria-selected", "false");
    }
  }

  // 5. Keyboard: Tab key reaches only the ONE selected tab (roving
  // tabindex -- the other three are tabIndex=-1, not part of the normal
  // tab order), then ArrowRight/ArrowLeft/Home/End move and activate.
  await tablist(page).getByRole("tab", { name: "Kiến thức" }).focus(); // currently selected from the loop above
  await expect(tablist(page).getByRole("tab", { name: "Kiến thức" })).toBeFocused();
  await page.keyboard.press("ArrowRight"); // wraps to the first tab
  await expect(panelTitle(page)).toHaveText("Bằng chứng câu trả lời");
  await page.keyboard.press("ArrowLeft"); // wraps back to the last
  await expect(panelTitle(page)).toHaveText("Kiến thức");
  await page.keyboard.press("Home");
  await expect(panelTitle(page)).toHaveText("Bằng chứng câu trả lời");
  await page.keyboard.press("End");
  await expect(panelTitle(page)).toHaveText("Kiến thức");

  // 6. Legacy artifact block still disabled, regardless of which tab/view.
  await expect(page.getByText("Tạo từ tài liệu")).toHaveCount(0);
}

test("1440px: full tab-row checklist + before/after screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChatWithSource(page);
  await expect(panelTitle(page)).toHaveText("Bằng chứng câu trả lời"); // initial view, before any interaction
  await page.screenshot({ path: `${EVIDENCE_DIR}/after-1440-before-interaction.png` });

  await checkFullTabRowBehavior(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/after-1440.png` });
});

test("390px (mobile drawer): full tab-row checklist + before/after screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChatWithSource(page);
  // Right panel is a closed bottom-sheet drawer below 768px -- open it the
  // same way a real user would, via the header's compact context row.
  await page.getByRole("button", { name: /Mở bằng chứng/ }).click();
  await expect(panelTitle(page)).toHaveText("Bằng chứng câu trả lời");
  await page.screenshot({ path: `${EVIDENCE_DIR}/after-390-before-interaction.png` });

  await checkFullTabRowBehavior(page, { widthForClipCheck: 390 });
  await page.screenshot({ path: `${EVIDENCE_DIR}/after-390.png` });
});

test("right panel resized to 320px: full tab-row checklist + before/after screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChatWithSource(page, { panelRightWidth: 320 });
  await expect(panelTitle(page)).toHaveText("Bằng chứng câu trả lời");
  await page.screenshot({ path: `${EVIDENCE_DIR}/after-panel-320-before-interaction.png` });

  await checkFullTabRowBehavior(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/after-panel-320.png` });
});
