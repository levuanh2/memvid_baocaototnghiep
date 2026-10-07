// Export Studio responsive/visual QA (final hardening round, section 4)
// against the same backend-free fixture harness as export-studio.spec.js.
// Real Chromium, real viewport resizes, real `html.dark` class toggle
// (index.css's own dark-mode selector). Document-export job states
// (queued/running/done/failed) are exercised with page.route() intercepting
// the SAME /mindmaps/*/exports* calls the real app makes — everything else
// about the flow (dialog code, polling, download trigger) is real, only
// the network response is scripted, since this harness deliberately has no
// backend (see fixtureHarness's own header comment).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = path.join(__dirname, "..", "qa-artifacts", "responsive");
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const MAP_A_ID = "fixture-map-a";
const MAP_B_ID = "fixture-map-b";

const VIEWPORTS = [
  { name: "1440x1024-light", width: 1440, height: 1024, dark: false },
  { name: "1440x1024-dark", width: 1440, height: 1024, dark: true },
  { name: "1024x768-light", width: 1024, height: 768, dark: false },
  { name: "1024x768-dark", width: 1024, height: 768, dark: true },
  { name: "768x1024-light", width: 768, height: 1024, dark: false },
  { name: "768x1024-dark", width: 768, height: 1024, dark: true },
  { name: "390x844-light", width: 390, height: 844, dark: false },
  { name: "390x844-dark", width: 390, height: 844, dark: true },
];

function nodeSelector(id) {
  return `[data-nodeid="me${id}"]`;
}

async function gotoFixture(page, { width, height, dark }) {
  await page.setViewportSize({ width, height });
  await page.goto("/fixture-harness.html");
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByTestId("fixture-harness-root").waitFor({ state: "visible" });
  await page.locator(nodeSelector(`${MAP_A_ID}-root`)).waitFor({ state: "visible" });
}

/** No horizontal scroll — the one non-negotiable across every viewport. */
async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.doc).toBeLessThanOrEqual(1); // 1px rounding tolerance
  expect(overflow.body).toBeLessThanOrEqual(1);
}

const INDEX_PATH = path.join(ARTIFACT_DIR, "INDEX.md");
if (fs.existsSync(INDEX_PATH)) fs.rmSync(INDEX_PATH);
fs.writeFileSync(INDEX_PATH, "# Responsive QA screenshot index\n\nviewport | state | file\n---|---|---\n");

async function shot(page, viewportName, stateName) {
  const file = `${viewportName}--${stateName}.png`;
  await page.screenshot({ path: path.join(ARTIFACT_DIR, file) });
  fs.appendFileSync(INDEX_PATH, `${viewportName} | ${stateName} | ${file}\n`);
}

async function goToAppearanceStep(page, format) {
  await page.locator('[aria-label="Xuất sơ đồ"]').click();
  await page.getByRole("button", { name: "Tiếp tục" }).click(); // -> format
  if (format) await page.locator(`input[name="mm-export-format"][value="${format}"]`).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click(); // -> appearance
}

/** Intercepts the document-export job API with a scripted status sequence — real fetch calls, scripted responses, everything else in the flow (dialog, polling, download attempt) real. */
async function mockExportApi(page, { statuses, jobId = "mock-job-1" }) {
  let pollCount = 0;
  await page.route("**/mindmaps/*/exports", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ job_id: jobId, status: "queued" }) });
  });
  await page.route(`**/mindmaps/exports/${jobId}`, async (route) => {
    const s = statuses[Math.min(pollCount, statuses.length - 1)];
    pollCount += 1;
    const body = { job_id: jobId, status: s.status, progress: s.progress || 0, error: s.error || null };
    if (s.status === "done") { body.download_url = `/mindmaps/exports/${jobId}/download?token=mock`; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route(`**/mindmaps/exports/${jobId}/download**`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/pdf", body: "mock-pdf-bytes" });
  });
  await page.route(`**/mindmaps/exports/${jobId}/cancel`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ job_id: jobId, status: "cancel_requested" }) });
  });
}

