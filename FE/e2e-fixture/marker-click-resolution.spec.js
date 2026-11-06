// Real mouse clicks on every visible branch dot (fixture data only). At low zoom a neighbour's
// 40px host covers some dots; a click on such a dot must still toggle that dot's own branch.
// Each viewport is clicked at the start position and after two pans, so every dot is reached.
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

// Drag the canvas horizontally from an empty point (not the bar, legend, nodes or markers).
async function pan(page, dx, dy = 0) {
  const mb = await page.locator(".map-container").first().boundingBox();
  const point = await page.evaluate(({ left, top, w, h }) => {
    // A dense/narrow map can occupy the exact horizontal centre. Search a
    // bounded grid so the pan still starts on real canvas background in the
    // Linux full-suite viewport as well as on local Chromium.
    for (const xf of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      for (const yf of [0.3, 0.4, 0.5, 0.6, 0.2, 0.7]) {
        const x = left + w * xf;
        const y = top + h * yf;
        const e = document.elementFromPoint(x, y);
        if (e && !e.closest(".mm-selection-bar, .mm-legend, me-tpc, me-export-check, me-epd, me-wrapper, me-parent, button, a, input")) return { x, y };
      }
    }
    return null;
  }, { left: mb.x, top: mb.y, w: mb.width, h: mb.height });
  expect(point).not.toBeNull();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function visibleDots(page) {
  return page.evaluate(() => [...document.querySelectorAll("me-export-check")].map((el, i) => {
    const d = el.querySelector(".mm-export-check__dot").getBoundingClientRect();
    const cx = d.left + d.width / 2, cy = d.top + d.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const own = !!top && (top === el.querySelector(".mm-export-check__dot") || el.contains(top));
    const topAt = top ? top.tagName.toLowerCase() + "." + String(top.className && top.className.baseVal === undefined ? top.className : "").split(" ").join(".") : "none";
    const inside = d.left >= 0 && d.top >= 0 && d.right <= innerWidth && d.bottom <= innerHeight;
    // A dot under app chrome (header, floating controls) is not a map target: its hit point belongs to the chrome.
    const onMap = !!top && !!top.closest(".map-container");
    return { i, x: cx, y: cy, inside, onMap, coveredByNeighbour: !own, nodeId: el.dataset.nodeId, topAt, label: el.getAttribute("aria-label") };
  }).filter((t) => t.inside && t.onMap));
}

async function visibleTargetDot(page, nodeId) {
  return page.evaluate((targetId) => {
    const all = [...document.querySelectorAll("me-export-check")];
    const el = all.find((candidate) => candidate.dataset.nodeId === targetId);
    const dot = el?.querySelector(".mm-export-check__dot");
    const rect = dot?.getBoundingClientRect();
    if (!el || !rect) return null;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const top = document.elementFromPoint(x, y);
    const inside = rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
    if (!inside || !top?.closest(".map-container")) return null;
    return { i: all.indexOf(el), x, y, nodeId: targetId, topAt: top.tagName.toLowerCase() };
  }, nodeId);
}

test("a semantic-relation path cannot swallow a marker click after real toolbar zoom-out", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/fixture-harness.html");
  await expect(page.getByTestId("fixture-harness-root")).toBeVisible();
  await openSelection(page);
  await page.waitForTimeout(400);

  const zoomOut = page.getByRole("button", { name: "Thu nhỏ", exact: true });
  // Main opens phones at 0.75. Two real toolbar steps reach 0.35, where the
  // fixture's wide semantic-relation hit stroke crosses this marker centre.
  await zoomOut.click();
  await zoomOut.click();
  await page.waitForTimeout(250);

  let target = null;
  const pans = [[0, 0], [-250, 0], [-250, 0], [-250, 0], [-250, 0], [0, -200], [250, 0], [250, 0], [250, 0], [250, 0], [0, -200], [-250, 0], [-250, 0], [0, 200], [0, 200]];
  for (const [dx, dy] of pans) {
    if (dx || dy) await pan(page, dx, dy);
    target = await visibleTargetDot(page, "fixture-map-a-m0-s0");
    if (target) break;
  }
  expect(target, "covered fixture marker must be brought into the visible canvas").not.toBeNull();

  const before = await states(page);
  const beforeTransform = await transform(page);
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(120);
  const after = await states(page);
  const changed = after.map((value, i) => value !== before[i] ? i : -1).filter((i) => i >= 0);
  expect(changed, `covered marker ${target.nodeId} must own the click`).toEqual([target.i]);
  expect(await transform(page), "marker click must not move the canvas").toBe(beforeTransform);
});

