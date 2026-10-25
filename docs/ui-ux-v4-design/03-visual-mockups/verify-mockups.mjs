import { chromium } from "../../../FE/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const prototype = pathToFileURL(path.join(here, "workspace.html")).href;
const cases = [
  [1440, 900, "light", "desk"],
  [1440, 900, "dark", "desk"],
  [820, 1180, "light", "desk"],
  [820, 1180, "dark", "desk"],
  [390, 844, "light", "desk"],
  [390, 844, "dark", "desk"],
  [320, 844, "light", "desk"],
  [1440, 900, "light", "focus"],
  [1440, 900, "dark", "focus"],
];

const browser = await chromium.launch({ headless: true });
for (const [width, height, theme, layout] of cases) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`${prototype}?theme=${theme},layout=${layout}`);
  const result = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    theme: document.documentElement.dataset.theme,
    layout: document.documentElement.dataset.layout,
    visibleDock: getComputedStyle(document.querySelector(".mobile-dock")).display !== "none",
  }));
  if (result.viewport !== width || result.scrollWidth > width || result.theme !== theme || result.layout !== layout) {
    throw new Error(`Invalid ${width}×${height} ${theme}/${layout}: ${JSON.stringify(result)}`);
  }
  if ((width < 768) !== result.visibleDock) {
    throw new Error(`Mobile dock breakpoint mismatch at ${width}px`);
  }
  await page.close();
}
await browser.close();
console.log(`Verified ${cases.length} mockup states: exact viewport, no horizontal overflow, correct theme/layout and mobile dock.`);

