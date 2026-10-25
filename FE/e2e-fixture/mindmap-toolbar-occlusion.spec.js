import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PHASE = process.env.TOOLBAR_OCCLUSION_PHASE === "before" ? "before" : "after";
const OUT = path.resolve(HERE, "..", "qa-artifacts", "mindmap-toolbar-occlusion");
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "tablet-edge", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];
const CONTROLS = [".mm-appearance-trigger", ".mm-export-trigger", ".mm-overflow-trigger"];

async function hitTestToolbar(page) {
  return page.evaluate((selectors) => Object.fromEntries(selectors.map((selector) => {
    const control = document.querySelector(selector);
    const rect = control.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return [selector, {
      center: { x, y },
      rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
      ownsCenter: Boolean(hit && (hit === control || control.contains(hit))),
      hit: hit ? `${hit.tagName}.${String(hit.className || "").trim().split(/\s+/).join(".")}` : null,
      interceptedByInspector: Boolean(hit?.closest(".mindmap-tools-overlay, .context-inspector-shell")),
    }];
  })), CONTROLS);
}

test("selected-node Inspector does not intercept toolbar control centers", async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/fixture-harness.html?toolbarOverlay=1");
  await expect(page.locator("me-tpc")).not.toHaveCount(0);
  await page.locator("me-tpc").nth(1).click();
  await expect(page.locator("aside.mindmap-tools-overlay")).toBeVisible();

  const measurements = {};
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const expectedInspector = viewport.width < 768
      ? page.locator("aside.context-inspector-shell")
      : page.locator("aside.mindmap-tools-overlay");
    const unexpectedInspector = viewport.width < 768
      ? page.locator("aside.mindmap-tools-overlay")
      : page.locator("aside.context-inspector-shell");
    await expect(expectedInspector).toBeVisible();
    await expect(unexpectedInspector).not.toBeVisible();
    measurements[viewport.name] = await hitTestToolbar(page);
    await page.screenshot({
      path: path.join(OUT, `${PHASE}-${viewport.name}-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    });
  }
  fs.writeFileSync(path.join(OUT, `${PHASE}-element-from-point.json`), JSON.stringify(measurements, null, 2));

  for (const [viewport, controls] of Object.entries(measurements)) {
    for (const [selector, proof] of Object.entries(controls)) {
      expect(proof.ownsCenter, `${viewport} ${selector}: center hit ${proof.hit}`).toBe(true);
      expect(proof.interceptedByInspector, `${viewport} ${selector}: Inspector intercepted center`).toBe(false);
    }
  }

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    await page.locator(".mm-appearance-trigger").click();
    const appearanceDialog = page.getByRole("dialog", { name: "Giao diện" });
    await expect(appearanceDialog, `${viewport.name}: Appearance opens`).toBeVisible();
    await appearanceDialog.getByRole("button", { name: "Đóng hộp thoại" }).click();

    await page.locator(".mm-export-trigger").click();
    const exportDialog = page.getByRole("dialog", { name: "Xuất sơ đồ" });
    await expect(exportDialog, `${viewport.name}: Export opens`).toBeVisible();
    await exportDialog.getByRole("button", { name: "Đóng hộp thoại" }).click();

    await page.locator(".mm-overflow-trigger").click();
    await expect(page.locator(".mm-toolbar-menu"), `${viewport.name}: Overflow opens`).toBeVisible();
    await page.locator(".mm-overflow-trigger").click();
  }
});
