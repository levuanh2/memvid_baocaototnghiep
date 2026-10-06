// Real mouse clicks on every visible branch dot (fixture data only). At low zoom a neighbour's
// 40px host covers some dots; a click on such a dot must still toggle that dot's own branch.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "qa-artifacts", "marker-screen-size");
fs.mkdirSync(OUT, { recursive: true });

async function openSelection(page) {
  await page.locator('[aria-label="Xuất sơ đồ"]').first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
  await page.locator(".export-inline-action").click();
  await expect(page.locator(".mm-selection-bar")).toBeVisible();
}

const states = (page) => page.evaluate(() => [...document.querySelectorAll("me-export-check")].map((el) => el.getAttribute("aria-checked")));
const transform = (page) => page.evaluate(() => document.querySelector(".map-canvas").style.transform);

for (const [w, h] of [[1024, 768], [1440, 1024]]) {
  test(`real click on each visible dot toggles only that branch at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/fixture-harness.html");
    await expect(page.getByTestId("fixture-harness-root")).toBeVisible();
    await openSelection(page);
    await page.waitForTimeout(400);

    const targets = await page.evaluate(() => [...document.querySelectorAll("me-export-check")].map((el, i) => {
      const d = el.querySelector(".mm-export-check__dot").getBoundingClientRect();
      const cx = d.left + d.width / 2, cy = d.top + d.height / 2;
      const top = document.elementFromPoint(cx, cy);
      const own = !!top && (top === el.querySelector(".mm-export-check__dot") || el.contains(top));
      const inside = d.left >= 0 && d.top >= 0 && d.right <= innerWidth && d.bottom <= innerHeight;
      return { i, x: cx, y: cy, inside, coveredByNeighbour: !own };
    }).filter((t) => t.inside));

    const t0 = await transform(page);
    const failures = [];
    for (const t of targets) {
      const before = await states(page);
      await page.mouse.click(t.x, t.y);
      await page.waitForTimeout(120);
      const after = await states(page);
      const changed = after.map((v, i) => (v !== before[i] ? i : -1)).filter((i) => i >= 0);
      if (changed.length !== 1 || changed[0] !== t.i) failures.push({ clicked: t.i, changed, coveredByNeighbour: t.coveredByNeighbour });
      // Untick so each dot is tested from the same unchecked start.
      await page.mouse.click(t.x, t.y);
      await page.waitForTimeout(120);
    }

    const summary = { viewport: `${w}x${h}`, dotsClicked: targets.length, coveredByNeighbour: targets.filter((t) => t.coveredByNeighbour).length, failures: failures.length, transformChanged: (await transform(page)) !== t0 };
    const file = path.join(OUT, "click-resolution.json");
    const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    prev[`${w}x${h}`] = summary;
    fs.writeFileSync(file, JSON.stringify(prev, null, 1));

    expect(targets.length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
    expect(summary.transformChanged).toBe(false);
    await expect(page.locator(".mm-selection-bar")).toContainText("Chọn các nhánh muốn xuất");
  });
}
