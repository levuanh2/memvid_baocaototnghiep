// Branch-selection marker geometry and interaction on the fixture harness (fake data only).
// Measures real layout: indicator size, 40x40 hitbox, side placement, click and keyboard toggle,
// and that a tick leaves the canvas transform untouched.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(__dirname, "..", "qa-artifacts", "branch-marker");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const MAP_A_ID = "fixture-map-a";
const nodeSelector = (id) => `[data-nodeid="me${id}"]`;

async function openSelection(page) {
  await page.locator('[aria-label="Xuất sơ đồ"]').first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
  await page.locator(".export-inline-action").click();
  await expect(page.locator(".mm-selection-bar")).toBeVisible();
}

async function measureMarkers(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll("me-export-check").forEach((el) => {
      const mr = el.getBoundingClientRect();
      const tpc = el.parentElement && el.parentElement.querySelector(":scope > me-tpc");
      const tr = tpc ? tpc.getBoundingClientRect() : null;
      // Sizes are measured on screen (the host is 40 screen px at any zoom).
      const dotEl = el.querySelector(".mm-export-check__dot");
      const dr = dotEl ? dotEl.getBoundingClientRect() : null;
      out.push({
        side: el.dataset.side,
        w: Math.round(mr.width * 10) / 10, h: Math.round(mr.height * 10) / 10,
        dotW: dr ? Math.round(dr.width * 10) / 10 : null,
        hitW: Math.round(mr.width * 10) / 10, hitH: Math.round(mr.height * 10) / 10,
        // Marker left edge relative to the topic's left and right edges, in map units.
        // Screen px: the dot's left edge against the topic's left and right edges.
        fromTopicLeft: tr && dr ? Math.round(dr.left - tr.left) : null,
        fromTopicRight: tr && dr ? Math.round(dr.left - tr.right) : null,
        label: el.getAttribute("aria-label"),
      });
    });
    return out;
  });
}

test.describe("Branch selection marker: geometry and interaction", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/fixture-harness.html");
    await expect(page.getByTestId("fixture-harness-root")).toBeVisible();
    await expect(page.locator(nodeSelector(`${MAP_A_ID}-root`))).toBeVisible();
  });

  test("indicator is a 20px circle with a 40x40 hitbox, placed on the outer side of each branch", async ({ page }) => {
    await openSelection(page);
    await page.waitForTimeout(400);
    const markers = await measureMarkers(page);
    expect(markers.length).toBeGreaterThan(0);
    for (const m of markers) {
      expect(m.w).toBeGreaterThanOrEqual(39);
      expect(m.w).toBeLessThanOrEqual(41);
      expect(m.h).toBeGreaterThanOrEqual(39);
      expect(m.h).toBeLessThanOrEqual(41);
      expect(m.dotW).toBeGreaterThanOrEqual(19);
      expect(m.dotW).toBeLessThanOrEqual(21);
    }
    for (const m of markers.filter((x) => x.side === "left")) {
      expect(Math.abs(m.fromTopicLeft - -10)).toBeLessThanOrEqual(2); // left edge 10px outside the topic's left edge
    }
    for (const m of markers.filter((x) => x.side === "right")) {
      expect(Math.abs(m.fromTopicRight - -10)).toBeLessThanOrEqual(2); // left edge 10px inside the topic's right edge: centred on it
    }
    await page.screenshot({ path: path.join(SHOT_DIR, "1440x1024-light-selection-0.png") });
  });

  test("a real click on a marker toggles selection and leaves the canvas transform untouched", async ({ page }) => {
    await openSelection(page);
    const before = await page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
    const check = page.locator("me-export-check").first();
    await check.click();
    await expect(page.locator(".mm-selection-bar")).toContainText("1 nhánh đã chọn");
    await expect(check).toHaveAttribute("aria-checked", "true");
    const after = await page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
    expect(after).toBe(before);
  });

  test("keyboard: Space and Enter toggle a focused marker", async ({ page }) => {
    await openSelection(page);
    const check = page.locator("me-export-check").first();
    await check.focus();
    await page.keyboard.press("Space");
    await expect(page.locator(".mm-selection-bar")).toContainText("1 nhánh đã chọn");
    await page.keyboard.press("Enter");
    await expect(page.locator(".mm-selection-bar")).toContainText("Chọn các nhánh muốn xuất");
  });
});
