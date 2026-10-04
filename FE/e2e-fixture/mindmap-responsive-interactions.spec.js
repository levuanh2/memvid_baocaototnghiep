// Responsive interaction regressions against the real MindElixirView, served by the
// backend-free fixture harness (no provider, no production data).
//   - overflow menu must dismiss on Escape and on an outside pointer press, so the next
//     canvas click reaches the topic on the first try (mobile first-click defect)
//   - every interactive control in the contextual Mind Map toolbar is >= 40x40
//   - mobile initial fit keeps node text at a readable scale, and never refits later
import { test, expect } from "@playwright/test";

const MAP_A = "fixture-map-a";
const ROOT_A = `me${MAP_A}-root`;
const MIN_TARGET = 40;
const MOBILE_MIN_SCALE = 0.75;

const VIEWPORTS = [
  { name: "1440x1024", width: 1440, height: 1024 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "390x844", width: 390, height: 844, mobile: true },
];

async function openFixture(page, { width, height }) {
  await page.setViewportSize({ width, height });
  await page.goto("/fixture-harness.html");
  await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" });
  await page.locator(`[data-nodeid="${ROOT_A}"]`).waitFor({ state: "visible" });
  await settled(page);
}

// Two identical samples 300 ms apart: the harness finishes its own placement shortly after load.
async function settled(page) {
  const snap = () => page.evaluate(() => {
    const canvas = document.querySelector(".map-canvas");
    return { t: canvas?.style.transform || "", n: document.querySelectorAll("me-tpc").length };
  });
  let last = await snap();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(300);
    const next = await snap();
    if (next.t === last.t && next.n === last.n) return next;
    last = next;
  }
  throw new Error("canvas did not settle");
}

const scaleOf = (page) => page.locator(".map-canvas").evaluate((el) => {
  const m = /scale\(([-\d.]+)\)/.exec(el.style.transform || "");
  return m ? Number(m[1]) : null;
});


async function openOverflow(page) {
  await page.getByRole("button", { name: "Thêm tùy chọn" }).click();
  await expect(page.locator(".mm-toolbar-menu")).toHaveCount(1);
}

// Mobile centres the root, so branches can sit off-screen (horizontal panning).
// Pick a topic whose centre is on screen and click that point with the mouse.
async function clickVisibleTopic(page) {
  const target = await page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const n = [...document.querySelectorAll("me-tpc")].find((t) => {
      const b = t.getBoundingClientRect();
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      return b.width > 0 && cx > 0 && cx < vw && cy > 120 && cy < vh - 40;
    });
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return { id: n.dataset.nodeid.replace(/^me/, ""), x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  expect(target, "a topic is on screen").not.toBeNull();
  await page.mouse.click(target.x, target.y);
  return target.id;
}

test.describe("mindmap overflow menu dismissal", () => {
  test("Escape closes the overflow menu, and the next topic click selects on the first try", async ({ page }) => {
    await openFixture(page, VIEWPORTS[2]);
    await openOverflow(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(".mm-toolbar-menu")).toHaveCount(0);
    const id = await clickVisibleTopic(page);
    await expect(page.locator(`[data-nodeid="me${id}"]`)).toHaveClass(/selected/);
  });

  test("an outside pointer press closes the overflow menu, and the next topic click selects on the first try", async ({ page }) => {
    await openFixture(page, VIEWPORTS[2]);
    await openOverflow(page);
    await page.mouse.click(12, 300);
    await expect(page.locator(".mm-toolbar-menu")).toHaveCount(0);
    const id = await clickVisibleTopic(page);
    await expect(page.locator(`[data-nodeid="me${id}"]`)).toHaveClass(/selected/);
  });
});

test.describe("contextual toolbar touch targets", () => {
  for (const vp of VIEWPORTS) {
    test(`every toolbar control is at least ${MIN_TARGET}x${MIN_TARGET} at ${vp.name}`, async ({ page }) => {
      await openFixture(page, vp);
      const sizes = await page.evaluate(() => {
        const sel = ".mm-map-selector__trigger, .mm-context-link, .mm-export-trigger, .mm-overflow-trigger, .mm-floating-toolbar button";
        return [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0).map((e) => {
          const b = e.getBoundingClientRect();
          return { label: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30), w: Math.round(b.width), h: Math.round(b.height) };
        });
      });
      expect(sizes.length).toBeGreaterThan(0);
      const small = sizes.filter((s) => s.w < MIN_TARGET || s.h < MIN_TARGET);
      expect(small, `controls under ${MIN_TARGET}px: ${JSON.stringify(small)}`).toEqual([]);
    });
  }
});

test.describe("mobile initial fit", () => {
  test("at 390px the initial scale is readable and the root sits inside the canvas", async ({ page }) => {
    await openFixture(page, VIEWPORTS[2]);
    const scale = await scaleOf(page);
    expect(scale, "initial scale").toBeGreaterThanOrEqual(MOBILE_MIN_SCALE);
    const inside = await page.evaluate((rootSel) => {
      const r = document.querySelector(rootSel)?.getBoundingClientRect();
      const c = document.querySelector(".map-container, .me-container")?.getBoundingClientRect();
      return !!r && !!c && r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom;
    }, `[data-nodeid="${ROOT_A}"]`);
    expect(inside, "root inside the visible canvas").toBe(true);
  });

  test("selecting a node does not refit or rescale the mobile map", async ({ page }) => {
    await openFixture(page, VIEWPORTS[2]);
    const before = await scaleOf(page);
    const id = await clickVisibleTopic(page);
    await expect(page.locator(`[data-nodeid="me${id}"]`)).toHaveClass(/selected/);
    expect(await scaleOf(page)).toBe(before);
  });
});
