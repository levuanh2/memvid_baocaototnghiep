// R5 owner trial: fixture-only A/B initial placement at the same 320/390
// phone viewports and on the same deterministic map measured in PR #147.
import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

test.setTimeout(120_000);

const MAP_ID = "fixture-map-a";
const ROOT_ID = `${MAP_ID}-root`;
const FIRST_LEVEL_IDS = [0, 1, 2, 3].map((index) => `${MAP_ID}-m${index}`).concat(`${MAP_ID}-vn-gate`);
const EXPECTED_INSIDE = {
  320: { main: 0, a: 0, b: 0 },
  390: { main: 0, a: 0, b: 2 },
};
const EXPECTED_TRIAL_SHA = `${execSync("git rev-parse --short=12 HEAD", { encoding: "utf8" }).trim()}${
  execSync("git status --porcelain", { encoding: "utf8" }).trim() ? "-dirty" : ""
}`;

async function settleGeometry(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.locator(`[data-nodeid="me${ROOT_ID}"]`).waitFor({ state: "attached" });
  await expect(page.locator('[data-mindmap-render-state="ready"]')).toHaveCount(1);
  let previous = JSON.stringify(await geometrySnapshot(page));
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(300);
    const current = JSON.stringify(await geometrySnapshot(page));
    if (current === previous) return;
    previous = current;
  }
  throw new Error("trial map geometry did not settle");
}

async function settle(page) {
  await settleGeometry(page);
  await page.locator(`[data-nodeid="me${ROOT_ID}"]`).waitFor({ state: "visible" });
}

async function dismissTrialReadout(page) {
  await expect(page.getByTestId("trial-viewport-readout")).toBeVisible();
  await page.getByTestId("trial-start-button").click();
  await expect(page.getByTestId("trial-viewport-readout")).toHaveCount(0);
}

async function geometrySnapshot(page) {
  return page.evaluate(() => {
    const roundedRect = (element) => {
      const rect = element.getBoundingClientRect();
      return [rect.left, rect.top, rect.width, rect.height].map((value) => Math.round(value * 1000) / 1000);
    };
    return {
      canvas: roundedRect(document.querySelector(".map-container")),
      transform: document.querySelector(".map-canvas")?.style.transform,
      nodes: [...document.querySelectorAll("me-tpc")].map((node) => [node.dataset.nodeid, ...roundedRect(node)]).sort(),
    };
  });
}

async function openSelection(page) {
  await page.locator('[aria-label="Xuất sơ đồ"]').first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
  await page.locator(".export-inline-action").click();
  await expect(page.locator(".mm-selection-bar")).toBeVisible();
}

async function measure(page) {
  return page.evaluate(({ rootId, firstLevelIds }) => {
    const mind = window.__STUDYMAP_FIXTURE__?.mind;
    const viewport = document.querySelector(".map-container")?.getBoundingClientRect();
    const topics = [...document.querySelectorAll("me-tpc")];
    const topicRect = (id) => document.querySelector(`[data-nodeid="me${id}"]`)?.getBoundingClientRect();
    const inside = (rect) => !!rect && !!viewport
      && rect.left >= viewport.left - 1 && rect.right <= viewport.right + 1
      && rect.top >= viewport.top - 1 && rect.bottom <= viewport.bottom + 1;
    const overlapPairs = (rects) => {
      let count = 0;
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          if (rects[i].left < rects[j].right && rects[i].right > rects[j].left
            && rects[i].top < rects[j].bottom && rects[i].bottom > rects[j].top) count += 1;
        }
      }
      return count;
    };
    const markers = [...document.querySelectorAll("me-export-check")];
    const hosts = markers.map((marker) => marker.getBoundingClientRect());
    const dots = markers.map((marker) => marker.querySelector(".mm-export-check__dot").getBoundingClientRect());
    const controls = [...document.querySelectorAll(".mm-floating-toolbar button, .mm-selection-bar button")]
      .map((control) => control.getBoundingClientRect()).filter((rect) => rect.width > 0);
    return {
      scale: mind?.scaleVal,
      minRenderedLabelPx: Math.min(...topics.map((topic) => parseFloat(getComputedStyle(topic).fontSize) * mind.scaleVal)),
      rootInside: inside(topicRect(rootId)),
      firstLevelInside: firstLevelIds.filter((id) => inside(topicRect(id))).length,
      firstLevelTotal: firstLevelIds.length,
      markerHostOverlapPairs: overlapPairs(hosts),
      markerDotOverlapPairs: overlapPairs(dots),
      markerTouchTarget: Math.min(...hosts.flatMap((rect) => [rect.width, rect.height])),
      minControlTouchTarget: Math.min(...controls.flatMap((rect) => [rect.width, rect.height])),
      transform: document.querySelector(".map-canvas")?.style.transform,
    };
  }, { rootId: ROOT_ID, firstLevelIds: FIRST_LEVEL_IDS });
}

