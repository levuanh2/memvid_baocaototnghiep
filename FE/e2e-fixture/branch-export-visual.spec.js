// Visual QA for the export entry and branch-selection UX on the fixture harness (fake data only).
// Captures the states and records DOM measurements. Output goes to qa-artifacts/branch-export-ux.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "qa-artifacts", "branch-export-ux");
fs.mkdirSync(OUT, { recursive: true });
const MAP_A_ID = "fixture-map-a";
const nodeSelector = (id) => `[data-nodeid="me${id}"]`;
const VIEWPORTS = [
  { w: 1440, h: 1024 }, { w: 1024, h: 768 }, { w: 390, h: 844 },
];
const RESULTS = {};

async function measure(page) {
  return page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
    const bar = document.querySelector(".mm-selection-bar");
    const legend = document.querySelector(".mm-legend");
    const barBtns = bar ? [...bar.querySelectorAll("button")].map((b) => { const x = b.getBoundingClientRect(); return [Math.round(x.width), Math.round(x.height)]; }) : [];
    const overlap = (a, b) => !!a && !!b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const barRect = bar ? bar.getBoundingClientRect() : null;
    const legRect = legend ? legend.getBoundingClientRect() : null;
    const markers = [...document.querySelectorAll("me-export-check")].map((el) => {
      const cs = getComputedStyle(el, "::before");
      return { side: el.dataset.side, w: el.offsetWidth, h: el.offsetHeight, hitW: Math.round(parseFloat(cs.width)), hitH: Math.round(parseFloat(cs.height)) };
    });
    return {
      bar: r(bar), legend: r(legend), barOverlapsLegend: overlap(barRect, legRect),
      barButtonSizes: barBtns,
      markerCount: markers.length,
      markerSizes: [...new Set(markers.map((m) => `${m.w}x${m.h}/hit${m.hitW}x${m.hitH}`))],
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      invalidSvgPaths: [...document.querySelectorAll(".lines path, .subLines path")].filter((p) => /NaN|undefined|Infinity/.test(p.getAttribute("d") || "")).length,
      transform: document.querySelector(".map-canvas") ? document.querySelector(".map-canvas").style.transform : "",
    };
  });
}

for (const vp of VIEWPORTS) {
  for (const dark of [false, true]) {
    const tag = `${vp.w}x${vp.h}-${dark ? "dark" : "light"}`;
    test(`visual ${tag}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto("/fixture-harness.html");
      await expect(page.getByTestId("fixture-harness-root")).toBeVisible();
      await expect(page.locator(nodeSelector(`${MAP_A_ID}-root`))).toBeVisible();
      if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
      await page.waitForTimeout(300);
      const rec = {};
      // 1. toolbar only
      await page.screenshot({ path: path.join(OUT, `${tag}-1-toolbar.png`) });
      rec.toolbar = { exportTriggers: await page.locator(".mm-export-trigger").count() };
      // 2. overflow open
      await page.locator('button[aria-label="Thêm tùy chọn"]').click();
      await page.waitForTimeout(200);
      rec.overflowExportItems = await page.locator('[role="menu"] [role="menuitem"]').filter({ hasText: /Export|Xuất/ }).count();
      await page.screenshot({ path: path.join(OUT, `${tag}-2-overflow.png`) });
      await page.locator('button[aria-label="Thêm tùy chọn"]').click();
      // 3. dialog
      await page.locator('[aria-label="Xuất sơ đồ"]').first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      rec.dialogSubtitle = (await page.getByRole("dialog").innerText()).includes("Chọn phạm vi, định dạng và cách trình bày");
      await page.screenshot({ path: path.join(OUT, `${tag}-3-dialog.png`) });
      // Enter selection mode
      await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
      await page.locator(".export-inline-action").click();
      await expect(page.locator(".mm-selection-bar")).toBeVisible();
      await page.waitForTimeout(300);
      // 4. selection 0
      await page.screenshot({ path: path.join(OUT, `${tag}-4-selection-0.png`) });
      rec.selection0 = await measure(page);
      // 5. two selected
      // Real clicks on markers that are inside the viewport (at 390px the canvas may
      // start panned, so some markers sit off-screen until the user pans).
      const inView = () => page.evaluate(() => [...document.querySelectorAll("me-export-check")].map((el, i) => {
        const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        return { i, cx: Math.round(cx), cy: Math.round(cy), ok: cx > 0 && cy > 0 && cx < innerWidth && cy < innerHeight };
      }).filter((c) => c.ok));
      let vis = await inView();
      if (vis.length < 2) {
        const mb0 = await page.locator(".map-container").first().boundingBox();
        await page.mouse.move(mb0.x + mb0.width * 0.5, mb0.y + mb0.height * 0.85);
        await page.mouse.down();
        await page.mouse.move(mb0.x + mb0.width * 0.5 + 200, mb0.y + mb0.height * 0.85, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        vis = await inView();
      }
      for (const c of vis.slice(0, 2)) {
        await page.mouse.click(c.cx, c.cy);
        await page.waitForTimeout(250);
      }
      await expect(page.locator(".mm-selection-bar")).toContainText("2 nhánh đã chọn");
      await page.screenshot({ path: path.join(OUT, `${tag}-5-selection-2.png`) });
      rec.selection2 = await measure(page);
      // 6. after pan (real drag on empty background)
      const mb = await page.locator(".map-container").first().boundingBox();
      await page.mouse.move(mb.x + mb.width * 0.5, mb.y + mb.height * 0.85);
      await page.mouse.down();
      await page.mouse.move(mb.x + mb.width * 0.5 + 60, mb.y + mb.height * 0.85, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `${tag}-6-after-pan.png`) });
      rec.afterPan = await measure(page);
      // 7. cancel then reopen
      await page.getByRole("button", { name: "Hủy", exact: true }).first().click();
      await page.waitForTimeout(300);
      if (await page.getByRole("dialog").count()) await page.keyboard.press("Escape");
      rec.afterCancel = { markers: await page.locator("me-export-check").count(), bar: await page.locator(".mm-selection-bar").count() };
      await page.screenshot({ path: path.join(OUT, `${tag}-7-after-cancel.png`) });
      RESULTS[tag] = rec;
      fs.writeFileSync(path.join(OUT, "measurements.json"), JSON.stringify(RESULTS, null, 1));
    });
  }
}
