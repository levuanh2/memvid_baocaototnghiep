import { chromium } from "../../../FE/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const prototype = pathToFileURL(path.join(here, "surfaces.html")).href;
const output = path.join(here, "screenshots");
const cases = [
  ...["light", "dark"].flatMap(theme => [
    ["export", theme, 1440, 900], ["export", theme, 820, 1180], ["export", theme, 390, 844],
    ["profile", theme, 1440, 900], ["profile", theme, 820, 1180], ["profile", theme, 390, 844],
    ["account", theme, 1440, 900], ["account", theme, 390, 844],
    ["dialog-generate", theme, 1440, 900], ["dialog-generate", theme, 390, 844],
  ]),
  ["export", "light", 320, 844], ["profile", "light", 320, 844],
  ["export-guided", "light", 1440, 900], ["export-guided", "dark", 1440, 900],
  ["dialog-delete", "light", 1440, 900], ["dialog-delete", "dark", 390, 844],
];

const browser = await chromium.launch({ headless: true });
for (const [screen, theme, width, height] of cases) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`${prototype}?screen=${screen},theme=${theme}`);
  const suffix = width === 320 ? "-stress" : "";
  await page.screenshot({ path: path.join(output, `${screen}-${width}x${height}-${theme}${suffix}.png`) });
  await page.close();
}
await browser.close();
console.log(`Rendered ${cases.length} Export/account/profile/dialog states.`);
