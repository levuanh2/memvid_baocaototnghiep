// PR D — Mind Map 5-level expand UX, Phase 4 real-browser QA. Runs against
// the backend-free fixture harness (playwright.fixture.config.js), never a
// production API — matches every other spec in this directory.
//
// Fixture: ?map=depth loads FIXTURE_DEPTH (src/dev/mindmapFixtures.js), the
// SAME unbalanced 5-depth shape MindElixirView.depthLevels.test.jsx already
// proved in jsdom (root->a->b->c->d, root->f, root->g->h) -- so the exact
// topic/connector counts per level (1/0, 4/3, 6/5, 7/6, 8/7) are not
// re-derived here, only confirmed to survive unchanged in a real browser
// with real layout (jsdom reports zero-size rects, so transform/root-center
// invariants can only be checked here).
//
// This harness has no "node detail" panel and no Chat/Guided-mode surface
// of its own (FixtureHarnessApp.jsx renders MindElixirView directly) -- the
// `data-selected-node` attribute on [data-testid="fixture-harness-root"] is
// the harness's own proxy for "a node is selected / a detail panel would be
// showing it", the same proxy mindmap-toolbar-root-collapse.spec.js already
// uses. Chat<->MindMap and Guided-state interactions are covered instead by
// the Vitest-level selection-lifecycle suites
// (useMindMapController.selectionLifecycle.test.jsx,
// MindElixirView.selectionInstance.test.jsx) -- not re-asserted here.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ARTIFACT_DIR = path.join(process.cwd(), "qa-artifacts", "mindmap-depth-presets");
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const MAP_ID = "fixture-depth";
const MAP_A_ID = "fixture-map-a";
const ROOT = `${MAP_ID}-root`;

const PRESETS = [
  ["Chỉ chủ đề chính", 1, 0],
  ["Hiện 1 tầng nhánh", 4, 3],
  ["Hiện 2 tầng nhánh", 6, 5],
  ["Hiện 3 tầng nhánh", 7, 6],
  ["Mở toàn bộ", 8, 7],
];

const nodeSelector = (id) => `[data-nodeid="me${id}"]`;
const topics = (page) => page.locator("me-tpc:visible");
// No `:visible` filter here, unlike `topics`: a perfectly axis-aligned
// connector (this fixture's deterministic layout produces at least one --
// e.g. a straight horizontal b->c curve) has a zero-height bounding box,
// which Playwright's `:visible` pseudo-class (bounding-box-based) excludes
// even though the path genuinely renders. Safe to drop here because a
// collapsed branch's connector is actually REMOVED from the DOM (verified
// empirically: root-only gives a raw count of 0, not just CSS-hidden
// paths) -- same raw-DOM-count approach mindmap-toolbar-root-collapse.spec.js's
// `badPathCount`-style checks already use for path validity.
const connectors = (page) => page.locator(".map-canvas .lines path, .map-canvas .subLines path");
const transformOf = (page) => page.locator(".map-canvas").evaluate((el) => el.style.transform || "");
const depthMenuItems = (page) => page.locator('[role="group"][aria-label="Cấu trúc"] [role="menuitem"]');

async function openFixture(page, viewport = { width: 1440, height: 1024 }, mapId = MAP_ID) {
  await page.setViewportSize(viewport);
  await page.goto(`/fixture-harness.html?map=${mapId === MAP_ID ? "depth" : mapId}`);
  await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" });
  await page.locator(nodeSelector(mapId === MAP_ID ? ROOT : `${mapId}-root`)).waitFor({ state: "visible" });
}

async function openOverflow(page) {
  await page.getByRole("button", { name: "Thêm tùy chọn" }).click();
}

async function applyLevel(page, label) {
  await openOverflow(page);
  await page.getByRole("menuitem", { name: label }).click();
}

