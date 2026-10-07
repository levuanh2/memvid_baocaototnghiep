// PR A fail-before on origin/main: full-map independence (A), text clipping (B),
// centering (C) against REAL PNG artifacts from the export UI. Fake data only.
// Every check decodes the downloaded PNG in the browser; none relies on a mock.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = path.join(__dirname, "..", "qa-artifacts", "export-v3-render");
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const ROOT = '[data-nodeid="meexport-v3-root"]';
const M1_L0 = '[data-nodeid="meexport-v3-m1-l0"]';

async function openExport(page) {
  await page.goto("/fixture-harness.html?map=export-v3");
  await expect(page.getByTestId("fixture-harness-root")).toBeVisible();
  await expect(page.locator(ROOT)).toBeVisible();
  await page.waitForTimeout(300);
}

async function exportFullPng(page, label) {
  await page.locator('[aria-label="Xuất sơ đồ"]').first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  if (await page.locator('input[name="mm-export-scope"][value="full"]').count()) {
    await page.locator('input[name="mm-export-scope"][value="full"]').check();
    await page.getByRole("button", { name: "Tiếp tục" }).click();
    await page.locator('input[name="mm-export-format"][value="png"]').check();
    for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Tiếp tục" }).click();
  }
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /^(Xuất|Tạo) PNG$/ }).click();
  const download = await downloadPromise;
  const file = path.join(ARTIFACT_DIR, `${label}.png`);
  await download.saveAs(file);
  // Close with the dialog's own control so the next step sees the live canvas.
  await dialog.getByRole("button", { name: "Đóng" }).first().click();
  await expect(dialog).toBeHidden();
  return fs.readFileSync(file);
}

/** Decodes a PNG in the page and returns the image size and bounding box of pixels that differ from the dominant colour (the background). */
async function analysePng(page, buf) {
  const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    const counts = new Map();
    for (let i = 0; i < data.length; i += 4 * 7) {
      const key = `${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const [bgKey] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const [br, bg, bb, ba] = bgKey.split(",").map(Number);
    let x0 = width, y0 = height, x1 = -1, y1 = -1, content = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const diff = Math.max(Math.abs(data[i] - br), Math.abs(data[i + 1] - bg), Math.abs(data[i + 2] - bb), Math.abs(data[i + 3] - ba));
        if (diff > 40) {
          content++;
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
      }
    }
    return { width, height, content, bbox: content ? { x0, y0, x1, y1 } : null, background: bgKey };
  }, dataUrl);
}

test.describe("export-v3 fail-before (origin/main)", () => {
  test("A: full-map export is independent of pan, zoom and collapse", async ({ page }) => {
    // Two fresh loads: the second one changes the live canvas before exporting. A fresh load keeps
    // the dialog on its first step, so this does not depend on the reopen-after-export defect.
    await openExport(page);
    const before = await exportFullPng(page, "A-default");

    await openExport(page);
    await page.getByRole("button", { name: "Phóng to" }).click();
    await page.getByRole("button", { name: "Phóng to" }).click();
    const caret = page.locator(`${M1_L0} me-epd`).first();
    if (await caret.count()) await caret.click({ force: true });
    const mb = await page.locator(".map-container").first().boundingBox();
    await page.mouse.move(mb.x + mb.width * 0.5, mb.y + mb.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(mb.x + mb.width * 0.5 - 120, mb.y + mb.height * 0.2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const transformBefore = await page.evaluate(() => document.querySelector(".map-canvas").style.transform);
    const after = await exportFullPng(page, "A-after-pan-zoom-expand");
    const transformAfter = await page.evaluate(() => document.querySelector(".map-canvas").style.transform);
    expect(transformAfter).toBe(transformBefore);

    const a = await analysePng(page, before);
    const b = await analysePng(page, after);
    expect(b.content).toBeGreaterThan(0);
    expect(Math.abs((a.bbox.x1 - a.bbox.x0) - (b.bbox.x1 - b.bbox.x0))).toBeLessThanOrEqual(4);
    expect(Math.abs((a.bbox.y1 - a.bbox.y0) - (b.bbox.y1 - b.bbox.y0))).toBeLessThanOrEqual(4);
    expect(Math.abs(a.content - b.content) / a.content).toBeLessThanOrEqual(0.02);
  });

  test("B: long Vietnamese content is not clipped at the image edge", async ({ page }) => {
    await openExport(page);
    const buf = await exportFullPng(page, "B-default");
    const a = await analysePng(page, buf);
    expect(a.bbox).not.toBeNull();
    const margin = 6;
    expect(a.bbox.x0).toBeGreaterThanOrEqual(margin);
    expect(a.bbox.y0).toBeGreaterThanOrEqual(margin);
    expect(a.bbox.x1).toBeLessThanOrEqual(a.width - 1 - margin);
    expect(a.bbox.y1).toBeLessThanOrEqual(a.height - 1 - margin);
  });

  test("C: content is centred in the image within a declared tolerance", async ({ page }) => {
    await openExport(page);
    const buf = await exportFullPng(page, "C-default");
    const a = await analysePng(page, buf);
    const cx = (a.bbox.x0 + a.bbox.x1) / 2;
    const cy = (a.bbox.y0 + a.bbox.y1) / 2;
    const tolX = a.width * 0.02;
    const tolY = a.height * 0.02;
    // Record the measured offset so NOT REPRODUCED is visible in the report even when this passes.
    console.log(`CENTERING dx=${(cx - a.width / 2).toFixed(1)} dy=${(cy - a.height / 2).toFixed(1)} tolX=${tolX.toFixed(1)} tolY=${tolY.toFixed(1)}`);
    expect(Math.abs(cx - a.width / 2)).toBeLessThanOrEqual(tolX);
    expect(Math.abs(cy - a.height / 2)).toBeLessThanOrEqual(tolY);
  });
});
