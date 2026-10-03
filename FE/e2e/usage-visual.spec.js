import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { registerAndEnterApp } from "./fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.resolve(__dirname, "../../docs/qa-screenshots/usage-metering");

test("usage popover stays readable on desktop and mobile", async ({ browser }) => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.route("**/usage/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan: "Plus",
        used: 84000,
        reserved: 0,
        limit: 100000,
        remaining: 16000,
        percentage: 84,
        reset_at: "2026-11-01T00:00:00Z",
        breakdown: { chat: 52200, upload: 19600, summary: 7400, mindmap: 4800 },
      }),
    });
  });

  await registerAndEnterApp(page);
  const trigger = page.getByTitle("Mức sử dụng AI");
  await expect(trigger).toContainText("AI 84%");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Mức sử dụng AI" });
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: path.join(evidenceDir, "usage-desktop-1440x900.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: path.join(evidenceDir, "usage-mobile-390x844.png"),
    fullPage: true,
  });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await context.close();
});
