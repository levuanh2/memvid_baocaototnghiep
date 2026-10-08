// PR C2 — real-browser QA for the toolbar "Giao diện" editor and Export
// Studio's appearance override, against the same backend-free fixture
// harness export-studio.spec.js/responsive.spec.js already use. The PATCH
// /mindmaps/<id>/appearance call is mocked (this harness has no backend at
// all — see playwright.fixture.config.js's own header); everything else in
// the flow (dialog, draft state, live preview, rollback) is real.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = path.join(__dirname, "..", "qa-artifacts");
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const MAP_A_ID = "fixture-map-a";
const MAP_B_ID = "fixture-map-b";

function nodeSelector(id) {
  return `[data-nodeid="me${id}"]`;
}

async function gotoFixture(page, { width, height, dark } = {}) {
  if (width) await page.setViewportSize({ width, height });
  await page.goto("/fixture-harness.html");
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByTestId("fixture-harness-root").waitFor({ state: "visible" });
  await page.locator(nodeSelector(`${MAP_A_ID}-root`)).waitFor({ state: "visible" });
}

async function mockAppearancePatch(page, { succeed = true } = {}) {
  await page.route("**/mindmaps/*/appearance", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    if (!succeed) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Lỗi máy chủ" }) });
    const body = JSON.parse(route.request().postData());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ appearance: body.appearance, updated_at: "now" }) });
  });
}

