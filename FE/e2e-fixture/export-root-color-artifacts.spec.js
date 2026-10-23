import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "qa-artifacts", "export-root-color-fidelity");

async function openSavedAppearance(page) {
  await page.goto("/fixture-harness.html?map=post-pr77");
  await expect.poll(() => page.evaluate(() => Boolean(window.__STUDYMAP_FIXTURE__?.mind))).toBe(true);
}

async function sourceRootColor(page) {
  return page.locator('[data-nodeid="meROOT"]').evaluate((element) => getComputedStyle(element).backgroundColor);
}

async function toFormat(page, format) {
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator(`input[name="mm-export-format"][value="${format}"]`).check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
}

async function downloadImage(page, format) {
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: `Xuất ${format.toUpperCase()}` }).click();
  const download = await pending;
  const extension = format === "jpeg" ? "jpg" : format;
  const output = path.join(OUT, `source-root.${extension}`);
  await download.saveAs(output);
  return output;
}

async function rasterColorMetrics(page, bytes, mime, target, region = null) {
  return page.evaluate(async ({ base64, mimeType, targetRgb, region }) => {
    const image = new Image();
    image.src = `data:${mimeType};base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const x0 = region ? Math.max(0, Math.floor(region.x * canvas.width / region.sceneWidth)) : 0;
    const y0 = region ? Math.max(0, Math.floor(region.y * canvas.height / region.sceneHeight)) : 0;
    const x1 = region ? Math.min(canvas.width, Math.ceil((region.x + region.width) * canvas.width / region.sceneWidth)) : canvas.width;
    const y1 = region ? Math.min(canvas.height, Math.ceil((region.y + region.height) * canvas.height / region.sceneHeight)) : canvas.height;
    let closePixels = 0;
    let nonWhitePixels = 0;
    let nearest = Number.POSITIVE_INFINITY;
    let sampledPixels = 0;
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
      const index = (y * canvas.width + x) * 4;
      const r = pixels[index]; const g = pixels[index + 1]; const b = pixels[index + 2]; const a = pixels[index + 3];
      if (!a) continue;
      sampledPixels += 1;
      if (r < 245 || g < 245 || b < 245) nonWhitePixels += 1;
      const distance = Math.hypot(r - targetRgb[0], g - targetRgb[1], b - targetRgb[2]);
      nearest = Math.min(nearest, distance);
      if (distance <= 24) closePixels += 1;
    }
    return {
      width: canvas.width,
      height: canvas.height,
      closePixels,
      sampledPixels,
      nonWhitePixels,
      closeRatioOfInk: closePixels / Math.max(1, nonWhitePixels),
      nearest,
    };
  }, { base64: bytes.toString("base64"), mimeType: mime, targetRgb: target, region });
}

async function rootRegionFromSvg(page, svg) {
  await page.setContent(svg);
  return page.evaluate(() => {
    const scene = document.querySelector("body > svg");
    const node = document.querySelector('[data-nodeid="meROOT"]');
    const sceneRect = scene.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const overflows = Object.fromEntries(["ROOT", "P"].map((id) => {
      const host = document.querySelector(`[data-nodeid="me${id}"]`);
      const text = host?.querySelector(".text");
      const box = host?.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(text);
      const content = range.getBoundingClientRect();
      return [id, {
        left: Math.max(0, box.left - content.left),
        top: Math.max(0, box.top - content.top),
        right: Math.max(0, content.right - box.right),
        bottom: Math.max(0, content.bottom - box.bottom),
      }];
    }));
    return {
      region: {
        x: nodeRect.left - sceneRect.left,
        y: nodeRect.top - sceneRect.top,
        width: nodeRect.width,
        height: nodeRect.height,
        sceneWidth: sceneRect.width,
        sceneHeight: sceneRect.height,
      },
      overflows,
    };
  });
}

test.beforeEach(() => fs.mkdirSync(OUT, { recursive: true }));

test("source root color survives real PNG, JPEG and WebP downloads", async ({ page }) => {
  const results = {};
  await openSavedAppearance(page);
  await toFormat(page, "svg");
  const svgPath = await downloadImage(page, "svg");
  const { region: rootRegion, overflows } = await rootRegionFromSvg(page, fs.readFileSync(svgPath, "utf8"));
  fs.writeFileSync(path.join(OUT, "svg-text-overflow.json"), JSON.stringify(overflows, null, 2));
  for (const [id, overflow] of Object.entries(overflows)) {
    expect(Math.max(...Object.values(overflow)), `${id} text remains inside its visible node box`).toBeLessThanOrEqual(1);
  }
  for (const [format, mime] of [["png", "image/png"], ["jpeg", "image/jpeg"], ["webp", "image/webp"]]) {
    await openSavedAppearance(page);
    expect(await sourceRootColor(page)).toBe("rgb(18, 108, 242)");
    await toFormat(page, format);
    const output = await downloadImage(page, format);
    const metrics = await rasterColorMetrics(page, fs.readFileSync(output), mime, [18, 108, 242], rootRegion);
    results[format] = { output: path.basename(output), bytes: fs.statSync(output).size, ...metrics };
    expect(metrics.nearest, `${format} contains the saved root blue`).toBeLessThanOrEqual(24);
    expect(metrics.closePixels / metrics.sampledPixels, `${format} root interior retains the saved blue fill`).toBeGreaterThan(0.45);
  }
  fs.writeFileSync(path.join(OUT, "raster-color-metrics.json"), JSON.stringify(results, null, 2));
});

async function capturePdfRequest(page, { mode, pageSize, name }) {
  let body;
  const jobId = `color-${name}`;
  await page.route("**/mindmaps/*/exports", async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ job_id: jobId, status: "queued" }) });
  });
  await page.route(`**/mindmaps/exports/${jobId}`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ job_id: jobId, status: "done", progress: 100, result: { node_count: 6 } }),
  }));

  await openSavedAppearance(page);
  await toFormat(page, "pdf");
  await page.getByRole("button", { name: mode === "map" ? "Chỉ sơ đồ" : "Sơ đồ + dàn ý" }).click();
  if (pageSize === "content_fit") await page.getByRole("button", { name: "Vừa nội dung — Xem trên màn hình" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tạo PDF" }).click();
  await expect.poll(() => Boolean(body), { timeout: 30_000 }).toBe(true);

  expect(body.options.mode).toBe(mode);
  expect(body.options.pageSize).toBe(pageSize);
  expect(body.map_geometry_manifest.nodes.map((node) => node.id).sort()).toEqual(["A", "B", "C", "D", "P", "ROOT"]);
  fs.writeFileSync(path.join(OUT, `${name}-request.json`), JSON.stringify(body, null, 2));
  fs.writeFileSync(path.join(OUT, `${name}-source.png`), Buffer.from(body.map_image_base64, "base64"));
  await page.unrouteAll({ behavior: "wait" });
  return body;
}

test("Chromium PDF capture preserves source root color for A4, content-fit and map+outline", async ({ page }) => {
  for (const scenario of [
    { mode: "map", pageSize: "A4", name: "pdf-a4-map" },
    { mode: "map", pageSize: "content_fit", name: "pdf-content-fit-map" },
    { mode: "map_and_outline", pageSize: "content_fit", name: "pdf-content-fit-map-and-outline" },
  ]) {
    const request = await capturePdfRequest(page, scenario);
    const png = fs.readFileSync(path.join(OUT, `${scenario.name}-source.png`));
    const root = request.map_geometry_manifest.nodes.find((node) => node.id === "ROOT");
    const metrics = await rasterColorMetrics(page, png, "image/png", [18, 108, 242], {
      ...root,
      sceneWidth: request.map_geometry_manifest.image_width_px,
      sceneHeight: request.map_geometry_manifest.image_height_px,
    });
    expect(metrics.closePixels / metrics.sampledPixels, `${scenario.name} capture retains the saved blue root fill`).toBeGreaterThan(0.45);
  }
});
