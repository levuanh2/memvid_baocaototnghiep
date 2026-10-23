import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "qa-artifacts", "export-root-color-fidelity");

const topic = (id) => `[data-nodeid="me${id}"]`;
const marker = (id) => `me-export-check[data-node-id="${id}"]`;

function rgbChannels(value) {
  const match = value.match(/[\d.]+/g);
  return match ? match.slice(0, 3).map(Number) : [];
}

function contrastRatio(foreground, background) {
  const luminance = (rgb) => {
    const channels = rgbChannels(rgb).map((value) => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

async function openFixture(page, { map = "post-pr77", appearance = null, dark = false } = {}) {
  const query = new URLSearchParams({ map });
  if (appearance) query.set("initialAppearance", appearance);
  await page.goto(`/fixture-harness.html?${query}`);
  await expect.poll(() => page.evaluate(() => Boolean(window.__STUDYMAP_FIXTURE__?.mind))).toBe(true);
  if (dark) {
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(100);
  }
}

async function computedTopicStyle(page, id) {
  return page.locator(topic(id)).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderColor,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
    };
  });
}

async function advanceToSvgAppearance(page) {
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="svg"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
}

async function downloadSvgFromAppearance(page, filename) {
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất SVG" }).click();
  const download = await pending;
  const output = path.join(OUT, filename);
  await download.saveAs(output);
  return fs.readFileSync(output, "utf8");
}

async function exportFullSvg(page, filename) {
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await advanceToSvgAppearance(page);
  return downloadSvgFromAppearance(page, filename);
}

async function exportedStyleFromSvg(page, svg, id) {
  await page.setContent(svg);
  return computedTopicStyle(page, id);
}

test.beforeEach(() => fs.mkdirSync(OUT, { recursive: true }));

for (const dark of [false, true]) {
  test(`A/E: downloaded SVG preserves live blue/white root colors in ${dark ? "dark" : "light"} theme`, async ({ page }) => {
    await openFixture(page, { dark });
    const source = await computedTopicStyle(page, "ROOT");
    const sourceContrast = contrastRatio(source.color, source.backgroundColor);
    if (!dark) expect(sourceContrast).toBeGreaterThanOrEqual(4.5);

    const svg = await exportFullSvg(page, `root-${dark ? "dark" : "light"}.svg`);
    expect(svg).toContain('data-nodeid="meROOT"');
    const exported = await exportedStyleFromSvg(page, svg, "ROOT");
    const exportedContrast = contrastRatio(exported.color, exported.backgroundColor);
    fs.writeFileSync(path.join(OUT, `root-${dark ? "dark" : "light"}.json`), JSON.stringify({ source, exported, sourceContrast, exportedContrast }, null, 2));

    expect(exported.backgroundColor).toBe(source.backgroundColor);
    expect(exported.color).toBe(source.color);
    expect(exportedContrast).toBeCloseTo(sourceContrast, 5);
  });
}

test("B: downloaded exact-selection SVG keeps the promoted parent section style", async ({ page }) => {
  await openFixture(page);
  const sourceParent = await computedTopicStyle(page, "P");
  const sourceRoot = await computedTopicStyle(page, "ROOT");

  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
  await page.locator(".export-inline-action").click();
  for (const id of ["A", "B"]) await page.locator(marker(id)).press("Space");
  await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();
  await advanceToSvgAppearance(page);
  const svg = await downloadSvgFromAppearance(page, "promoted-parent.svg");
  expect([...svg.matchAll(/data-nodeid="me([^" ]+)"/g)].map((match) => match[1]).sort()).toEqual(["A", "B", "P"]);
  const exportedParent = await exportedStyleFromSvg(page, svg, "P");

  expect(exportedParent.backgroundColor).toBe(sourceParent.backgroundColor);
  expect(exportedParent.color).toBe(sourceParent.color);
  expect(exportedParent.backgroundColor).not.toBe(sourceRoot.backgroundColor);
  expect(contrastRatio(exportedParent.color, exportedParent.backgroundColor)).toBeGreaterThanOrEqual(4.5);
});

test("C: downloaded SVG preserves a saved non-default appearance", async ({ page }) => {
  await openFixture(page, { appearance: "study" });
  const source = await computedTopicStyle(page, "ROOT");
  const svg = await exportFullSvg(page, "saved-study.svg");
  const exported = await exportedStyleFromSvg(page, svg, "ROOT");
  fs.writeFileSync(path.join(OUT, "saved-study.json"), JSON.stringify({ source, exported }, null, 2));

  expect(exported.backgroundColor).toBe(source.backgroundColor);
  expect(exported.color).toBe(source.color);
  expect(exported.borderColor).toBe(source.borderColor);
});

test("D: export-only override changes the downloaded SVG but never the live canvas", async ({ page }) => {
  await openFixture(page, { appearance: "study" });
  const liveBefore = await computedTopicStyle(page, "ROOT");
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await advanceToSvgAppearance(page);
  await page.locator('input[name="mm-appearance-mode"]').nth(1).check();
  await page.getByRole("button", { name: "Gốc", exact: true }).click();
  const fill = page.locator('[data-testid="appearance-mode-section"] input[type="color"]').first();
  await fill.fill("#A1B2C3");
  await expect(fill).toHaveValue("#a1b2c3");
  expect(await computedTopicStyle(page, "ROOT")).toEqual(liveBefore);

  const svg = await downloadSvgFromAppearance(page, "export-only-root.svg");
  const exported = await exportedStyleFromSvg(page, svg, "ROOT");
  expect(exported.backgroundColor).toBe("rgb(161, 178, 195)");
});
