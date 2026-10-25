import { chromium } from "../../../FE/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const prototype = pathToFileURL(path.join(here, "quiz.html")).href;
const cases = [
  ["taking", 1440, 900], ["taking", 820, 1180], ["taking", 390, 844], ["taking", 320, 844],
  ["results", 1440, 900], ["results", 820, 1180], ["results", 390, 844], ["results", 320, 844],
  ["review", 1440, 900], ["review", 820, 1180], ["review", 390, 844], ["review", 320, 844],
];

const browser = await chromium.launch({ headless: true });
for (const [screen, width, height] of cases) {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${prototype}?screen=${screen},theme=${theme}`);
    const result = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      screen: document.documentElement.dataset.screen,
      theme: document.documentElement.dataset.theme,
      visibleMains: [...document.querySelectorAll("main")].filter((node) => getComputedStyle(node).display !== "none").length,
      focusables: document.querySelectorAll("button,input").length,
    }));
    if (result.viewport !== width || result.scrollWidth > width || result.screen !== screen || result.theme !== theme || result.visibleMains !== 1 || result.focusables < 6) {
      throw new Error(`Invalid Quiz ${screen}/${width}/${theme}: ${JSON.stringify(result)}`);
    }
    await page.close();
  }
}
await browser.close();
console.log(`Verified ${cases.length * 2} Quiz states: exact viewport, no horizontal overflow, single state, and usable controls.`);
