import { chromium } from "../../../FE/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const prototype = pathToFileURL(path.join(here, "maps.html")).href;
const cases = [];
for (const screen of ["mindmap", "studymap"])
  for (const [width, height] of [[1440, 900], [820, 1180], [390, 844], [320, 844]])
    for (const theme of width === 320 ? ["light"] : ["light", "dark"])
      cases.push({ screen, width, height, theme });

const browser = await chromium.launch({ headless: true });
for (const testCase of cases) {
  const page = await browser.newPage({ viewport: { width: testCase.width, height: testCase.height } });
  await page.goto(`${prototype}?screen=${testCase.screen},theme=${testCase.theme}`);
  const result = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    screen: document.documentElement.dataset.screen,
    theme: document.documentElement.dataset.theme,
    selected: document.querySelectorAll(".selected").length,
    canvas: document.querySelector(document.documentElement.dataset.screen === "studymap" ? ".study-map-page .knowledge-map" : ".map-workspace .knowledge-map")?.getBoundingClientRect().width || 0,
  }));
  if (result.viewport !== testCase.width || result.scrollWidth > testCase.width || result.screen !== testCase.screen || result.theme !== testCase.theme || result.selected < 1 || result.canvas < 240) {
    throw new Error(`Invalid map state ${JSON.stringify(testCase)}: ${JSON.stringify(result)}`);
  }
  await page.close();
}
await browser.close();
console.log(`Verified ${cases.length} map states: exact viewport, no horizontal overflow, selected-node state, and usable canvas.`);
