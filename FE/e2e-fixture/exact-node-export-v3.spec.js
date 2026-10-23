import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "qa-artifacts", "exact-node-export-v3");
const marker = (id) => `me-export-check[data-node-id="${id}"]`;

async function openSelection(page, { map = "exact-v3", zoom = 0.69, initialAppearance = null } = {}) {
  const appearanceQuery = initialAppearance ? `&initialAppearance=${initialAppearance}` : "";
  await page.goto(`/fixture-harness.html?map=${map}${appearanceQuery}`);
  await expect.poll(() => page.evaluate(() => Boolean(window.__STUDYMAP_FIXTURE__?.mind))).toBe(true);
  await page.evaluate((value) => window.__STUDYMAP_FIXTURE__.mind.scale(value), zoom);
  await expect.poll(() => page.evaluate(() => window.__STUDYMAP_FIXTURE__.mind.scaleVal)).toBeCloseTo(zoom, 5);
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
  await page.locator(".export-inline-action").click();
}

async function selectAndDownloadSvg(page, ids, filename) {
  for (const id of ids) await page.locator(marker(id)).press("Space");
  await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="svg"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất SVG" }).click();
  const download = await waiting;
  const output = path.join(OUT, filename);
  await download.saveAs(output);
  return fs.readFileSync(output, "utf8");
}

async function selectAndDownloadRaster(page, ids, format, filename) {
  for (const id of ids) await page.locator(marker(id)).press("Space");
  await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator(`input[name="mm-export-format"][value="${format}"]`).check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: `Xuất ${format.toUpperCase()}` }).click();
  const download = await waiting;
  const output = path.join(OUT, filename);
  await download.saveAs(output);
  return output;
}

async function rasterMetrics(page, filePath, mime) {
  const data = fs.readFileSync(filePath).toString("base64");
  await page.setContent(`<img id="artifact" src="data:${mime};base64,${data}">`);
  return page.locator("#artifact").evaluate(async (image) => {
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonTransparent = 0;
    let nonWhite = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 0) nonTransparent += 1;
      if (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245) nonWhite += 1;
    }
    return { width: canvas.width, height: canvas.height, nonTransparent, nonWhite };
  });
}

async function inspectSvg(page, svg, ids) {
  await page.setContent(svg);
  return page.evaluate((nodeIds) => Object.fromEntries(nodeIds.map((id) => {
    const topic = document.querySelector(`me-tpc[data-nodeid="me${id}"]`);
    const rect = topic.getBoundingClientRect();
    const style = getComputedStyle(topic);
    return [id, {
      left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      backgroundColor: style.backgroundColor, color: style.color, fontSize: style.fontSize,
    }];
  })), ids);
}

async function nodeGeometry(page, ids) {
  return page.evaluate((nodeIds) => Object.fromEntries(nodeIds.map((id) => {
    const topic = window.__STUDYMAP_FIXTURE__.mind.findEle(id);
    const rect = topic.getBoundingClientRect();
    const style = getComputedStyle(topic);
    return [id, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      backgroundColor: style.backgroundColor,
      color: style.color,
      fontSize: style.fontSize,
    }];
  })), ids);
}