for (const width of [320, 390]) {
  for (const option of ["main", "a", "b"]) {
    test(`${option} matches PR #147 metrics at ${width}x844`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/fixture-harness.html?fit=${option}`);
      await expect(page.getByTestId("fixture-harness-root")).toHaveAttribute("data-fit-option", option);
      await dismissTrialReadout(page);
      await settle(page);
      if (option === "a") await expect(page.getByTestId("fit-trial-pan-hint")).toHaveText("Kéo để xem các nhánh");
      else await expect(page.getByTestId("fit-trial-pan-hint")).toHaveCount(0);

      const beforeSelection = await page.locator(".map-canvas").evaluate((canvas) => canvas.style.transform);
      await openSelection(page);
      const result = await measure(page);
      console.log(JSON.stringify({ viewport: `${width}x844`, option, ...result }));

      expect(result.scale).toBeCloseTo(0.75, 5);
      expect(result.minRenderedLabelPx).toBeCloseTo(9, 1);
      expect(result.rootInside).toBe(true);
      expect(result.firstLevelInside).toBe(EXPECTED_INSIDE[width][option]);
      expect(result.firstLevelTotal).toBe(5);
      expect(result.markerHostOverlapPairs).toBe(28);
      expect(result.markerDotOverlapPairs).toBe(0);
      expect(result.markerTouchTarget).toBeGreaterThanOrEqual(39.9);
      expect(result.minControlTouchTarget).toBeGreaterThanOrEqual(39.9);
      expect(result.transform, "opening selection must not refit").toBe(beforeSelection);
    });
  }
}

test("unknown fit values fall back to the production-default main behavior", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/fixture-harness.html?fit=not-a-trial");
  await expect(page.getByTestId("fixture-harness-root")).toHaveAttribute("data-fit-option", "main");
  await dismissTrialReadout(page);
  await settle(page);
  await expect(page.getByTestId("fit-trial-pan-hint")).toHaveCount(0);
});

test("non-trial fixture URLs keep their original no-readout startup", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/fixture-harness.html");
  await expect(page.getByTestId("trial-viewport-readout")).toHaveCount(0);
  await settle(page);
});

for (const width of [320, 390]) {
  for (const option of ["a", "b"]) {
    test(`phone readout reports five live values without changing ${option} geometry at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/fixture-harness.html?fit=${option}`);
      await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" });

      const readout = page.getByTestId("trial-viewport-readout");
      await expect(readout).toBeVisible();
      await expect(page.getByTestId("trial-inner-width")).toHaveText(`${width} CSS px`);
      await expect(page.getByTestId("trial-inner-height")).toHaveText("844 CSS px");
      await expect(page.getByTestId("trial-device-pixel-ratio")).toHaveText(String(await page.evaluate(() => devicePixelRatio)));
      await expect(page.getByTestId("trial-option-name")).toHaveText(option.toUpperCase());
      await expect(page.getByTestId("trial-build-sha")).toHaveText(EXPECTED_TRIAL_SHA);

      const startButton = page.getByTestId("trial-start-button");
      const buttonBox = await startButton.boundingBox();
      expect(buttonBox?.height).toBeGreaterThanOrEqual(48);
      await expect(page.locator(".map-container")).toHaveCount(0);
      await startButton.click();
      await expect(readout).toHaveCount(0);
      await settle(page);
      const afterDismiss = await geometrySnapshot(page);

      await page.goto(`/fixture-harness.html?fit=${option}&readout=skip`);
      await expect(page.getByTestId("trial-viewport-readout")).toHaveCount(0);
      await settle(page);
      expect(await geometrySnapshot(page)).toEqual(afterDismiss);
    });
  }
}

test("phone readout updates after viewport resize", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/fixture-harness.html?fit=b");
  await expect(page.getByTestId("trial-inner-width")).toHaveText("320 CSS px");
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(page.getByTestId("trial-inner-width")).toHaveText("390 CSS px");
  await expect(page.getByTestId("trial-inner-height")).toHaveText("780 CSS px");
});