// The "Số node/nhánh" summary line lives on the Export Studio's REVIEW step
// (step 3 of content -> format -> appearance -> review), not the content
// step where the scope radios live -- advancing needs 3 "Tiếp tục" clicks.
async function goToReviewStep(dialog) {
  for (let i = 0; i < 3; i++) {
    await dialog.getByRole("button", { name: "Tiếp tục" }).click();
  }
}

function badPathCount(page) {
  return page.evaluate(() => [...document.querySelectorAll(".lines path, .subLines path")]
    .filter((p) => { const d = p.getAttribute("d") || ""; return !d || /NaN|undefined|Infinity/.test(d); }).length);
}

// Same settle-then-measure pattern as mindmap-toolbar-root-collapse.spec.js's
// settledRootBox: the harness finishes its own initial placement a few
// hundred ms after load/preset-apply, so a single read can race it.
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

const VIEWPORTS = [
  { width: 1440, height: 1024 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

for (const viewport of VIEWPORTS) {
  for (const dark of [false, true]) {
    const tag = `${viewport.width}x${viewport.height}-${dark ? "dark" : "light"}`;

    test(`${tag}: all 5 depth presets -- exact DOM counts, same instance, scale/root-center held, no bad paths`, async ({ page }) => {
      await openFixture(page, viewport);
      if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));

      // Instance identity: tag the real canvas DOM node once; any remount
      // would replace it with a different object, failing this `===` later.
      await page.evaluate(() => { window.__qaCanvasRef = document.querySelector(".map-canvas"); });
      // settledRootBox waits for the harness's own async initial-placement
      // pass to go quiet; reading `transformOf` separately and BEFORE that
      // settle would race it (same hazard settledRootBox's own docstring
      // warns about) and falsely report a transform "change" that is
      // really just the page's own first-paint settle, not a preset effect.
      const initialBox = await settledRootBox(page);
      const initialTransform = await transformOf(page);
      const initialScale = initialTransform.match(/scale\([^)]+\)/)?.[0];
      const initialRootCenter = centerOf(initialBox);
      const initialRootTagCount = await page.locator("me-root").count();
      expect(initialRootTagCount).toBe(1);

      for (const [label, nodeCount, connCount] of PRESETS) {
        await applyLevel(page, label);
        await expect(topics(page)).toHaveCount(nodeCount);
        await expect(connectors(page)).toHaveCount(connCount);

        const sameInstance = await page.evaluate(() => document.querySelector(".map-canvas") === window.__qaCanvasRef);
        expect(sameInstance).toBe(true);
        expect(await page.locator("me-root").count()).toBe(1);

        // The raw translate3d() legitimately shifts across presets --
        // the layout's content size changes, so the position-compensation
        // math recomputes a different pan offset to keep root visually
        // fixed (verified empirically: root screen-center delta is 0-0.55px
        // across every preset on this fixture). `scale` staying
        // byte-identical is the real signal no scaleFit ever ran; root
        // screen-center within 1px is the real signal no toCenter ever ran.
        expect(await transformOf(page)).toContain(initialScale);
        const rootBox = await settledRootBox(page);
        const center = centerOf(rootBox);
        expect(Math.abs(center.x - initialRootCenter.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(center.y - initialRootCenter.y)).toBeLessThanOrEqual(1);

        expect(await badPathCount(page)).toBe(0);
        // No dangling connector: every visible connector path has both a
        // non-empty "d" (checked above) and the exact count the tree
        // predicts (checked above) -- a stray leftover edge would show up
        // as a count mismatch, already asserted.

        const geometry = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.body.clientWidth,
        }));
        expect(geometry.doc).toBeLessThanOrEqual(1);
        expect(geometry.body).toBeLessThanOrEqual(1);

        await page.keyboard.press("Escape").catch(() => {});
      }

      // Background pan still works after 5 depth changes on this instance.
      // Drag from the VIEWPORT's own center, not a percentage of the
      // ".map-canvas" element's bounding box -- after "Mở toàn bộ" that box
      // is wider than a mobile viewport and can start at a negative x
      // (off-screen), which `elementFromPoint`/mouse events can't target.
      const beforePan = await transformOf(page);
      const vx = viewport.width / 2;
      const vy = viewport.height / 2;
      await page.mouse.move(vx, vy);
      await page.mouse.down();
      await page.mouse.move(vx + 40, vy + 30, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      expect(await transformOf(page)).not.toBe(beforePan);

      await page.screenshot({ path: path.join(ARTIFACT_DIR, `${tag}-full-after-pan.png`) });
    });
  }
}