test("selected left-side siblings keep their source direction, order and parent visual role", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto("/fixture-harness.html?map=post-pr77");
  await expect.poll(() => page.evaluate(() => Boolean(window.__STUDYMAP_FIXTURE__?.mind))).toBe(true);

  const source = await nodeGeometry(page, ["ROOT", "P", "A", "B"]);
  expect(source.P.left).toBeLessThan(source.ROOT.left);
  expect(source.A.left).toBeLessThan(source.P.left);
  expect(source.B.left).toBeLessThan(source.P.left);
  expect(source.A.top).toBeLessThan(source.B.top);

  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
  await page.locator(".export-inline-action").click();
  await page.locator(marker("A")).press("Space");
  await page.locator(marker("B")).press("Space");
  await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="svg"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();

  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất SVG" }).click();
  const download = await waiting;
  const svgPath = path.join(OUT, "red-left-siblings.svg");
  await download.saveAs(svgPath);
  const svg = fs.readFileSync(svgPath, "utf8");
  expect([...svg.matchAll(/data-nodeid="me([^" ]+)"/g)].map((match) => match[1]).sort()).toEqual(["A", "B", "P"]);

  await page.setContent(svg);
  const exported = await page.evaluate(() => Object.fromEntries(["P", "A", "B"].map((id) => {
    const topic = document.querySelector(`me-tpc[data-nodeid="me${id}"]`);
    const rect = topic.getBoundingClientRect();
    const style = getComputedStyle(topic);
    return [id, {
      left: rect.left,
      top: rect.top,
      backgroundColor: style.backgroundColor,
      color: style.color,
      fontSize: style.fontSize,
    }];
  })));

  expect(exported.A.left).toBeLessThan(exported.P.left);
  expect(exported.B.left).toBeLessThan(exported.P.left);
  expect(exported.A.top).toBeLessThan(exported.B.top);
  expect(await page.locator("svg.lines path, svg.subLines path").count()).toBe(2);
  expect(exported.P.backgroundColor).toBe(source.P.backgroundColor);
  expect(exported.P.color).toBe(source.P.color);
  expect(exported.P.fontSize).toBe(source.P.fontSize);
});

test("turning automatic parent inclusion off exports disconnected explicit nodes without a visible anchor", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto("/fixture-harness.html?map=post-pr77");
  await expect.poll(() => page.evaluate(() => Boolean(window.__STUDYMAP_FIXTURE__?.mind))).toBe(true);
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
  await page.locator(".export-inline-action").click();
  await page.locator(marker("A")).press("Space");
  await page.locator(marker("B")).press("Space");
  await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();

  const autoParents = page.getByRole("checkbox", { name: "Tự động thêm node cha để giữ cấu trúc" });
  await expect(autoParents).toBeChecked();
  await autoParents.uncheck();
  await expect(page.locator(".export-footer__summary")).toContainText("2 node đã chọn · 0 node cha tự thêm · 2 node được xuất");

  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="svg"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất SVG" }).click();
  const download = await waiting;
  const svgPath = path.join(OUT, "auto-parent-off.svg");
  await download.saveAs(svgPath);
  const svg = fs.readFileSync(svgPath, "utf8");
  expect([...svg.matchAll(/data-nodeid="me([^" ]+)"/g)].map((match) => match[1]).sort()).toEqual(["A", "B"]);
  expect(svg).not.toContain("__studymap_export_anchor__");
  await page.setContent(svg);
  expect(await page.locator("svg.lines path, svg.subLines path").count()).toBe(0);
  const disconnected = await page.evaluate(() => ["A", "B"].map((id) => {
    const rect = document.querySelector(`me-tpc[data-nodeid="me${id}"]`).getBoundingClientRect();
    return { id, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }));
  expect(disconnected[0].top).toBeLessThan(disconnected[1].top);
  expect(disconnected[0].bottom).toBeLessThanOrEqual(disconnected[1].top);
});

test("an auto-added parent can be suppressed and restored without changing explicit checks", async ({ page }) => {
  await page.goto("/fixture-harness.html?map=post-pr77");
  await expect.poll(() => page.evaluate(() => Boolean(window.__STUDYMAP_FIXTURE__?.mind))).toBe(true);
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
  await page.locator(".export-inline-action").click();
  await page.locator(marker("A")).press("Space");
  await page.locator(marker("B")).press("Space");
  await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();

  await expect(page.locator(".export-footer__summary")).toContainText("2 node đã chọn · 1 node cha tự thêm · 3 node được xuất");
  const removeParent = page.getByRole("button", { name: /Không thêm node cha.*Phát hiện/ });
  await removeParent.click();
  await expect(page.locator(".export-footer__summary")).toContainText("2 node đã chọn · 0 node cha tự thêm · 2 node được xuất");

  await page.getByRole("button", { name: /Khôi phục node cha.*Phát hiện/ }).click();
  await expect(page.locator(".export-footer__summary")).toContainText("2 node đã chọn · 1 node cha tự thêm · 3 node được xuất");
});

test("manual suppression survives review navigation and selection changes in the same map session", async ({ page }) => {
  await openSelection(page);
  await page.locator(marker("A")).press("Space");
  await page.locator(marker("B")).press("Space");
  await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: /Không thêm node cha.*E — Nhánh trái/ }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Quay lại" }).click();
  await expect(page.locator(".export-footer__summary")).toContainText("2 node đã chọn · 0 node cha tự thêm · 2 node được xuất");

  await page.locator(".export-inline-action").click();
  await page.locator(marker("B")).press("Space");
  await page.locator(marker("C")).press("Space");
  await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();
  await expect(page.locator(".export-footer__summary")).toContainText("2 node đã chọn · 0 node cha tự thêm · 2 node được xuất");
  await expect(page.getByRole("button", { name: /Khôi phục node cha.*E — Nhánh trái/ })).toBeVisible();

  await page.getByRole("button", { name: "Hủy", exact: true }).click();
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await expect(page.getByRole("button", { name: /Khôi phục node cha.*E — Nhánh trái/ })).toBeVisible();
  await page.getByRole("button", { name: "Hủy", exact: true }).click();

  await page.locator('[aria-label="Mở thư viện sơ đồ"]').click();
  await page.getByText(/Quy trình học tập \(Fixture B\)/).click();
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
  await expect(page.getByRole("checkbox", { name: "Tự động thêm node cha để giữ cấu trúc" })).toBeChecked();
  await expect(page.getByRole("button", { name: /Khôi phục node cha/ })).toHaveCount(0);
});