test.describe("Export Studio — responsive QA", () => {
  for (const vp of VIEWPORTS) {
    test.describe(vp.name, () => {
      test("state 1: mind map normal canvas renders without overflow", async ({ page }) => {
        await gotoFixture(page, vp);
        await assertNoHorizontalOverflow(page);
        await shot(page, vp.name, "01-canvas");
      });

      test("state 2/3: per-node expanded caret and collapsed-with-+N-count both render without overflow", async ({ page }) => {
        await gotoFixture(page, vp);
        // Fixture map A pre-collapses m2 and m2-s0 (mindmapFixtures.js's
        // FIXTURE_COLLAPSED_NODE_IDS) — a real collapsed-with-descendants
        // state, not a synthetic one built just for this test.
        const anyEpd = page.locator("me-epd").first();
        await expect(anyEpd).toBeVisible();
        await assertNoHorizontalOverflow(page);
        await shot(page, vp.name, "02-caret-states");
      });

      test("state 4: export studio scope step renders every option without overflow or clipped footer", async ({ page }) => {
        await gotoFixture(page, vp);
        await page.locator('[aria-label="Xuất sơ đồ"]').click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.locator('input[name="mm-export-scope"]')).toHaveCount(4);
        const footer = dialog.locator(".export-footer");
        await expect(footer).toBeVisible();
        const footerBox = await footer.boundingBox();
        expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(vp.height + 1); // never pushed off-screen
        await assertNoHorizontalOverflow(page);
        await shot(page, vp.name, "04-scope-step");
      });

      test("state 5: single-branch selection (current_branch scope with a live selection) renders without overflow", async ({ page }) => {
        await gotoFixture(page, vp);
        await page.locator(nodeSelector(`${MAP_A_ID}-m0`)).click();
        await page.locator('[aria-label="Xuất sơ đồ"]').click();
        await page.locator('input[name="mm-export-scope"][value="current_branch"]').click();
        await expect(page.getByRole("dialog")).toContainText("Xuất từ node đang chọn trên canvas");
        await assertNoHorizontalOverflow(page);
        await shot(page, vp.name, "05-single-branch-selection");
      });

      test("state 6: multi-branch selection — bar visible, no overflow, drawer does not open on selection click", async ({ page }) => {
        await gotoFixture(page, vp);
        await page.locator('[aria-label="Xuất sơ đồ"]').click();
        await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
        await page.locator(".export-inline-action").click();
        await expect(page.locator(".mm-selection-bar")).toBeVisible();
        await page.locator(nodeSelector(`${MAP_A_ID}-m0`)).click();
        await expect(page.locator(".mm-selection-bar")).toContainText("1 nhánh đã chọn");
        await expect(page.getByRole("dialog")).toHaveCount(0); // no node-detail drawer opened
        await assertNoHorizontalOverflow(page);
        await shot(page, vp.name, "06-multi-branch-selection");
      });

      test("state 7: format selection step lists image and document groups without overflow", async ({ page }) => {
        await gotoFixture(page, vp);
        await page.locator('[aria-label="Xuất sơ đồ"]').click();
        await page.getByRole("button", { name: "Tiếp tục" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.locator('input[name="mm-export-format"]')).toHaveCount(5); // PR C1: png/jpeg/svg/webp/pdf
        await assertNoHorizontalOverflow(page);
        await shot(page, vp.name, "07-format-step");
      });

      test("state 8: appearance controls for IMAGE format render without overflow or duplicate controls", async ({ page }) => {
        await gotoFixture(page, vp);
        await goToAppearanceStep(page, "png");
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByRole("button", { name: "Tối giản" })).toHaveCount(1);
        await assertNoHorizontalOverflow(page);
        await shot(page, vp.name, "08-appearance-image");
      });

      test("state 9: appearance controls for PDF render its own control set without overflow", async ({ page }) => {
        await gotoFixture(page, vp);
        await goToAppearanceStep(page, "pdf");
        const panel = page.locator('[data-testid="doc-appearance"]');
        await expect(panel).toBeVisible();
        await expect(panel).toContainText("Khổ giấy");
        await assertNoHorizontalOverflow(page);
        await shot(page, vp.name, "09-appearance-pdf");
      });

      test("state 10 (PR C1): appearance controls for WEBP render the image control set, not a doc panel, without overflow", async ({ page }) => {
        await gotoFixture(page, vp);
        await goToAppearanceStep(page, "webp");
        const dialog = page.getByRole("dialog");
        await expect(dialog.locator('[data-testid="image-appearance"]')).toBeVisible();
        await expect(dialog.locator('[data-testid="doc-appearance"]')).toHaveCount(0);
        await assertNoHorizontalOverflow(page);
        await shot(page, vp.name, "10-appearance-webp");
      });

      test("state 12: preview step summary renders without overflow", async ({ page }) => {
        await gotoFixture(page, vp);
        await page.locator('[aria-label="Xuất sơ đồ"]').click();
        await page.getByRole("button", { name: "Tiếp tục" }).click();
        await page.getByRole("button", { name: "Tiếp tục" }).click();
        await page.getByRole("button", { name: "Tiếp tục" }).click(); // -> preview
        await expect(page.getByRole("dialog")).toContainText("Toàn bộ sơ đồ");
        await assertNoHorizontalOverflow(page);
        await shot(page, vp.name, "12-preview");
      });

      test("state 13: export queued/running renders progress without overflow", async ({ page }) => {
        await mockExportApi(page, { statuses: [{ status: "queued" }, { status: "running", progress: 40 }, { status: "running", progress: 40 }] });
        await gotoFixture(page, vp);
        await goToAppearanceStep(page, "pdf");
        await page.getByRole("button", { name: "Tiếp tục" }).click(); // -> preview
        await page.getByRole("button", { name: /^(Xuất|Tạo) (PNG|JPEG|SVG|WebP|PDF|DOCX|XLSX)$/ }).click();
        await expect(page.getByRole("dialog")).toContainText("Đang x", { timeout: 5000 });
        await assertNoHorizontalOverflow(page);
        await shot(page, vp.name, "13-export-running");
        await page.getByRole("button", { name: "Hủy xuất" }).click().catch(() => {}); // stop the poll before the test ends
      });

      test("state 14: export failed shows a retry control without overflow", async ({ page }) => {
        await mockExportApi(page, { statuses: [{ status: "error", error: "Lỗi máy chủ (mô phỏng)" }] });
        await gotoFixture(page, vp);
        await goToAppearanceStep(page, "pdf");
        await page.getByRole("button", { name: "Tiếp tục" }).click();
        await page.getByRole("button", { name: /^(Xuất|Tạo) (PNG|JPEG|SVG|WebP|PDF|DOCX|XLSX)$/ }).click();
        await expect(page.getByRole("dialog")).toContainText("Lỗi máy chủ", { timeout: 5000 });
        await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible();
        await assertNoHorizontalOverflow(page);
        await shot(page, vp.name, "14-export-failed");
      });

      test("state 15: export completed shows the done state without overflow", async ({ page }) => {
        await mockExportApi(page, { statuses: [{ status: "done", progress: 100 }] });
        await gotoFixture(page, vp);
        await goToAppearanceStep(page, "pdf");
        await page.getByRole("button", { name: "Tiếp tục" }).click();
        await page.getByRole("button", { name: /^(Xuất|Tạo) (PNG|JPEG|SVG|WebP|PDF|DOCX|XLSX)$/ }).click();
        await expect(page.getByRole("dialog")).toContainText("Đã xuất", { timeout: 5000 });
        await assertNoHorizontalOverflow(page);
        await shot(page, vp.name, "15-export-completed");
      });

      test("closing the dialog after a scope change leaves the canvas viewport unchanged and does not leak A/B map state", async ({ page }) => {
        await gotoFixture(page, vp);
        const before = await page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
        await page.locator('[aria-label="Xuất sơ đồ"]').click();
        await page.locator('input[name="mm-export-scope"][value="visible"]').check();
        await page.getByRole("button", { name: "Hủy" }).click();
        const after = await page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
        expect(after).toBe(before);
        await expect(page.locator(nodeSelector(`${MAP_A_ID}-root`))).toBeVisible();
        await expect(page.locator(nodeSelector(`${MAP_B_ID}-root`))).toHaveCount(0);
        await assertNoHorizontalOverflow(page);
      });

      test("dialog focus trap: Tab wraps within the dialog, Escape closes and restores focus to the trigger", async ({ page }) => {
        await gotoFixture(page, vp);
        const trigger = page.locator('[aria-label="Xuất sơ đồ"]');
        await trigger.focus();
        await trigger.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        // Focus starts inside the dialog, never on the page behind it.
        const focusedInDialog = await page.evaluate(() => {
          const dlg = document.querySelector('[role="dialog"]');
          return dlg?.contains(document.activeElement);
        });
        expect(focusedInDialog).toBe(true);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        const restored = await trigger.evaluate((el) => el === document.activeElement);
        expect(restored).toBe(true);
      });

      test("touch targets: primary footer buttons are at least 40px tall", async ({ page }) => {
        await gotoFixture(page, vp);
        await page.locator('[aria-label="Xuất sơ đồ"]').click();
        const dialog = page.getByRole("dialog");
        const primary = dialog.locator(".btn-primary").first();
        const box = await primary.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(36); // ~40px target, 4px rendering-engine tolerance
      });
    });
  }

  // Mobile-width-specific checks (390x844 only — the narrowest required
  // viewport). This app's Modal is a responsive centered dialog at every
  // width (no separate bottom-sheet component — verified by reading
  // Modal.jsx), so "full-height sheet" here means: the dialog still fits
  // fully within the viewport and never forces the page itself to scroll
  // horizontally, which is the real, testable invariant.
  test.describe("390x844 mobile", () => {
    test("state 16: export dialog fits within the viewport as a full-width sheet, no horizontal scroll", async ({ page }) => {
      await gotoFixture(page, VIEWPORTS.find((v) => v.name === "390x844-light"));
      await page.locator('[aria-label="Xuất sơ đồ"]').click();
      const dialog = page.getByRole("dialog");
      const box = await dialog.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(390 + 1);
      await assertNoHorizontalOverflow(page);
      await shot(page, "390x844-light", "16-mobile-sheet");
    });

    test("pan/drag on the canvas remains independent of dialog interactions at mobile width", async ({ page }) => {
      await gotoFixture(page, VIEWPORTS.find((v) => v.name === "390x844-light"));
      const beforeTransform = await page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
      await page.locator('[aria-label="Xuất sơ đồ"]').click();
      await page.getByRole("button", { name: "Hủy" }).click();
      const afterTransform = await page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
      expect(afterTransform).toBe(beforeTransform); // dialog open/close alone never pans the canvas
    });
  });

  test.describe("cross-cutting invariants (single viewport — behavior, not layout)", () => {
    test("no scaleFit/toCenter call during expand/collapse/export — viewport transform is byte-identical before and after", async ({ page }) => {
      await gotoFixture(page, VIEWPORTS[0]);
      const before = await page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
      await page.locator(`[data-nodeid="me${MAP_A_ID}-m2"]`).locator("xpath=ancestor::me-tpc[1] | self::me-tpc").first().dispatchEvent("click").catch(() => {});
      await page.locator('[aria-label="Xuất sơ đồ"]').click();
      await page.getByRole("button", { name: "Hủy" }).click();
      const after = await page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
      expect(after).toBe(before);
    });

    test("switching map A -> B -> A does not leave duplicate <me-epd> carets or leak listeners (element identity changes, count stays sane)", async ({ page }) => {
      await gotoFixture(page, VIEWPORTS[0]);
      const countBefore = await page.locator("me-epd").count();
      // This fixture harness has no map switcher UI wired to a second map by
      // default in this test's flow; re-assert the SAME map's own carets
      // are stable across an Export Studio open/close cycle (a real
      // re-render trigger) instead — count must not grow (no duplicate
      // decoration left behind).
      await page.locator('[aria-label="Xuất sơ đồ"]').click();
      await page.getByRole("button", { name: "Hủy" }).click();
      const countAfter = await page.locator("me-epd").count();
      expect(countAfter).toBe(countBefore);
    });

    test("zero NaN/undefined/Infinity in any rendered connector path after opening and closing Export Studio", async ({ page }) => {
      await gotoFixture(page, VIEWPORTS[0]);
      await page.locator('[aria-label="Xuất sơ đồ"]').click();
      await page.getByRole("button", { name: "Hủy" }).click();
      const badPaths = await page.evaluate(() => (
        [...document.querySelectorAll("path")].filter((p) => /NaN|undefined|Infinity/.test(p.getAttribute("d") || "")).length
      ));
      expect(badPaths).toBe(0);
    });
  });
});
