import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const evidenceDir = path.resolve(process.cwd(), "../docs/ui-ux-v4-design/round6-qa-evidence");
const summaryIds = Array.from({ length: 42 }, (_, index) => `doc-${index + 1}`)
  .filter((id) => !["doc-1", "doc-8", "doc-15", "doc-22", "doc-29", "doc-36"].includes(id));
const viewports = [
  [1440, 900], [1024, 768], [820, 1180], [800, 900], [768, 1024], [390, 844], [320, 568],
];

test.beforeAll(async () => mkdir(evidenceDir, { recursive: true }));

test("desktop matrix has exact membership, count parity, and measured control density", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/round6-library-qa.html");
  await expect(page.getByTestId("round6-library-qa")).toBeVisible();
  const rows = page.locator("[data-document-row]");
  await expect(rows).toHaveCount(42);
  const allIds = await rows.evaluateAll((nodes) => nodes.map((node) => node.dataset.documentId));
  expect(allIds).toEqual(Array.from({ length: 42 }, (_, index) => `doc-${index + 1}`));
  await expect(page.locator('[data-task-view="all"]')).toContainText("42");
  await expect(page.locator('[data-task-view="continue"]')).toContainText("1");
  await expect(page.locator('[data-task-view="needs_quiz"]')).toContainText("35");
  await expect(page.locator('[data-task-view="needs_summary"]')).toContainText("36");

  await page.locator('[data-task-view="needs_summary"]').click();
  await expect(rows).toHaveCount(36);
  expect(await rows.evaluateAll((nodes) => nodes.map((node) => node.dataset.documentId))).toEqual(summaryIds);
  await expect(page.getByTestId("result-count")).toContainText("36");
  await page.locator('[data-task-view="all"]').click();

  const metrics = await page.evaluate(() => {
    const surface = document.querySelector('[data-testid="round6-library-qa"]');
    const rows = [...surface.querySelectorAll("[data-document-row]")];
    return {
      viewport: { width: innerWidth, height: innerHeight },
      rowCount: rows.length,
      uniqueUuidCount: new Set(rows.map((row) => row.dataset.documentId)).size,
      totalInteractiveControls: surface.querySelectorAll('button,input,select,a[href],[tabindex="0"]').length,
      rowInteractiveControls: rows.reduce((sum, row) => sum + row.querySelectorAll("button,input,select,a[href]").length, 0),
      firstRowHeight: Math.round(rows[0].getBoundingClientRect().height),
    };
  });
  await page.screenshot({ path: path.join(evidenceDir, "library-matrix-desktop-1440.png"), fullPage: false });
  await writeFile(path.join(evidenceDir, "matrix-density-metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  expect(metrics).toMatchObject({ rowCount: 42, uniqueUuidCount: 42 });
  expect(metrics.rowInteractiveControls).toBe(42 * 5);
});

test("mobile uses the portalled complete-tools sheet with all seven learning surfaces", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/round6-library-qa.html");
  const firstRow = page.locator("[data-document-row]").first();
  await firstRow.locator("[data-tools-trigger]").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-learning-tool]")).toHaveCount(7);
  await expect(dialog.locator('[data-surface="mindmap"]')).toBeVisible();
  await expect(dialog.locator('[data-surface="studymap"]')).toBeVisible();
  await expect(dialog.locator("[data-management-action]")).toHaveCount(4);
  await page.screenshot({ path: path.join(evidenceDir, "library-matrix-mobile-390-tools.png"), fullPage: false });
});

