import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ARTIFACT_DIR = path.join(process.cwd(), "qa-artifacts", "mindmap-toolbar-root-collapse");
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const MAP_A = "fixture-map-a";
const MAP_B = "fixture-map-b";
const ROOT_A = `${MAP_A}-root`;

const topics = (page) => page.locator("me-tpc:visible");
const treeConnectors = (page) => page.locator(".map-canvas .lines path:visible, .map-canvas .subLines path:visible");
const transform = (page) => page.locator(".map-canvas").evaluate((el) => el.style.transform || "");

async function openFixture(page, viewport = { width: 1440, height: 1024 }) {
  await page.setViewportSize(viewport);
  await page.goto("/fixture-harness.html");
  await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" });
  await page.locator(`[data-nodeid="me${ROOT_A}"]`).waitFor({ state: "visible" });
}

// The fixture harness finishes its own initial placement a few hundred ms after
// load, so a single read can precede a canvas move. Require the root box and the
// canvas transform to stay identical for a sustained window before trusting them.
async function settledRootBox(page) {
  const locator = page.locator(`[data-nodeid="me${ROOT_A}"]`);
  const snapshot = async () => ({
    box: await locator.boundingBox(),
    canvas: await transform(page),
  });
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

async function openOverflow(page) {
  await page.getByRole("button", { name: "Thêm tùy chọn" }).click();
}

test("root-only collapse leaves one topic and zero tree connectors, then 'Mở toàn bộ' fully expands (absolute from root, not a restore of the pre-collapse snapshot) without moving the viewport", async ({ page }) => {
  await openFixture(page);
  const initialNodes = await topics(page).count();
  const initialConnectors = await treeConnectors(page).count();
  const initialTransform = await transform(page);
  const initialRootBox = await settledRootBox(page);
  expect(initialNodes).toBeGreaterThan(1);
  expect(initialConnectors).toBeGreaterThan(0);
  await openOverflow(page);
  await page.getByRole("menuitem", { name: "Chỉ chủ đề chính" }).click();
  await expect(topics(page)).toHaveCount(1);
  await expect(treeConnectors(page)).toHaveCount(0);
  expect(await transform(page)).toBe(initialTransform);
  const rootBox = await settledRootBox(page);
  expect(rootBox.x + rootBox.width).toBeGreaterThan(0);
  expect(rootBox.y + rootBox.height).toBeGreaterThan(48);
  expect(rootBox.x).toBeLessThan(1440);
  expect(rootBox.y).toBeLessThan(1024);
  expect(Math.abs((rootBox.x + rootBox.width / 2) - (initialRootBox.x + initialRootBox.width / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs((rootBox.y + rootBox.height / 2) - (initialRootBox.y + initialRootBox.height / 2))).toBeLessThanOrEqual(1);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "root-only-1440x1024-light.png") });
  await openOverflow(page);
  await page.getByRole("menuitem", { name: "Mở toàn bộ" }).click();
  // PR D contract: depth is always absolute from root, never relative to
  // whatever was collapsed before root-only -- "Mở toàn bộ" must fully
  // expand the ENTIRE tree, including the fixture's own independently
  // pre-collapsed branches (m2/m2-s0), not just restore the partially
  // collapsed snapshot that was on screen before root-only. So the node
  // count here is strictly greater than `initialNodes` (which excluded
  // those pre-collapsed branches), and node/connector counts satisfy the
  // tree invariant (nodes = connectors + 1) for a fully-connected, fully
  // expanded map -- asserted structurally rather than against a hardcoded
  // total so this test doesn't rot if the fixture's node count changes.
  const fullNodes = await topics(page).count();
  const fullConnectors = await treeConnectors(page).count();
  expect(fullNodes).toBeGreaterThan(initialNodes);
  expect(fullConnectors).toBeGreaterThan(initialConnectors);
  expect(fullNodes).toBe(fullConnectors + 1);
  // The raw transform STRING legitimately differs here (unlike the
  // root-only step above): the content layout grew back to its full size,
  // so the position-compensation math recomputes a different translate to
  // keep root visually fixed -- scale staying byte-identical is what
  // proves no scaleFit ran. The actual hard invariant is root SCREEN
  // CENTER within 1px, verified below the same way the root-only step
  // above verifies it.
  const initialScale = initialTransform.match(/scale\([^)]+\)/)?.[0];
  expect(await transform(page)).toContain(initialScale);
  const fullBox = await settledRootBox(page);
  expect(Math.abs((fullBox.x + fullBox.width / 2) - (initialRootBox.x + initialRootBox.width / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs((fullBox.y + fullBox.height / 2) - (initialRootBox.y + initialRootBox.height / 2))).toBeLessThanOrEqual(1);
});

test("library and overflow overlays preserve viewport; create exists only in the library", async ({ page }) => {
  await openFixture(page);
  const before = await transform(page);
  await page.getByRole("button", { name: "Mở thư viện sơ đồ" }).click();
  await expect(page.getByRole("listbox", { name: "Chọn sơ đồ" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Tạo sơ đồ mới/ })).toHaveCount(1);
  await page.getByRole("button", { name: "Mở thư viện sơ đồ" }).click();
  expect(await transform(page)).toBe(before);
  await openOverflow(page);
  // The overflow menu no longer repeats the export entry (the toolbar "Xuất" is the only trigger).
  for (const group of ["Hiển thị", "Cấu trúc", "Tác vụ khác"]) {
    await expect(page.getByRole("group", { name: group })).toBeVisible();
  }
  await expect(page.getByRole("group", { name: "Xuất sơ đồ" })).toHaveCount(0);
  await page.getByRole("button", { name: "Thêm tùy chọn" }).click();
  expect(await transform(page)).toBe(before);
});

test("Export Studio and selected-branch checkbox remain interactive", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const selectedBranches = dialog.locator('input[name="mm-export-scope"][value="selected_branches"]');
  await selectedBranches.check();
  await expect(selectedBranches).toBeChecked();
  await page.getByRole("button", { name: "Hủy" }).click();
});

