import { chromium } from "../../../FE/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const prototype = pathToFileURL(path.join(here, "surfaces.html")).href;
const cases = [
  ["export",1440,900],["export",820,1180],["export",390,844],["export",320,844],
  ["export-guided",1440,900],["account",1440,900],["account",390,844],
  ["profile",1440,900],["profile",820,1180],["profile",390,844],["profile",320,844],
  ["dialog-generate",1440,900],["dialog-generate",390,844],["dialog-delete",1440,900],["dialog-delete",390,844],
];
const browser = await chromium.launch({ headless: true });
for (const [screen,width,height] of cases) {
  for (const theme of ["light","dark"]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${prototype}?screen=${screen},theme=${theme}`);
    const result = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, screen: document.documentElement.dataset.screen, theme: document.documentElement.dataset.theme, focusables: document.querySelectorAll("button,input,textarea,select").length }));
    if (result.viewport !== width || result.scrollWidth > width || result.screen !== screen || result.theme !== theme || result.focusables < 2) throw new Error(`Invalid surface ${screen}/${width}/${theme}: ${JSON.stringify(result)}`);
    await page.close();
  }
}
await browser.close();
console.log(`Verified ${cases.length * 2} surface states: exact viewport, no horizontal overflow, correct state and controls.`);