test("a single selected leaf keeps its source visual role at 86 percent zoom", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await openSelection(page, { zoom: 0.86 });
  const source = await nodeGeometry(page, ["A"]);
  const svg = await selectAndDownloadSvg(page, ["A"], "single-a.svg");
  expect([...svg.matchAll(/data-nodeid="me([^" ]+)"/g)].map((match) => match[1])).toEqual(["A"]);
  const exported = await inspectSvg(page, svg, ["A"]);
  expect(await page.locator("svg.lines path, svg.subLines path").count()).toBe(0);
  expect(exported.A.backgroundColor).toBe(source.A.backgroundColor);
  expect(exported.A.color).toBe(source.A.color);
  expect(exported.A.fontSize).toBe(source.A.fontSize);
});

test("saved appearance and an export-only leaf override preserve the source role without mutating canvas", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await openSelection(page, { initialAppearance: "study" });
  const sourceBefore = await nodeGeometry(page, ["A"]);
  await page.locator(marker("A")).press("Space");
  await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="svg"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-appearance-mode"]').nth(1).check();
  await page.getByRole("button", { name: "Lá", exact: true }).click();
  await page.getByRole("button", { name: "Chữ nhật tròn góc", exact: true }).click();
  const leafFill = page.locator('[data-testid="appearance-mode-section"] input[type="color"]').first();
  await leafFill.fill("#A1B2C3");
  await expect(leafFill).toHaveValue("#a1b2c3");
  const sourceDuringOverride = await nodeGeometry(page, ["A"]);
  expect(sourceDuringOverride.A).toEqual(sourceBefore.A);
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất SVG" }).click();
  const download = await waiting;
  const output = path.join(OUT, "single-a-custom-leaf.svg");
  await download.saveAs(output);
  const svg = fs.readFileSync(output, "utf8");
  expect([...svg.matchAll(/data-nodeid="me([^" ]+)"/g)].map((match) => match[1])).toEqual(["A"]);
  expect(svg).toContain("rgb(161, 178, 195)");
});