test("normal node click still selects and map A-B-A has no stale DOM", async ({ page }) => {
  await openFixture(page);
  await page.locator(`[data-nodeid="me${MAP_A}-m0"]`).click();
  await expect(page.getByTestId("fixture-harness-root")).toHaveAttribute("data-selected-node", `${MAP_A}-m0`);
  await page.getByRole("button", { name: "Mở thư viện sơ đồ" }).click();
  await page.getByRole("option", { name: /Fixture B/ }).click();
  await expect(page.locator(`[data-nodeid="me${MAP_B}-root"]`)).toBeVisible();
  await expect(page.locator(`[data-nodeid="me${ROOT_A}"]`)).toHaveCount(0);
  await page.getByRole("button", { name: "Mở thư viện sơ đồ" }).click();
  await page.getByRole("option", { name: /Fixture A/ }).click();
  await expect(page.locator(`[data-nodeid="me${ROOT_A}"]`)).toBeVisible();
  await expect(page.locator(`[data-nodeid="me${MAP_B}-root"]`)).toHaveCount(0);
});

for (const viewport of [
  { width: 1440, height: 1024 }, { width: 1024, height: 768 },
  { width: 768, height: 1024 }, { width: 390, height: 844 },
]) {
  for (const dark of [false, true]) {
    test(`${viewport.width}x${viewport.height} ${dark ? "dark" : "light"}: one-row toolbar, no overflow, valid connectors`, async ({ page }) => {
      await openFixture(page, viewport);
      if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
      const toolbar = page.locator(".artifact-toolbar");
      await expect(toolbar).toHaveCount(1);
      expect(Math.round((await toolbar.boundingBox()).height)).toBe(48);
      const geometry = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
        badPaths: [...document.querySelectorAll(".lines path, .subLines path")]
          .filter((path) => /NaN|undefined|Infinity/.test(path.getAttribute("d") || "")).length,
      }));
      expect(geometry.doc).toBeLessThanOrEqual(1);
      expect(geometry.body).toBeLessThanOrEqual(1);
      expect(geometry.badPaths).toBe(0);
      expect(await treeConnectors(page).count()).toBeGreaterThan(0);
      await openOverflow(page);
      const box = await page.locator(".mm-toolbar-menu").boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      await page.screenshot({
        path: path.join(ARTIFACT_DIR, `${viewport.width}x${viewport.height}-${dark ? "dark" : "light"}-overflow.png`),
      });
    });
  }
}
