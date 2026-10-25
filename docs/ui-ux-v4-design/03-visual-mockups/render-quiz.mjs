import { chromium } from "../../../FE/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const prototype = pathToFileURL(path.join(here, "quiz.html")).href;
const output = path.join(here, "screenshots");
const cases = [
  ...["light", "dark"].flatMap((theme) => [
    ["taking", theme, 1440, 900], ["taking", theme, 820, 1180], ["taking", theme, 390, 844],
    ["results", theme, 1440, 900], ["results", theme, 820, 1180], ["results", theme, 390, 844],
    ["review", theme, 1440, 900], ["review", theme, 820, 1180], ["review", theme, 390, 844],
  ]),
  ["taking", "light", 320, 844], ["results", "light", 320, 844], ["review", "light", 320, 844],
];

const browser = await chromium.launch({ headless: true });
for (const [screen, theme, width, height] of cases) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`${prototype}?screen=${screen},theme=${theme}`);
  const suffix = width === 320 ? "-stress" : "";
  await page.screenshot({ path: path.join(output, `quiz-${screen}-${width}x${height}-${theme}${suffix}.png`) });
  await page.close();
}
await browser.close();
console.log(`Rendered ${cases.length} populated Quiz states.`);
