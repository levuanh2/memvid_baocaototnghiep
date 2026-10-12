// Follow-up to PR D (#65) — real-browser counterpart of
// MindElixirView.depthPresetIndicatorIntent.test.jsx. Live production smoke
// on a real 3-level-deep map found: clicking "Hiện 3 tầng nhánh" left "Mở
// toàn bộ" marked aria-pressed=true instead, because the indicator was
// re-derived from the tree's SHAPE rather than the explicit click -- and on
// a map whose real depth tops out at 3, "show depth<=3" and "show
// everything" produce an IDENTICAL visible-node set. jsdom can't compute
// real geometry (root-center, scale, remount identity), so those invariants
// are only checked here, against the backend-free fixture harness -- never
// a production API, same as every other spec in this directory.
//
// Fixture: ?map=shallow3 loads FIXTURE_SHALLOW3 (src/dev/mindmapFixtures.js),
// the real-browser counterpart of the Vitest file's shallowData3.
import { test, expect } from "@playwright/test";

const MAP_ID = "fixture-shallow3";
const ROOT = `${MAP_ID}-root`;
const nodeSelector = (id) => `[data-nodeid="me${id}"]`;
const transformOf = (page) => page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
const depthGroupItems = (page) => page.locator('[role="group"][aria-label="Cấu trúc"] [role="menuitem"]');

async function openFixture(page, viewport = { width: 1440, height: 1024 }) {
  await page.setViewportSize(viewport);
  await page.goto("/fixture-harness.html?map=shallow3");
  await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" });
  await page.locator(nodeSelector(ROOT)).waitFor({ state: "visible" });
}

async function openOverflow(page) {
  await page.getByRole("button", { name: "Thêm tùy chọn" }).click();
}

async function applyLevel(page, label) {
  await openOverflow(page);
  await page.getByRole("menuitem", { name: label }).click();
}

async function pressedLabels(page) {
  await openOverflow(page);
  const items = depthGroupItems(page);
  const count = await items.count();
  const pressed = [];
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    if ((await item.getAttribute("aria-pressed")) === "true") pressed.push((await item.textContent()).trim());
  }
  await page.keyboard.press("Escape");
  return pressed;
}

function badPathCount(page) {
  return page.evaluate(() => [...document.querySelectorAll(".lines path, .subLines path")]
    .filter((p) => { const d = p.getAttribute("d") || ""; return !d || /NaN|undefined|Infinity/.test(d); }).length);
}

async function settledRootBox(page) {
  const locator = page.locator(nodeSelector(ROOT));
  const snapshot = async () => ({ box: await locator.boundingBox(), canvas: await transformOf(page) });
  let last = await snapshot();
  let quiet = 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    await page.waitForTimeout(100);
    const next = await snapshot();
    const same = next.box && last.box
      && Math.abs(next.box.x - last.box.x) < 0.25 && Math.abs(next.box.y - last.box.y) < 0.25
      && Math.abs(next.box.width - last.box.width) < 0.25 && Math.abs(next.box.height - last.box.height) < 0.25
      && next.canvas === last.canvas;
    quiet = same ? quiet + 1 : 0;
    last = next;
    if (quiet >= 5) return next.box;
  }
  throw new Error("root box did not settle");
}
function centerOf(box) { return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }

for (const dark of [false, true]) {
  test(`${dark ? "dark" : "light"}: depth3==all shape — clicking 'Hiện 3 tầng nhánh' marks only that item pressed`, async ({ page }) => {
    await openFixture(page);
    if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));

    await page.evaluate(() => { window.__qaCanvasRef = document.querySelector(".map-canvas"); });
    const initialBox = await settledRootBox(page);
    const initialTransform = await transformOf(page);
    const initialScale = initialTransform.match(/scale\([^)]+\)/)?.[0];
    const initialCenter = centerOf(initialBox);

    await applyLevel(page, "Hiện 3 tầng nhánh");
    expect(await pressedLabels(page)).toEqual(["Hiện 3 tầng nhánh"]);

    const sameInstance = await page.evaluate(() => document.querySelector(".map-canvas") === window.__qaCanvasRef);
    expect(sameInstance).toBe(true);
    expect(await transformOf(page)).toContain(initialScale);
    const center = centerOf(await settledRootBox(page));
    expect(Math.abs(center.x - initialCenter.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(center.y - initialCenter.y)).toBeLessThanOrEqual(1);
    expect(await badPathCount(page)).toBe(0);

    await applyLevel(page, "Mở toàn bộ");
    expect(await pressedLabels(page)).toEqual(["Mở toàn bộ"]);
  });
}

test("Enter and Space activate a depth-preset menuitem the same way a click does", async ({ page }) => {
  await openFixture(page);
  await openOverflow(page);
  await page.keyboard.press("Tab");
  // Walk forward until focus lands inside the "Cấu trúc" group (first items
  // belong to the "Hiển thị" group above it).
  for (let i = 0; i < 10; i++) {
    const inGroup = await page.evaluate(() => {
      const el = document.activeElement;
      return !!el.closest('[role="group"][aria-label="Cấu trúc"]');
    });
    if (inGroup) break;
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
  expect(await pressedLabels(page)).toEqual(["Chỉ chủ đề chính"]);

  await openOverflow(page);
  await page.keyboard.press("Tab");
  for (let i = 0; i < 10; i++) {
    const inGroup = await page.evaluate(() => {
      const el = document.activeElement;
      return !!el.closest('[role="group"][aria-label="Cấu trúc"]');
    });
    if (inGroup) break;
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Tab"); // move to the 2nd item in the group
  await page.keyboard.press("Space");
  expect(await pressedLabels(page)).toEqual(["Hiện 1 tầng nhánh"]);
});

test("switching to a deep map and back does not leak the shallow map's explicit preset", async ({ page }) => {
  await openFixture(page);
  await applyLevel(page, "Hiện 3 tầng nhánh");
  expect(await pressedLabels(page)).toEqual(["Hiện 3 tầng nhánh"]);

  await page.getByRole("button", { name: "Mở thư viện sơ đồ" }).click();
  await page.getByText("Bản đồ kiểm thử mức thu/mở (Fixture Depth)").click();
  await page.locator('[data-nodeid="mefixture-depth-root"]').waitFor({ state: "visible" });

  await page.getByRole("button", { name: "Mở thư viện sơ đồ" }).click();
  await page.getByText("Bản đồ kiểm thử preset indicator (Fixture Shallow3)").click();
  await page.locator(nodeSelector(ROOT)).waitFor({ state: "visible" });
  // Fresh load of this map id again -- no stale "Hiện 3 tầng nhánh" choice.
  const pressed = await pressedLabels(page);
  expect(pressed).not.toEqual(["Hiện 3 tầng nhánh"]);
});
