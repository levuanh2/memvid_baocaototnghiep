import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../../FE/node_modules/playwright/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, "screenshots");
const fixture = path.resolve(here, "../../../FE/e2e/fixtures/sample-doc.txt");
const baseURL = process.env.LIVE_FE_URL || "http://127.0.0.1:5190";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

await page.goto(`${baseURL}/register`, { waitUntil: "networkidle" });
await page.locator('input[type="text"]').fill("Visual Design Before");
await page.locator('input[type="email"]').fill(`visual-before-${unique}@example.test`);
await page.locator('input[type="password"]').nth(0).fill("E2E-test-password-1");
await page.locator('input[type="password"]').nth(1).fill("E2E-test-password-1");
await page.locator('button[type="submit"]').click();
await page.waitForURL(/\/app(?:\?|$)/, { timeout: 20_000 });

await page.goto(`${baseURL}/app/study`, { waitUntil: "networkidle" });
const uploadDone = page.waitForResponse(
  response => response.url().includes("/api/documents/upload") && response.request().method() === "POST",
  { timeout: 20_000 },
);
await page.locator('input[type="file"]').setInputFiles(fixture);
await uploadDone;

await page.goto(`${baseURL}/app`, { waitUntil: "networkidle" });
await page.getByText(/sample-doc/i).first().waitFor({ state: "visible", timeout: 20_000 });
const checkboxes = page.locator('input[type="checkbox"]');
if (await checkboxes.count()) await checkboxes.first().check();
await page.waitForTimeout(400);

await page.screenshot({ path: path.join(output, "before-live-workspace-1440x900-light.png") });

await page.evaluate(() => localStorage.setItem("memvid-theme", "dark"));
await page.reload({ waitUntil: "networkidle" });
await page.setViewportSize({ width: 820, height: 1180 });
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(output, "before-live-workspace-820x1180-dark.png") });

await page.evaluate(() => localStorage.setItem("memvid-theme", "light"));
await page.reload({ waitUntil: "networkidle" });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(output, "before-live-workspace-390x844-light.png") });

await browser.close();