test.describe("Manual interaction -> custom state, keyboard, mobile hit targets", () => {
  test("manual caret toggle after a preset drops every aria-pressed; re-applying the preset restores the deterministic set", async ({ page }) => {
    await openFixture(page);
    await applyLevel(page, "Hiện 1 tầng nhánh");
    await expect(topics(page)).toHaveCount(4);
    // applyLevel's click closes the overflow menu (its own onClick calls
    // setContextOverflowOpen(false)) -- menuitem buttons unmount with it,
    // so aria-pressed must be checked after reopening, not on the stale
    // (now-detached) element from before the click.
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: "Hiện 1 tầng nhánh" })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape").catch(() => {});

    // Manually collapse "a" (depth 1, visible, currently expanded) via its
    // own caret -- "g" (the other depth-1 branch) stays expanded, breaking
    // the depth=1 preset's exact node set without reconstructing a
    // different preset's set by accident (same reasoning as the Vitest
    // MindElixirView.depthLevels.test.jsx "drops the selected indicator" test).
    const tpcA = page.locator(nodeSelector(`${MAP_ID}-a`));
    await tpcA.locator("xpath=..").locator("me-epd").click();

    await openOverflow(page);
    for (const [label] of PRESETS) {
      await expect(page.getByRole("menuitem", { name: label })).toHaveAttribute("aria-pressed", "false");
    }
    await page.keyboard.press("Escape").catch(() => {});

    await applyLevel(page, "Hiện 1 tầng nhánh");
    await expect(topics(page)).toHaveCount(4);
    await expect(connectors(page)).toHaveCount(3);
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: "Hiện 1 tầng nhánh" })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape").catch(() => {});
  });

  test("Enter and Space both activate a depth menuitem", async ({ page }) => {
    await openFixture(page);
    await openOverflow(page);
    await page.getByRole("menuitem", { name: "Hiện 2 tầng nhánh" }).focus();
    await page.keyboard.press("Enter");
    await expect(topics(page)).toHaveCount(6);

    await openOverflow(page);
    await page.getByRole("menuitem", { name: "Hiện 3 tầng nhánh" }).focus();
    await page.keyboard.press(" ");
    await expect(topics(page)).toHaveCount(7);
  });

  test("390x844: every depth menuitem has a >=40x40 hit target and the menu never overflows or clips", async ({ page }) => {
    await openFixture(page, { width: 390, height: 844 });
    await openOverflow(page);
    const items = depthMenuItems(page);
    const count = await items.count();
    expect(count).toBe(5);
    for (let i = 0; i < count; i++) {
      const box = await items.nth(i).boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(40);
      expect(box.height).toBeGreaterThanOrEqual(40);
    }
    const menuBox = await page.locator(".mm-toolbar-menu").boundingBox();
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(390 + 1);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(844 + 1);
  });
});