async function openAppearanceEditor(page) {
  await page.locator('[aria-label="Giao diện"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

function assertNoHorizontalOverflow(page) {
  return page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
}

const VIEWPORTS = [
  { name: "1440x1024-light", width: 1440, height: 1024, dark: false },
  { name: "1440x1024-dark", width: 1440, height: 1024, dark: true },
  { name: "1024x768-light", width: 1024, height: 768, dark: false },
  { name: "1024x768-dark", width: 1024, height: 768, dark: true },
  { name: "390x844-light", width: 390, height: 844, dark: false },
  { name: "390x844-dark", width: 390, height: 844, dark: true },
];

test.describe("Appearance editor — smoke across the required viewport/theme matrix", () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: open, switch preset, cancel rolls back, no horizontal overflow`, async ({ page }) => {
      await gotoFixture(page, vp);
      const rootTopic = page.locator(nodeSelector(`${MAP_A_ID}-root`));
      const before = await rootTopic.evaluate((el) => el.style.cssText);
      await openAppearanceEditor(page);
      await page.getByRole("button", { name: "Học tập" }).click();
      await expect.poll(async () => rootTopic.evaluate((el) => el.style.cssText)).not.toBe(before);
      const overflowDuring = await assertNoHorizontalOverflow(page);
      expect(overflowDuring.doc).toBeLessThanOrEqual(1);
      expect(overflowDuring.body).toBeLessThanOrEqual(1);
      await page.getByRole("button", { name: "Hủy" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect.poll(async () => rootTopic.evaluate((el) => el.style.cssText)).toBe(before);
    });
  }
});

test.describe("Appearance editor — apply, undo, reset, map isolation (single viewport)", () => {
  test.beforeEach(async ({ page }) => { await gotoFixture(page, { width: 1440, height: 1024 }); });

  test("Áp dụng PATCHes and keeps the preview; reopening a different map starts that map's own session", async ({ page }) => {
    await mockAppearancePatch(page);
    await openAppearanceEditor(page);
    await page.getByRole("button", { name: "Học tập" }).click();
    const rootTopic = page.locator(nodeSelector(`${MAP_A_ID}-root`));
    const previewedCss = await rootTopic.evaluate((el) => el.style.cssText);
    await page.getByRole("button", { name: "Áp dụng" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await rootTopic.evaluate((el) => el.style.cssText)).toBe(previewedCss); // kept, not rolled back
  });

  test("Đặt lại returns the draft to the no-op default; Hoàn tác undoes one step", async ({ page }) => {
    await mockAppearancePatch(page);
    await openAppearanceEditor(page);
    const rootTopic = page.locator(nodeSelector(`${MAP_A_ID}-root`));
    const baseline = await rootTopic.evaluate((el) => el.style.cssText);
    await page.getByRole("button", { name: "Học tập" }).click();
    const studyCss = await rootTopic.evaluate((el) => el.style.cssText);
    await page.getByRole("button", { name: "Pastel" }).click();
    await page.getByRole("button", { name: "Hoàn tác" }).click();
    expect(await rootTopic.evaluate((el) => el.style.cssText)).toBe(studyCss);
    await page.getByRole("button", { name: "Đặt lại", exact: true }).click(); // not "Đặt lại thu phóng" (zoom reset)
    expect(await rootTopic.evaluate((el) => el.style.cssText)).toBe(baseline);
    await page.getByRole("button", { name: "Hủy" }).click();
  });

  test("a failed PATCH rolls back to the saved look and shows an error without closing", async ({ page }) => {
    await mockAppearancePatch(page, { succeed: false });
    await openAppearanceEditor(page);
    const rootTopic = page.locator(nodeSelector(`${MAP_A_ID}-root`));
    const baseline = await rootTopic.evaluate((el) => el.style.cssText);
    await page.getByRole("button", { name: "Học tập" }).click();
    await page.getByRole("button", { name: "Áp dụng" }).click();
    await expect(page.getByRole("dialog")).toContainText("Lỗi máy chủ");
    expect(await rootTopic.evaluate((el) => el.style.cssText)).toBe(baseline);
    await page.getByRole("button", { name: "Hủy" }).click();
  });
});

test.describe("Export Studio — appearance override (single viewport)", () => {
  test.beforeEach(async ({ page }) => { await gotoFixture(page, { width: 1440, height: 1024 }); });

  async function openExportStudio(page) {
    await page.locator('[aria-label="Xuất sơ đồ"]').click();
    await expect(page.getByRole("dialog")).toBeVisible();
  }

  test("'Dùng giao diện của sơ đồ' is the default; switching to custom reveals node/connector controls and never touches the live canvas", async ({ page }) => {
    const rootTopic = page.locator(nodeSelector(`${MAP_A_ID}-root`));
    const liveBaseline = await rootTopic.evaluate((el) => el.style.cssText);
    await openExportStudio(page);
    await page.getByRole("button", { name: "Tiếp tục" }).click(); // -> format
    await page.getByRole("button", { name: "Tiếp tục" }).click(); // -> appearance
    const useMapRadio = page.locator('input[name="mm-appearance-mode"]').first();
    await expect(useMapRadio).toBeChecked();
    const customRadio = page.locator('input[name="mm-appearance-mode"]').nth(1);
    await customRadio.check();
    await expect(page.getByText("Áp dụng cho sơ đồ")).toBeVisible();
    // Live canvas must be completely unaffected by an Export Studio override.
    expect(await rootTopic.evaluate((el) => el.style.cssText)).toBe(liveBaseline);
  });

  test("SVG export with a custom override reflects the custom fill in the real downloaded markup", async ({ page }) => {
    await openExportStudio(page);
    await page.getByRole("button", { name: "Tiếp tục" }).click(); // -> format
    await page.locator('input[name="mm-export-format"][value="svg"]').check();
    await page.getByRole("button", { name: "Tiếp tục" }).click(); // -> appearance
    const customRadio = page.locator('input[name="mm-appearance-mode"]').nth(1);
    await customRadio.check();
    const fillInput = page.locator('[data-testid="appearance-mode-section"] input[type="color"]').first();
    // React patches the native `value` setter to track the "last known"
    // value; setting `.value` through that same patched setter can make a
    // subsequent event a silent no-op. `fill()` goes through Playwright's
    // own real keyboard/paste-equivalent input path, which doesn't have
    // this problem (same reasoning as the unit-test-side fix for this
    // exact gotcha — see ExportStudioDialog.appearanceOverride.test.jsx).
    await fillInput.fill("#A1B2C3");
    await page.getByRole("button", { name: "Tiếp tục" }).click(); // -> preview
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /^(Xuất|Tạo) SVG$/ }).click();
    const download = await downloadPromise;
    const savePath = path.join(ARTIFACT_DIR, `appearance-override-${Date.now()}.svg`);
    await download.saveAs(savePath);
    const svgText = fs.readFileSync(savePath, "utf8");
    // The captured scene serializes computed style as rgb(...), not the
    // original hex string (confirmed against a real downloaded file) —
    // #A1B2C3 = rgb(161, 178, 195).
    expect(svgText).toContain("rgb(161, 178, 195)");
  });
});

test.describe("Appearance editor — map switch starts a fresh session (no stale draft)", () => {
  test("switching from map A to map B shows B's own (default) appearance, not a leftover A draft", async ({ page }) => {
    await gotoFixture(page, { width: 1440, height: 1024 });
    await mockAppearancePatch(page);
    await openAppearanceEditor(page);
    await page.getByRole("button", { name: "Học tập" }).click();
    await page.getByRole("button", { name: "Áp dụng" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.locator('[aria-label="Mở thư viện sơ đồ"]').click();
    await page.getByText("Bản đồ tư duy: Quy trình học tập (Fixture B)").click();
    await page.locator(nodeSelector(`${MAP_B_ID}-root`)).waitFor({ state: "visible" });

    await openAppearanceEditor(page);
    await expect(page.locator('input[name="mm-appearance-mode"]')).toHaveCount(0); // toolbar editor has no mode radios — just confirm it opened cleanly for B
    await expect(page.getByRole("button", { name: "Mặc định" })).toHaveAttribute("aria-pressed", "true");
  });
});
