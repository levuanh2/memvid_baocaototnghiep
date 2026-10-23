// Auto-context marker on the live canvas (not just the later Export Studio
// "Node cha tự động" list): the user asked to SEE which ancestor will be
// auto-included the moment two children are ticked, not only after opening
// the dialog, and to be able to suppress it right there.
import { expect, test } from "@playwright/test";

const marker = (id) => `me-export-check[data-node-id="${id}"]`;

async function openSelection(page) {
  await page.goto("/fixture-harness.html?map=post-pr77");
  await expect.poll(() => page.evaluate(() => Boolean(window.__STUDYMAP_FIXTURE__?.mind))).toBe(true);
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
  await page.locator(".export-inline-action").click();
  await expect(page.locator(marker("A"))).toBeVisible();
}

test("P shows an auto-context mark on canvas as soon as A and B are both ticked, before Export Studio's own list", async ({ page }) => {
  await openSelection(page);

  await expect(page.locator(marker("P"))).not.toHaveClass(/is-auto-context/);
  await page.locator(marker("A")).press("Space");
  // One child alone: P is not yet pulled in (A IS its own presentation root).
  await expect(page.locator(marker("P"))).not.toHaveClass(/is-auto-context/);
  await expect(page.locator(marker("P"))).not.toHaveAttribute("aria-checked", "true");

  await page.locator(marker("B")).press("Space");
  // Two siblings: P becomes the minimal ancestor, marked live — no need to
  // reach the dialog's content step to learn this.
  await expect(page.locator(marker("P"))).toHaveClass(/is-auto-context/);
  await expect(page.locator(marker("P"))).toHaveAttribute("aria-checked", "false"); // never itself ticked
  await expect(page.locator(marker("A"))).toHaveClass(/is-checked/);
  await expect(page.locator(marker("B"))).toHaveClass(/is-checked/);
});

test("clicking the auto-context mark suppresses it live, without touching the explicit ticks", async ({ page }) => {
  await openSelection(page);
  await page.locator(marker("A")).press("Space");
  await page.locator(marker("B")).press("Space");
  await expect(page.locator(marker("P"))).toHaveClass(/is-auto-context/);

  await page.locator(marker("P")).press("Space");
  await expect(page.locator(marker("P"))).toHaveClass(/is-auto-suppressed/);
  await expect(page.locator(marker("P"))).not.toHaveClass(/is-auto-context/);
  await expect(page.locator(marker("A"))).toHaveClass(/is-checked/);
  await expect(page.locator(marker("B"))).toHaveClass(/is-checked/);

  // Restores on a second press.
  await page.locator(marker("P")).press("Space");
  await expect(page.locator(marker("P"))).toHaveClass(/is-auto-context/);
  await expect(page.locator(marker("P"))).not.toHaveClass(/is-auto-suppressed/);
});

test("the live canvas suppression carries into the export (P excluded, A+B still exact)", async ({ page }) => {
  await openSelection(page);
  await page.locator(marker("A")).press("Space");
  await page.locator(marker("B")).press("Space");
  await page.locator(marker("P")).press("Space"); // suppress live, before ever opening the dialog content step

  await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();
  await expect(page.locator(".export-footer__summary")).toContainText("2 node đã chọn · 0 node cha tự thêm · 2 node được xuất");
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="svg"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất SVG" }).click();
  const download = await waiting;
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "qa-artifacts", "auto-context-marker");
  fs.mkdirSync(out, { recursive: true });
  const target = path.join(out, "live-suppressed-a-b.svg");
  await download.saveAs(target);
  const svg = fs.readFileSync(target, "utf8");
  expect([...svg.matchAll(/data-nodeid="me([^" ]+)"/g)].map((m) => m[1]).sort()).toEqual(["A", "B"]);
});