for (const [w, h] of [[1440, 1024], [1024, 768], [390, 844]]) {
  test(`real click on each visible dot toggles only that branch at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/fixture-harness.html");
    await expect(page.getByTestId("fixture-harness-root")).toBeVisible();
    await openSelection(page);
    await page.waitForTimeout(400);

    const t0 = await transform(page);
    const clicked = new Set();
    const failures = [];
    let coveredTotal = 0;
    let dotsTotal = 0;
    const pans = [[0, 0], [-250, 0], [-250, 0], [-250, 0], [-250, 0], [0, -200], [250, 0], [250, 0], [250, 0], [250, 0], [0, -200], [0, -200], [-250, 0], [-250, 0], [0, 200], [0, 200], [0, 200], [250, 0]];
    for (let round = 0; round < pans.length; round++) {
      if (pans[round][0] || pans[round][1]) await pan(page, pans[round][0], pans[round][1]);
      const targets = await visibleDots(page);
      const roundTransform = await transform(page);
      for (const t of targets) {
        if (clicked.has(t.nodeId)) continue;
        clicked.add(t.nodeId);
        dotsTotal++;
        if (t.coveredByNeighbour) coveredTotal++;
        const before = await states(page);
        await page.mouse.click(t.x, t.y);
        await page.waitForTimeout(120);
        const after = await states(page);
        const changed = after.map((v, i) => (v !== before[i] ? i : -1)).filter((i) => i >= 0);
        if (changed.length !== 1 || changed[0] !== t.i) failures.push({ nodeId: t.nodeId, label: t.label, changed, coveredByNeighbour: t.coveredByNeighbour, topAt: t.topAt, at: [Math.round(t.x), Math.round(t.y)] });
        // Counter must match the number of ticked markers.
        const counterText = (await page.locator(".mm-selection-bar > span").first().textContent()).trim();
        const expectedCount = after.filter((v) => v === "true").length;
        const shown = counterText.startsWith("Chọn") ? 0 : parseInt(counterText, 10);
        if (shown !== expectedCount) failures.push({ nodeId: t.nodeId, label: t.label, counter: counterText, checked: expectedCount });
        // Untick so each dot starts unchecked in the next round too.
        await page.mouse.click(t.x, t.y);
        await page.waitForTimeout(120);
      }
      // Ticks must not move the canvas: compare against the transform read before this round's clicks.
      if ((await transform(page)) !== roundTransform) failures.push({ round, tickMovedTransform: true });
    }

    const hiddenByChrome = await page.evaluate(() => [...document.querySelectorAll("me-export-check")].filter((el) => { const d = el.querySelector(".mm-export-check__dot").getBoundingClientRect(); const top = document.elementFromPoint(d.left + d.width / 2, d.top + d.height / 2); return !!top && !top.closest(".map-container") && d.left >= 0 && d.top >= 0 && d.right <= innerWidth && d.bottom <= innerHeight; }).length);
    const summary = { viewport: `${w}x${h}`, dotsHiddenByChromeAtEnd: hiddenByChrome, dotsClicked: dotsTotal, markersTotal: await page.locator("me-export-check").count(), markersTicked: clicked.size, coveredByNeighbour: coveredTotal, failures: failures.length, transformChangedByPans: (await transform(page)) !== t0 };
    const file = path.join(OUT, "click-resolution.json");
    const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    prev[`${w}x${h}`] = summary;
    fs.writeFileSync(file, JSON.stringify(prev, null, 1));

    expect(dotsTotal).toBeGreaterThan(0);
    expect(failures).toEqual([]);
    // Pans move the canvas on purpose; the click-driven tick rounds themselves must not.
    await expect(page.locator(".mm-selection-bar")).toContainText("Chọn các node muốn xuất");
  });
}
