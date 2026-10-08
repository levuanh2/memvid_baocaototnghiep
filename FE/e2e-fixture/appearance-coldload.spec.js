// Follow-up PR to #63 — real-browser visual QA for the cold-load appearance
// race fix (see .playbook/known-issues.md and
// MindElixirView.appearanceColdLoad.test.jsx for the full root-cause and
// the jsdom-level reproduction of the actual React-prop-timing race). This
// fixture harness has no backend and builds `data` synchronously
// (FixtureHarnessApp.jsx), so it cannot reproduce the two-wave data arrival
// itself — that is what the jsdom component test is for. What THIS file
// verifies is real-browser correctness of the fix's observable surface: a
// map that already carries a saved non-default appearance renders it on
// the very first paint (the `?initialAppearance=` harness hook — see
// FixtureHarnessApp.jsx — bakes it onto the record from render 1, the same
// shape a real cold page load would hand the component), a map switch
// never leaks the connector <style> tag, and no PATCH ever fires from
// merely loading/reading.
import { test, expect } from "@playwright/test";

const MAP_A_ID = "fixture-map-a";
const MAP_B_ID = "fixture-map-b";

function nodeSelector(id) {
  return `[data-nodeid="me${id}"]`;
}

async function gotoColdLoaded(page, { width, height, dark, preset = "study" } = {}) {
  if (width) await page.setViewportSize({ width, height });
  await page.goto(`/fixture-harness.html?initialAppearance=${preset}`);
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByTestId("fixture-harness-root").waitFor({ state: "visible" });
  await page.locator(nodeSelector(`${MAP_A_ID}-root`)).waitFor({ state: "visible" });
}

function assertNoHorizontalOverflow(page) {
  return page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
}

function connectorInvalidPathCount(page) {
  return page.evaluate(() => {
    const paths = Array.from(document.querySelectorAll(".lines path, .subLines path"));
    return paths.filter((p) => {
      const d = p.getAttribute("d") || "";
      return !d || /NaN|undefined|Infinity/.test(d);
    }).length;
  });
}

const VIEWPORTS = [
  { name: "1440x1024-light", width: 1440, height: 1024, dark: false },
  { name: "1440x1024-dark", width: 1440, height: 1024, dark: true },
  { name: "390x844-light", width: 390, height: 844, dark: false },
  { name: "390x844-dark", width: 390, height: 844, dark: true },
];

test.describe("Appearance cold-load — map already has a saved appearance on first paint", () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: the saved (non-default) appearance is visible on the very first render, no editor interaction needed`, async ({ page }) => {
      const patchCalls = [];
      await page.route("**/mindmaps/*/appearance", (route) => { patchCalls.push(route.request().method()); return route.fallback(); });

      await gotoColdLoaded(page, vp);

      const rootEl = page.locator(nodeSelector(`${MAP_A_ID}-root`));
      // Checked as the INLINE style the live-apply engine itself writes
      // (`el.style.borderRadius`/`cssText`), not `getComputedStyle` — the
      // root role in this theme carries its own pre-existing `!important`
      // accent-color CSS (unrelated to Appearance V2) that wins the cascade
      // visually regardless of inline style, exactly the reason the
      // already-merged appearance-editor.spec.js checks `el.style.cssText`
      // rather than computed style throughout.
      await expect.poll(() => rootEl.evaluate((el) => el.style.borderRadius)).toBe("10px");

      const overflow = await assertNoHorizontalOverflow(page);
      expect(overflow.doc).toBeLessThanOrEqual(1);
      expect(overflow.body).toBeLessThanOrEqual(1);

      expect(await connectorInvalidPathCount(page)).toBe(0);

      // Loading an already-saved appearance must never write it back —
      // this is a read/apply, not a save.
      expect(patchCalls.length).toBe(0);
    });
  }
});

test.describe("Appearance cold-load — map switch never leaks a connector <style> tag (single viewport)", () => {
  test.beforeEach(async ({ page }) => { await gotoColdLoaded(page, { width: 1440, height: 1024 }); });

  test("A (cold-loaded with a saved appearance) → B (no appearance) → A: B shows default, A's connector styling returns cleanly, never more than one style tag", async ({ page }) => {
    const styleTagCount = () => page.locator("style[data-mm-appearance-connector]").count();

    const rootA = page.locator(nodeSelector(`${MAP_A_ID}-root`));
    await expect.poll(() => rootA.evaluate((el) => el.style.borderRadius)).toBe("10px");

    await page.locator('[aria-label="Mở thư viện sơ đồ"]').click();
    await page.getByText("Bản đồ tư duy: Quy trình học tập (Fixture B)").click();
    const rootB = page.locator(nodeSelector(`${MAP_B_ID}-root`));
    await rootB.waitFor({ state: "visible" });
    await expect.poll(() => rootB.evaluate((el) => el.style.cssText)).toBe(""); // no appearance applied — untouched
    expect(await styleTagCount()).toBe(0);

    await page.locator('[aria-label="Mở thư viện sơ đồ"]').click();
    await page.getByText("Bản đồ tư duy: Hệ thống StudyMap (Fixture A)").click();
    const rootAAgain = page.locator(nodeSelector(`${MAP_A_ID}-root`));
    await rootAAgain.waitFor({ state: "visible" });
    await expect.poll(() => rootAAgain.evaluate((el) => el.style.borderRadius)).toBe("10px");
    expect(await styleTagCount()).toBeLessThanOrEqual(1);
  });
});
