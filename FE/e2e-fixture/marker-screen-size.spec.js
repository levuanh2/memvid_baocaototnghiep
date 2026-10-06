// Screen-space audit of the branch marker (fixture, fake data). Measures real on-screen boxes
// with getBoundingClientRect, hit-tests the centre and four edge points with elementFromPoint,
// and records the canvas zoom from its computed transform. Not an offsetWidth-based check.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "qa-artifacts", "marker-screen-size");
fs.mkdirSync(OUT, { recursive: true });
const RESULTS = {};
const VIEWPORTS = [{ w: 1440, h: 1024 }, { w: 1024, h: 768 }, { w: 390, h: 844 }];

function zoomOf(transform) {
  const m = /scale\(([-0-9.]+)\)/.exec(transform || "");
  return m ? parseFloat(m[1]) : 1;
}

test.describe("Branch marker screen-space size", () => {
  for (const vp of VIEWPORTS) {
    for (const dark of [false, true]) {
      const tag = `${vp.w}x${vp.h}-${dark ? "dark" : "light"}`;
      test(`measure ${tag}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.w, height: vp.h });
        await page.goto("/fixture-harness.html");
        await expect(page.getByTestId("fixture-harness-root")).toBeVisible();
        if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
        await page.locator('[aria-label="Xuất sơ đồ"]').first().click();
        await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
        await page.locator(".export-inline-action").click();
        await expect(page.locator(".mm-selection-bar")).toBeVisible();
        await page.waitForTimeout(400);
        const data = await page.evaluate(() => {
          const canvas = document.querySelector(".map-canvas");
          const tf = canvas ? canvas.style.transform : "";
          const markers = [...document.querySelectorAll("me-export-check")];
          const rows = markers.map((el) => {
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            const hit = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === el || el.contains(e)); };
            // Only markers whose whole hitbox sits inside the viewport are probed; the rest are panned away.
            const inside = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
            const probe = inside
              ? { inside: true, c: hit(cx, cy), n: hit(cx, cy - r.height / 2 + 1), s: hit(cx, cy + r.height / 2 - 1), w: hit(cx - r.width / 2 + 1, cy), e: hit(cx + r.width / 2 - 1, cy),
                  coveredBy: hit(cx, cy) ? null : (() => { const t = document.elementFromPoint(cx, cy); if (!t) return "none"; const cs = getComputedStyle(t); const p = t.closest("me-parent"); const pcs = p ? getComputedStyle(p) : null; return `${t.tagName.toLowerCase()} z=${cs.zIndex} pos=${cs.position} parentZ=${pcs ? pcs.zIndex + "/" + pcs.position + "/" + pcs.transform : "-"}`; })() }
              : { inside: false, c: null, n: null, s: null, w: null, e: null };
            const dot = el.querySelector(".mm-export-check__dot");
            const dr = dot ? dot.getBoundingClientRect() : null;
            // The visible dot must receive its own centre click, even where a neighbour's host overlaps it.
            const dotCentreOwn = dr ? (() => { const e = document.elementFromPoint(dr.left + dr.width / 2, dr.top + dr.height / 2); return !!e && (e === dot || dot.contains(e)); })() : false;
            return { side: el.dataset.side, screenW: Math.round(r.width * 10) / 10, screenH: Math.round(r.height * 10) / 10,
              dotW: dr ? Math.round(dr.width * 10) / 10 : null, dotH: dr ? Math.round(dr.height * 10) / 10 : null, dotCentreOwn, probe };
          });
          // Smallest centre-to-centre distance between two markers on the same side (screen px).
          // A 40px hitbox overlaps its neighbour when this gap is below 40.
          const centres = markers.map((el) => { const r = el.getBoundingClientRect(); return { side: el.dataset.side, x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
          let minGap = Infinity;
          for (let i = 0; i < centres.length; i++) for (let j = i + 1; j < centres.length; j++) {
            if (centres[i].side !== centres[j].side) continue;
            const d = Math.hypot(centres[i].x - centres[j].x, centres[i].y - centres[j].y);
            if (d < minGap) minGap = d;
          }
          return { transform: tf, markers: rows, minSameSideGapPx: minGap === Infinity ? null : Math.round(minGap * 10) / 10 };
        });
        const zoom = zoomOf(data.transform);
        const widths = [...new Set(data.markers.map((m) => m.screenW))];
        RESULTS[tag] = {
          zoom,
          canvasTransform: data.transform.slice(0, 80),
          markerCount: data.markers.length,
          hostScreenPx: [...new Set(data.markers.map((m) => `${m.screenW}x${m.screenH}`))],
          dotScreenPx: [...new Set(data.markers.map((m) => `${m.dotW}x${m.dotH}`))],
          screenWidthsPx: widths,
          minSameSideGapPx: data.minSameSideGapPx,
          markersInViewport: data.markers.filter((m) => m.probe.inside).length,
          coveredInViewport: data.markers.filter((m) => m.probe.inside && !m.probe.c).map((m) => ({ side: m.side, by: m.probe.coveredBy })),
          hitCentreOkInViewport: data.markers.filter((m) => m.probe.inside && m.probe.c).length,
          dotCentreOwnInViewport: data.markers.filter((m) => m.probe.inside && m.dotCentreOwn).length,
          edgeProbesOkInViewport: data.markers.filter((m) => m.probe.inside && m.probe.n && m.probe.s && m.probe.w && m.probe.e).length,
          sample: data.markers.slice(0, 2),
        };
        await page.screenshot({ path: path.join(OUT, `${tag}-selection.png`) });
        fs.writeFileSync(path.join(OUT, "measurements.json"), JSON.stringify(RESULTS, null, 1));
        expect(data.markers.length).toBeGreaterThan(0);
      });
    }
  }
});
