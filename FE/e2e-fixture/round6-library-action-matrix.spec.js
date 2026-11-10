import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const evidenceDir = path.resolve(process.cwd(), "../docs/ui-ux-v4-design/round6-qa-evidence");
const summaryIds = Array.from({ length: 42 }, (_, index) => `doc-${index + 1}`)
  .filter((id) => !["doc-1", "doc-8", "doc-15", "doc-22", "doc-29", "doc-36"].includes(id));
const viewports = [
  [1440, 900], [1024, 768], [820, 1180], [800, 900], [768, 1024], [390, 844], [320, 568],
];
const responsiveMatrixViewports = [
  // 1023/767 are the edges of the 1024 and 768 grid breakpoints (agy audit).
  [1440, 900], [1024, 768], [1023, 900], [768, 1024], [767, 1024], [390, 844], [320, 568],
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

// The primary label is measured with the webfont (Inter, after document.fonts.ready) AND
// with Google Fonts blocked (the system fallback a user sees while Inter loads or when it
// cannot load). Post-merge #149 Fixture Smoke failed at 768px on doc-2 because the check
// ran before the font swap and only looked at scrollWidth.
for (const [width, height] of responsiveMatrixViewports) for (const fonts of ["webfont", "fallback font"]) {
  test(`${width}px action rows contain every control and keep the primary action on one line (${fonts})`, async ({ page }) => {
    if (fonts === "fallback font") await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.setViewportSize({ width, height });
    await page.goto("/round6-library-qa.html");
    // The production Library uses StudyShell's 980px frame. At lg and above,
    // CollectionSidebar consumes 210px plus the 24px gap, leaving 706px for
    // the matrix; below lg the shell keeps 20px padding on each side.
    const matrixWidth = width >= 1024 ? 706 : width - 40;
    await page.locator(".study-document-matrix").evaluate((node, targetWidth) => {
      node.style.width = `${targetWidth}px`;
    }, matrixWidth);
    await expect(page.locator('[data-document-id="doc-2"] [data-primary-action]'))
      .toContainText("Tiếp tục · Hướng dẫn ôn tập");
    // Measure settled text: never against a font that is about to be swapped.
    await page.evaluate(() => document.fonts.ready);
    if (fonts === "webfont") {
      // fonts.ready also resolves when a font FAILS to load; prove Inter 600 is really in use,
      // otherwise this "webfont" run would silently measure the fallback (Codex review).
      const interLoaded = await page.evaluate(async () => {
        await document.fonts.load("600 16px Inter", "Tiếp tục · Hướng dẫn ôn tập");
        return document.fonts.check("600 16px Inter", "Tiếp tục · Hướng dẫn ôn tập");
      });
      // Inter comes from Google Fonts. If it cannot load, say so and skip instead of failing the
      // required gate on a third-party outage (Codex review 2); the fallback-font run of this
      // width always runs and needs no network.
      test.skip(!interLoaded, "Inter 600 could not load from Google Fonts; the fallback-font run covers this width");
    }
    // The intended grid must actually apply: an invalid grid-template-columns is dropped by the
    // browser and every row silently stacks into one column (Codex review 2, P1).
    const tracks = await page.locator("[data-document-row]").evaluateAll((rows) => rows.map((row) => ({
      id: row.dataset.documentId,
      columns: getComputedStyle(row).gridTemplateColumns.split(" ").length,
      height: Math.round(row.getBoundingClientRect().height),
    })));
    const expectedColumns = width >= 1024 ? 6 : width >= 768 ? 5 : 3;
    expect(tracks.filter(({ columns }) => columns !== expectedColumns)).toEqual([]);
    // A stacked row is 171-336px; a laid-out row is 78-101px (the "Tiếp tục" row at >= 1024px
    // wraps its progress text to make room for the wider primary action).
    if (width >= 768) expect(Math.max(...tracks.map(({ height }) => height))).toBeLessThanOrEqual(120);

    const geometry = await page.locator("[data-document-row]").evaluateAll((rows) => rows.map((row) => {
      const rowRect = row.getBoundingClientRect();
      const controls = [...row.querySelectorAll("button,input")];
      const outside = controls.filter((control) => {
        const rect = control.getBoundingClientRect();
        return rect.left < rowRect.left - 1 || rect.right > rowRect.right + 1
          || rect.top < rowRect.top - 1 || rect.bottom > rowRect.bottom + 1;
      });
      const primaryNode = row.querySelector("[data-primary-action]");
      const primary = primaryNode.getBoundingClientRect();
      // scrollWidth misses centred overflow: the left half is not scrollable and the right
      // half hides in padding-right. Compare the icon + label box with the padding box
      // (.playbook lessons-learned 2026-10-27).
      const style = getComputedStyle(primaryNode);
      const boxLeft = primary.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const boxRight = primary.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
      const range = document.createRange();
      range.selectNodeContents(primaryNode);
      const content = range.getBoundingClientRect();
      return {
        id: row.dataset.documentId,
        outside: outside.map((control) => control.getAttribute("data-tools-trigger") !== null
          ? "tools" : control.getAttribute("data-primary-action") !== null ? "primary" : control.tagName.toLowerCase()),
        primaryHeight: primary.height,
        primaryClientWidth: primaryNode.clientWidth,
        primaryScrollWidth: primaryNode.scrollWidth,
        primaryContentOverflow: Math.round(Math.max(0, boxLeft - content.left, content.right - boxRight) * 10) / 10,
      };
    }));

    expect(geometry.filter(({ outside }) => outside.length > 0)).toEqual([]);
    expect(Math.max(...geometry.map(({ primaryHeight }) => primaryHeight))).toBeLessThanOrEqual(46);
    expect(geometry.filter(({ primaryClientWidth, primaryScrollWidth }) => (
      primaryScrollWidth > primaryClientWidth + 1
    ))).toEqual([]);
    // Icon and label sit inside the padding box (0.5px for sub-pixel text rounding).
    expect(geometry.filter(({ primaryContentOverflow }) => primaryContentOverflow > 0.5)
      .map(({ id, primaryContentOverflow }) => ({ id, primaryContentOverflow }))).toEqual([]);
  });
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