test("right-side siblings and mixed branches retain source direction and order", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await openSelection(page);
  const rightSvg = await selectAndDownloadSvg(page, ["K", "L"], "right-siblings.svg");
  expect([...rightSvg.matchAll(/data-nodeid="me([^" ]+)"/g)].map((match) => match[1]).sort()).toEqual(["J", "K", "L"]);
  const right = await inspectSvg(page, rightSvg, ["J", "K", "L"]);
  expect(await page.locator("svg.lines path, svg.subLines path").count()).toBe(2);
  expect(right.K.left).toBeGreaterThan(right.J.left);
  expect(right.L.left).toBeGreaterThan(right.J.left);
  expect(right.K.top).toBeLessThan(right.L.top);

  await openSelection(page, { zoom: 0.86 });
  const mixedSvg = await selectAndDownloadSvg(page, ["A", "J"], "mixed-a-j.svg");
  expect([...mixedSvg.matchAll(/data-nodeid="me([^" ]+)"/g)].map((match) => match[1]).sort()).toEqual(["A", "E", "F", "J"]);
  const mixed = await inspectSvg(page, mixedSvg, ["F", "E", "A", "J"]);
  expect(await page.locator("svg.lines path, svg.subLines path").count()).toBe(3);
  expect(mixed.E.left).toBeLessThan(mixed.F.left);
  expect(mixed.A.left).toBeLessThan(mixed.E.left);
  expect(mixed.J.left).toBeGreaterThan(mixed.F.left);
});

test("all hierarchical auto-parent contract cases produce exact connected SVG identities", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const cases = [
    { explicit: ["A"], rendered: ["A"] },
    { explicit: ["A", "B"], rendered: ["A", "B", "E"] },
    { explicit: ["A", "B", "C"], rendered: ["A", "B", "C", "E"] },
    { explicit: ["E", "J"], rendered: ["E", "F", "J"] },
    { explicit: ["A", "J"], rendered: ["A", "E", "F", "J"] },
    { explicit: ["A", "B", "J"], rendered: ["A", "B", "E", "F", "J"] },
    { explicit: ["A", "B", "C", "D"], rendered: ["A", "B", "C", "D", "E"] },
    { explicit: ["E"], rendered: ["E"] },
    { explicit: ["F"], rendered: ["F"] },
  ];
  for (const [index, scenario] of cases.entries()) {
    await openSelection(page, { zoom: index % 2 ? 0.69 : 0.86 });
    const svg = await selectAndDownloadSvg(page, scenario.explicit, `contract-${index + 1}.svg`);
    const actual = [...svg.matchAll(/data-nodeid="me([^" ]+)"/g)].map((match) => match[1]).sort();
    expect(actual, `case ${index + 1}`).toEqual([...scenario.rendered].sort());
    await page.setContent(svg);
    expect(await page.locator("svg.lines path, svg.subLines path").count(), `connectors in case ${index + 1}`).toBe(scenario.rendered.length - 1);
  }
});

test("PNG JPEG and WebP real rasters are nonblank, tightly bounded and zoom independent", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const formats = [
    ["png", "image/png", "left-a-b.png", 0.69],
    ["jpeg", "image/jpeg", "left-a-b.jpg", 0.86],
    ["webp", "image/webp", "left-a-b.webp", 0.69],
  ];
  const dimensions = [];
  for (const [format, mime, filename, zoom] of formats) {
    await openSelection(page, { zoom });
    const filePath = await selectAndDownloadRaster(page, ["A", "B"], format, filename);
    expect(fs.statSync(filePath).size).toBeGreaterThan(1000);
    const metrics = await rasterMetrics(page, filePath, mime);
    expect(metrics.width).toBeGreaterThan(100);
    expect(metrics.height).toBeGreaterThan(60);
    expect(metrics.nonTransparent).toBeGreaterThan(1000);
    expect(metrics.nonWhite).toBeGreaterThan(100);
    dimensions.push([metrics.width, metrics.height]);
  }
  expect(new Set(dimensions.map(([width, height]) => `${width}x${height}`)).size).toBe(1);
});