for (const [width, height] of viewports) {
  for (const theme of ["light", "dark"]) {
    test(`${width}x${height} ${theme} contains every row and control`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/round6-library-qa.html?theme=${theme}`);
      await expect(page.locator("[data-document-row]")).toHaveCount(42);
      const geometry = await page.evaluate(() => {
        const rows = [...document.querySelectorAll("[data-document-row]")];
        const clippedRows = rows.filter((row) => row.scrollWidth > row.clientWidth + 1).map((row) => row.dataset.documentId);
        const clippedControls = [...document.querySelectorAll("[data-document-row] button, [data-document-row] input")]
          .filter((control) => {
            const rect = control.getBoundingClientRect();
            const rowRect = control.closest("[data-document-row]").getBoundingClientRect();
            return rect.left < rowRect.left - 1 || rect.right > rowRect.right + 1;
          }).length;
        const smallTargets = innerWidth <= 767
          ? [...document.querySelectorAll("[data-document-row] button, [data-document-row] label")]
            .filter((control) => {
              const rect = control.getBoundingClientRect();
              return rect.width < 44 || rect.height < 44;
            }).length
          : 0;
        return {
          globalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          clippedRows,
          clippedControls,
          smallTargets,
        };
      });
      expect(geometry).toEqual({ globalOverflow: 0, clippedRows: [], clippedControls: 0, smallTargets: 0 });
      await page.screenshot({ path: path.join(evidenceDir, `library-${width}x${height}-${theme}.png`), fullPage: false });
    });
  }
}

test("captures four task views, empty state, desktop menu, and bulk scope change", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/round6-library-qa.html");
  for (const [view, count] of [["continue", 1], ["needs_summary", 36], ["needs_quiz", 35]]) {
    await page.locator(`[data-task-view="${view}"]`).click();
    await expect(page.locator("[data-document-row]")).toHaveCount(count);
    await page.screenshot({ path: path.join(evidenceDir, `library-view-${view}.png`), fullPage: false });
  }
  await page.goto("/round6-library-qa.html?query=khong-co-ket-qua");
  await expect(page.getByText("Không có tài liệu phù hợp")).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "library-composed-empty.png"), fullPage: false });

  await page.goto("/round6-library-qa.html");
  await page.locator("[data-document-row]").first().locator("[data-tools-trigger]").click();
  await expect(page.locator(".document-tools--desktop")).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "library-desktop-more-menu.png"), fullPage: false });
  await page.keyboard.press("Escape");

  const rows = page.locator("[data-document-row]");
  await rows.nth(0).locator('input[type="checkbox"]').check();
  await rows.nth(1).locator('input[type="checkbox"]').check();
  await page.screenshot({ path: path.join(evidenceDir, "library-bulk-before-task-change.png"), fullPage: false });
  await page.locator('[data-task-view="needs_summary"]').click();
  await expect(page.locator('[data-document-id="doc-1"]')).toHaveCount(0);
  await expect(page.locator('[data-document-id="doc-2"] input[type="checkbox"]')).toBeChecked();
  await page.screenshot({ path: path.join(evidenceDir, "library-bulk-after-task-change.png"), fullPage: false });
});

test("320px tools sheet is contained, scrollable, and uses 44px targets", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/round6-library-qa.html?theme=dark");
  await page.locator("[data-document-row]").first().locator("[data-tools-trigger]").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const metrics = await dialog.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const targets = [...node.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
    const scrollRegion = node.querySelector(".overflow-auto");
    return {
      left: rect.left, right: rect.right, width: innerWidth,
      minTarget: Math.min(...targets.map((target) => Math.min(target.width, target.height))),
      scrollable: scrollRegion.scrollHeight > scrollRegion.clientHeight,
    };
  });
  expect(metrics.left).toBeGreaterThanOrEqual(0);
  expect(metrics.right).toBeLessThanOrEqual(metrics.width);
  expect(metrics.minTarget).toBeGreaterThanOrEqual(44);
  expect(metrics.scrollable).toBe(true);
  await page.screenshot({ path: path.join(evidenceDir, "library-mobile-320-tools-dark.png"), fullPage: false });
});

test("dark-mode keyboard and programmatic focus remain visibly tokenized", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/round6-library-qa.html?theme=dark");
  await page.locator('input[aria-label="Tìm trong thư viện QA"]').focus();
  await page.keyboard.press("Tab");
  const taskFocus = await page.locator('[data-task-view="all"]').evaluate((node) => {
    const style = getComputedStyle(node);
    return [style.outlineStyle, style.outlineWidth];
  });
  expect(taskFocus).toEqual(["solid", "2px"]);

  const trigger = page.locator("[data-document-row]").first().locator("[data-tools-trigger]");
  await trigger.click();
  const firstMenuItem = page.locator(".document-tools--desktop [data-learning-tool]").first();
  await expect(firstMenuItem).toBeFocused();
  const menuFocus = await firstMenuItem.evaluate((node) => {
    const style = getComputedStyle(node);
    return [style.outlineStyle, style.outlineWidth, style.backgroundColor];
  });
  expect(menuFocus[0]).toBe("solid");
  expect(menuFocus[1]).toBe("2px");
  expect(menuFocus[2]).not.toBe("rgba(0, 0, 0, 0)");
});
