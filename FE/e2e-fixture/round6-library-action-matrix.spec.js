import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const evidenceDir = path.resolve(process.cwd(), "../docs/ui-ux-v4-design/round6-qa-evidence");
const summaryIds = Array.from({ length: 42 }, (_, index) => `doc-${index + 1}`)
  .filter((id) => !["doc-1", "doc-8", "doc-15", "doc-22", "doc-29", "doc-36"].includes(id));

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