test.describe("Selection lifecycle across a depth change", () => {
  test("selecting a depth-3 node then applying depth<=2 clears selection (node detail proxy) and canvas selection", async ({ page }) => {
    await openFixture(page);
    const harness = page.getByTestId("fixture-harness-root");
    await page.locator(nodeSelector(`${MAP_ID}-c`)).click();
    await expect(harness).toHaveAttribute("data-selected-node", `${MAP_ID}-c`);
    await applyLevel(page, "Hiện 2 tầng nhánh");
    await expect(harness).toHaveAttribute("data-selected-node", "");
  });

  test("selecting a depth-1 node then applying depth<=2 keeps selection", async ({ page }) => {
    await openFixture(page);
    const harness = page.getByTestId("fixture-harness-root");
    await page.locator(nodeSelector(`${MAP_ID}-a`)).click();
    await expect(harness).toHaveAttribute("data-selected-node", `${MAP_ID}-a`);
    await applyLevel(page, "Hiện 2 tầng nhánh");
    await expect(harness).toHaveAttribute("data-selected-node", `${MAP_ID}-a`);
  });
});

test.describe("Map lifecycle: no leak across A <-> depth-fixture switches", () => {
  test("root-only on the depth fixture does not survive a switch to map A, and does not leak into A's export-studio visible-scope preview", async ({ page }) => {
    await openFixture(page);
    await applyLevel(page, "Chỉ chủ đề chính");
    await expect(topics(page)).toHaveCount(1);

    await page.locator('[aria-label="Mở thư viện sơ đồ"]').click();
    await page.getByText("Bản đồ tư duy: Hệ thống StudyMap (Fixture A)").click();
    await page.locator(nodeSelector(`${MAP_A_ID}-root`)).waitFor({ state: "visible" });
    // Map A was never root-only -- more than one topic must be visible,
    // proving the depth fixture's root-only state did not leak as DOM/view
    // state onto a different map instance.
    expect(await topics(page).count()).toBeGreaterThan(1);

    await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
    const dialogA = page.getByRole("dialog");
    await dialogA.locator('input[name="mm-export-scope"][value="visible"]').check();
    await goToReviewStep(dialogA);
    const summaryA = await dialogA.locator("dd").filter({ hasText: "node" }).first().textContent();
    expect(summaryA).not.toContain("1 node");
    await dialogA.getByRole("button", { name: "Hủy" }).click();

    await page.locator('[aria-label="Mở thư viện sơ đồ"]').click();
    await page.getByText("Bản đồ kiểm thử mức thu/mở (Fixture Depth)").click();
    await page.locator(nodeSelector(ROOT)).waitFor({ state: "visible" });
    // Switching back must show the FRESH, freely re-derived state of this
    // map's own tree (8 nodes, fully expanded -- this fixture's own
    // natural default, which legitimately matches "Mo toan bo"), never the
    // stale "Chi chu de chinh" (root-only) aria-pressed state left behind
    // from before the switch to map A.
    await expect(topics(page)).toHaveCount(8);
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: "Chỉ chủ đề chính" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("menuitem", { name: "Mở toàn bộ" })).toHaveAttribute("aria-pressed", "true");
    for (const label of ["Hiện 1 tầng nhánh", "Hiện 2 tầng nhánh", "Hiện 3 tầng nhánh"]) {
      await expect(page.getByRole("menuitem", { name: label })).toHaveAttribute("aria-pressed", "false");
    }
  });
});

test.describe("Appearance V2 and branch-selection/export marker survive a depth change", () => {
  test("a cold-loaded saved appearance (PR #64) is still applied after a depth preset change", async ({ page }) => {
    await page.goto("/fixture-harness.html?initialAppearance=study");
    await page.locator(nodeSelector(`${MAP_A_ID}-root`)).waitFor({ state: "visible" });
    const rootA = page.locator(nodeSelector(`${MAP_A_ID}-root`));
    await expect.poll(() => rootA.evaluate((el) => el.style.borderRadius)).toBe("10px");

    await applyLevel(page, "Chỉ chủ đề chính");
    await expect(topics(page)).toHaveCount(1);
    await expect.poll(() => rootA.evaluate((el) => el.style.borderRadius)).toBe("10px");

    await applyLevel(page, "Mở toàn bộ");
    await expect.poll(() => rootA.evaluate((el) => el.style.borderRadius)).toBe("10px");
  });

  test("selected-branches export scope checkbox remains interactive after a depth preset change", async ({ page }) => {
    await openFixture(page);
    await applyLevel(page, "Hiện 2 tầng nhánh");
    await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
    const dialog = page.getByRole("dialog");
    const selectedBranches = dialog.locator('input[name="mm-export-scope"][value="selected_branches"]');
    await selectedBranches.check();
    await expect(selectedBranches).toBeChecked();
    await page.getByRole("button", { name: "Hủy" }).click();
  });
});

