import { test, expect } from "@playwright/test";

// Screenshots go to this test's own output dir (test-results/), never into the repo.
const shot = (page, name) => page.screenshot({ path: test.info().outputPath(name) });

const MAP_A_ID = "fixture-map-a";
const nodeSelector = (id) => `[data-nodeid="me${id}"]`;
const markerSelector = (id) => `me-export-check[data-node-id="${id}"]`;

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
});

// Drag the canvas background with a real one-finger touch gesture (CDP touch
// events), on an empty background point: a deliberate pan that comes to rest
// before the finger lifts. A fast flick instead leaves Chromium's touch
// emulation holding a fling, and the next tap only cancels it (no click is
// synthesised) -- R84-TOUCH-01, NOT VERIFIED on a real device, see
// docs/ui-ux-v4-design/round8-4-qa-evidence/focus-and-touch-regressions.md.
async function panCanvas(page, dx, dy = 0) {
  const mb = await page.locator(".map-container").first().boundingBox();
  const y = await page.evaluate(({ x, top, h }) => {
    for (const f of [0.4, 0.5, 0.6, 0.3, 0.7]) {
      const e = document.elementFromPoint(x, top + h * f);
      if (
        e &&
        !e.closest(
          ".mm-selection-bar, .mm-legend, me-tpc, me-export-check, me-epd, me-wrapper, me-parent, button, a, input, .mm-floating-toolbar"
        )
      ) {
        return top + h * f;
      }
    }
    return null;
  }, { x: mb.x + mb.width * 0.5, top: mb.y, h: mb.height });
  expect(y).not.toBeNull();

  const x0 = Math.round(mb.x + mb.width * 0.5), y0 = Math.round(y), steps = 10;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: Math.round(x0 + (dx * i) / steps), y: Math.round(y0 + (dy * i) / steps) }],
    });
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(400);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(250);
}

// Check hit at marker center to confirm no toolbar or chrome occlusion
async function checkMarkerUnoccluded(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false, hitsMarker: false, topElement: null };
    const dot = el.querySelector(".mm-export-check__dot") || el;
    const r = dot.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    const hitsMarker = !!topEl && (topEl === el || el.contains(topEl));
    const topDesc = topEl ? `${topEl.tagName.toLowerCase()}.${topEl.className}` : "null";
    const insideViewport = r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
    return { found: true, hitsMarker, insideViewport, cx, cy, topDesc };
  }, selector);
}

test("real touch selection on mobile 390px MindMap", async ({ page }) => {
  // 1. Verify touch environment capabilities
  const touchCaps = await page.evaluate(() => ({
    maxTouchPoints: navigator.maxTouchPoints,
    pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
  }));
  console.log(`[TOUCH-CAPS] maxTouchPoints=${touchCaps.maxTouchPoints}, pointerCoarse=${touchCaps.pointerCoarse}`);
  expect(touchCaps.maxTouchPoints).toBeGreaterThan(0);
  expect(touchCaps.pointerCoarse).toBe(true);

  // 2. Open the real map fixture
  await page.goto("/fixture-harness.html");
  await expect(page.getByTestId("fixture-harness-root")).toBeVisible();
  await expect(page.locator(nodeSelector(`${MAP_A_ID}-root`))).toBeVisible();

  const initialScrollY = await page.evaluate(() => window.scrollY);
  expect(initialScrollY).toBe(0);

  // 3. Enter branch selection mode the same way branch-export-visual does
  await page.locator('[aria-label="Xuất sơ đồ"]').first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
  await page.locator(".export-inline-action").click();
  await expect(page.locator(".mm-selection-bar")).toBeVisible();
  await shot(page, "01-selection-mode.png");

  // 4. Pan canvas using touch-realistic drag on empty background to bring target branches into unoccluded view
  // Target branches: fixture-map-a-m0-s0-l0 and fixture-map-a-m0-s0-l1
  const t0 = await page.evaluate(() => document.querySelector(".map-canvas").style.transform);
  await panCanvas(page, 550, 100);
  const t1 = await page.evaluate(() => document.querySelector(".map-canvas").style.transform);
  expect(t1).not.toBe(t0);
  await shot(page, "02-after-pan.png");

  const targetId1 = `${MAP_A_ID}-m0-s0-l0`;
  const targetId2 = `${MAP_A_ID}-m0-s0-l1`;
  const marker1 = page.locator(markerSelector(targetId1));
  const marker2 = page.locator(markerSelector(targetId2));

  // 5. Assert no toolbar occlusion of target markers (elementFromPoint at center hits the marker)
  const occ1 = await checkMarkerUnoccluded(page, markerSelector(targetId1));
  expect(occ1.found).toBe(true);
  expect(occ1.insideViewport).toBe(true);
  expect(occ1.hitsMarker).toBe(true);

  const occ2 = await checkMarkerUnoccluded(page, markerSelector(targetId2));
  expect(occ2.found).toBe(true);
  expect(occ2.insideViewport).toBe(true);
  expect(occ2.hitsMarker).toBe(true);

  // 6. Select branch 1 with locator.tap() on its me-export-check
  await marker1.tap();
  await expect(marker1).toHaveAttribute("aria-checked", "true");
  await expect(marker2).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".mm-selection-bar")).toContainText("1 node đã tick");
  await shot(page, "03-first-branch-tapped.png");

  // 7. Select a second branch with tap()
  await marker2.tap();
  await expect(marker2).toHaveAttribute("aria-checked", "true");
  await shot(page, "04-two-branches-tapped.png");

  // 8. Assert exact selected node IDs (data-node-id of checked markers)
  const checkedNodeIds = await page.evaluate(() =>
    [...document.querySelectorAll('me-export-check[aria-checked="true"]')]
      .map((el) => el.dataset.nodeId)
      .sort()
  );
  expect(checkedNodeIds).toEqual([targetId1, targetId2].sort());

  // Assert selection bar count text
  await expect(page.locator(".mm-selection-bar")).toContainText("2 node đã tick");

  // 9. Document layout invariants: no horizontal scroll, window.scrollY stable, selection bar in viewport
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(horizontalOverflow).toBe(false);

  const finalScrollY = await page.evaluate(() => window.scrollY);
  expect(finalScrollY).toBe(initialScrollY);

  const barBox = await page.locator(".mm-selection-bar").boundingBox();
  expect(barBox).not.toBeNull();
  expect(barBox.x).toBeGreaterThanOrEqual(0);
  expect(barBox.y).toBeGreaterThanOrEqual(0);
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(390);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(844);

  // 10. Open/confirm Export Studio and assert selected-node membership
  // Using the same membership assertions style as post-pr77-exact-selection.spec.js / exact-node-export-v3.spec.js
  await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();

  await expect(dialog.locator('input[name="mm-export-scope"]:checked')).toHaveValue("selected_branches");
  await expect(dialog).toContainText("2 node đã tick");
  await expect(dialog).toContainText("2 node đã chọn · 1 node cha tự thêm · 3 node được xuất");
  await expect(dialog.locator(".export-footer__summary")).toContainText("2 node đã chọn · 1 node cha tự thêm · 3 node được xuất");
  await expect(dialog.locator('[aria-label="Tóm tắt cấu hình xuất"]')).toContainText("3 node");
  await expect(dialog.locator(".export-preview__stats")).toContainText("3 node");

  // Assert export dialog controls are inside the viewport
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(390);

  const footerBox = await dialog.locator(".export-footer").boundingBox();
  expect(footerBox).not.toBeNull();
  expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(844);

  await shot(page, "05-export-dialog-confirmed.png");
});
