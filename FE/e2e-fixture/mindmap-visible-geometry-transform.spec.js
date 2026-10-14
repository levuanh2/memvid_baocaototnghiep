// PR H2 Phase 2 — RED tests pinning a REAL, pre-existing bug in
// exportMindmapImage's "visible" scope path: it captures `mind.map`
// directly via snapdom with NO transform neutralization, so the exported
// bitmap's pixel dimensions depend on the live canvas's current zoom
// level even for the IDENTICAL node-set (confirmed live in Chrome during
// the Phase 1.5 closure audit: zoom 1 -> 1770x942, zoom 2 -> 3540x1885,
// same 8 nodes). Pan alone does not move the needle (no container resize).
//
// This drives the REAL exported function through the dev server's own
// module graph (same technique the fixture-harness suite already uses
// for real-browser layout, since jsdom has no real layout engine -- see
// mindmapImageExport.js's own docstring on estimateExportDimensions).
import { test, expect } from "@playwright/test";

const HARNESS_MODULE_PAGE = "/visible-geometry-harness.html";

test.describe("visible-scope geometry/transform contract (H2)", () => {
  test("RED: same node-set at zoom 1 vs zoom 2 currently produces DIFFERENT bitmap dimensions", async ({ page }) => {
    await page.goto(HARNESS_MODULE_PAGE);
    const result = await page.evaluate(async () => await window.__captureAtZoom(1));
    const zoomed = await page.evaluate(async () => await window.__captureAtZoom(2));
    // TARGET contract: these must be equal once transform neutralization
    // ships. Today they are NOT -- zoomed is exactly 2x larger.
    expect(zoomed.w, "bitmap width must not depend on live zoom for the same node-set").toBe(result.w);
    expect(zoomed.h, "bitmap height must not depend on live zoom for the same node-set").toBe(result.h);
  });

  test("ALREADY GREEN (regression pin, not Phase-2 red): pan alone does not change bitmap dimensions", async ({ page }) => {
    await page.goto(HARNESS_MODULE_PAGE);
    const base = await page.evaluate(async () => await window.__captureAtZoom(1));
    const panned = await page.evaluate(async () => await window.__captureAtPan(-150, -80));
    expect(panned.w).toBe(base.w);
    expect(panned.h).toBe(base.h);
  });

  test("RED: live transform is not restored byte-identical after a successful visible-scope capture", async ({ page }) => {
    await page.goto(HARNESS_MODULE_PAGE);
    const result = await page.evaluate(async () => await window.__captureWithTransformCheck("translate3d(-150px,-80px,0px) scale(2)"));
    // TARGET: transformBefore === transformAfter (neutralize-then-restore).
    // Today's code never touches transform at all for visible scope, so
    // this assertion currently passes TRIVIALLY (no mutation happens) --
    // flagged explicitly: this specific sub-case is a regression guard for
    // the FUTURE fix, not evidence of a bug by itself. The real red case is
    // the dimension-dependency test above; this one is included so Phase 3
    // can't "fix" zoom-dependency by leaving a residual transform mutation.
    expect(result.transformBefore).toBe(result.transformAfter);
  });

  test("ALREADY GREEN (regression pin): Mind Elixir instance identity and collapse state are unchanged by a capture call", async ({ page }) => {
    await page.goto(HARNESS_MODULE_PAGE);
    const result = await page.evaluate(async () => await window.__captureAndCheckInstanceStable());
    expect(result.sameInstance).toBe(true);
    expect(result.expandedStateUnchanged).toBe(true);
  });
});