test.describe("Image export scope x root-only/depth (live-DOM capture, no production API)", () => {
  test("root-only + visible scope resolves to exactly the root in the Export Studio preview count", async ({ page }) => {
    await openFixture(page);
    await applyLevel(page, "Chỉ chủ đề chính");
    await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="mm-export-scope"][value="visible"]').check();
    await expect(dialog.locator(".export-message--error")).toHaveCount(0);
    await goToReviewStep(dialog);
    const summary = await dialog.locator("dd").filter({ hasText: "node" }).first().textContent();
    expect(summary).toContain("1 node");
    await dialog.getByRole("button", { name: "Hủy" }).click();
  });

  test("depth<=2 + visible scope resolves to exactly 6 nodes; full scope always resolves to all 8 regardless of current depth", async ({ page }) => {
    await openFixture(page);
    await applyLevel(page, "Hiện 2 tầng nhánh");
    await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="mm-export-scope"][value="visible"]').check();
    await goToReviewStep(dialog);
    let summary = await dialog.locator("dd").filter({ hasText: "node" }).first().textContent();
    expect(summary).toContain("6 node");

    // The scope radio only lives on the content step (step 0) -- go back,
    // switch to "full", and walk forward to the review step again.
    for (let i = 0; i < 3; i++) await dialog.getByRole("button", { name: "Quay lại" }).click();
    await dialog.locator('input[name="mm-export-scope"][value="full"]').check();
    await goToReviewStep(dialog);
    summary = await dialog.locator("dd").filter({ hasText: "node" }).first().textContent();
    expect(summary).toContain("8 node");
    await dialog.getByRole("button", { name: "Hủy" }).click();
  });
});

// DOCUMENT export (PDF) + "visible" scope is a pre-existing, BLOCKED,
// unrelated-to-root-only gap (see .playbook/known-issues.md and
// MindElixirView.exportStudioDocument.test.jsx's own pinned-gap test) --
// this suite never calls the production export API, so it cannot exercise
// the real 400 here. It is NOT re-tested in this file to avoid implying a
// PASS/FAIL verdict this harness has no backend to actually produce; the
// Vitest-level pinned-gap test is the regression guard for that contract.

test.describe("Visual QA screenshots (representative states, fake fixture data, not committed as artifacts)", () => {
  test("root-only / level-2 / full / manual-custom / selected-then-hidden -- representative captures", async ({ page }) => {
    await openFixture(page);

    await applyLevel(page, "Chỉ chủ đề chính");
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "state-root-only.png") });

    await applyLevel(page, "Hiện 2 tầng nhánh");
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "state-level-2.png") });

    await applyLevel(page, "Mở toàn bộ");
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "state-full.png") });

    await applyLevel(page, "Hiện 1 tầng nhánh");
    const tpcA = page.locator(nodeSelector(`${MAP_ID}-a`));
    await tpcA.locator("xpath=..").locator("me-epd").click();
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "state-manual-custom.png") });

    await applyLevel(page, "Mở toàn bộ");
    await page.locator(nodeSelector(`${MAP_ID}-c`)).click();
    await expect(page.getByTestId("fixture-harness-root")).toHaveAttribute("data-selected-node", `${MAP_ID}-c`);
    await applyLevel(page, "Hiện 1 tầng nhánh");
    await expect(page.getByTestId("fixture-harness-root")).toHaveAttribute("data-selected-node", "");
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "state-selected-then-hidden.png") });
  });
});
