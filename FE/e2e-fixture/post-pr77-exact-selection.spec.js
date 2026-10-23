import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "qa-artifacts", "post-pr77-exact-selection");
fs.mkdirSync(OUT, { recursive: true });
const CHILDREN = ["A", "B", "C", "D"];
const marker = (id) => `me-export-check[data-node-id="${id}"]`;

async function openSelection(page) {
  await page.goto("/fixture-harness.html?map=post-pr77");
  await expect.poll(() => page.evaluate(() => Boolean(window.__STUDYMAP_FIXTURE__?.mind))).toBe(true);
  await page.evaluate(() => window.__STUDYMAP_FIXTURE__.mind.scale(0.69));
  await expect(page.locator(".mm-floating-toolbar button").nth(1)).toContainText("69%");
  await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
  await page.locator('input[name="mm-export-scope"][value="selected_branches"]').check();
  await page.locator(".export-inline-action").click();
  await expect(page.locator(marker("A"))).toBeVisible();
}

async function selectPair(page, pair, keyboard) {
  for (const id of pair) {
    const item = page.locator(marker(id));
    if (keyboard) {
      await item.focus();
      await item.press("Space");
    } else {
      await item.locator(".mm-export-check__dot").click();
    }
  }
  for (const id of ["ROOT", "P", ...CHILDREN]) {
    await expect(page.locator(marker(id))).toHaveAttribute("aria-checked", String(pair.includes(id)));
  }
}

async function exportSvg(page, pair, index) {
  await page.locator(".mm-selection-bar").getByRole("button", { name: "Tiếp tục" }).click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog.locator('input[name="mm-export-scope"]:checked')).toHaveValue("selected_branches");
  await expect(dialog).toContainText("2 node đã tick");
  await expect(dialog).toContainText("2 node đã chọn · 1 node cha tự thêm · 3 node được xuất");
  if (index % 2 === 0) await page.getByRole("button", { name: "Ảnh PNG" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.locator('input[name="mm-export-format"][value="svg"]').check();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await expect(dialog.locator('[aria-label="Tóm tắt cấu hình xuất"]')).toContainText("2 node đã tick · 3 node thực tế");
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất SVG" }).click();
  const download = await waiting;
  const target = path.join(OUT, `pair-${pair.join("-")}.svg`);
  await download.saveAs(target);
  const raw = fs.readFileSync(target, "utf8");
  const ids = [...raw.matchAll(/data-nodeid="me([^" ]+)"/g)].map((match) => match[1]).sort();
  expect(ids).toEqual(["P", ...pair].sort());
  expect(raw).toContain("viewBox=");
}

test("all six two-child pairs stay exact at 69% across mouse, Space, presets, reopen and cache reload", async ({ page }) => {
  const pairs = [];
  for (let i = 0; i < CHILDREN.length; i += 1) for (let j = i + 1; j < CHILDREN.length; j += 1) pairs.push([CHILDREN[i], CHILDREN[j]]);
  for (let index = 0; index < pairs.length; index += 1) {
    await openSelection(page);
    if (index === 1 || index === 5) await page.reload({ waitUntil: "networkidle" });
    if (index === 1 || index === 5) {
      await page.evaluate(() => window.__STUDYMAP_FIXTURE__.mind.scale(0.69));
      await page.getByRole("button", { name: "Xuất sơ đồ" }).click();
      await page.locator('input[value="selected_branches"]').check();
      await page.locator(".export-inline-action").click();
    }
    await selectPair(page, pairs[index], index % 2 === 1);
    await exportSvg(page, pairs[index], index);
  }
});

test("checking then unchecking parent never selects descendants", async ({ page }) => {
  await openSelection(page);
  await page.locator(marker("P")).focus();
  await page.locator(marker("P")).press("Space");
  await expect(page.locator(marker("P"))).toHaveAttribute("aria-checked", "true");
  for (const id of CHILDREN) await expect(page.locator(marker(id))).toHaveAttribute("aria-checked", "false");
  await page.locator(marker("P")).press("Space");
  for (const id of ["ROOT", "P", ...CHILDREN]) await expect(page.locator(marker(id))).toHaveAttribute("aria-checked", "false");
});

test("real Chromium offscreen Mind Elixir topics expose complete identity", async ({ page }) => {
  await openSelection(page);
  await selectPair(page, ["B", "C"], false);
  await page.evaluate(() => {
    window.__OFFSCREEN_IDENTITY_SAMPLES__ = [];
    window.__OFFSCREEN_IDENTITY_TIMER__ = window.setInterval(() => {
      const topics = [...document.querySelectorAll(".mm-export-offscreen me-tpc")];
      if (!topics.length) return;
      window.__OFFSCREEN_IDENTITY_SAMPLES__.push(topics.map((topic) => ({
        nodeObjId: topic.nodeObj?.id || null,
        dataNodeId: topic.getAttribute("data-node-id"),
        dataNodeid: topic.getAttribute("data-nodeid"),
      })));
    }, 1);
  });

  await exportSvg(page, ["B", "C"], 1);
  const samples = await page.evaluate(() => {
    window.clearInterval(window.__OFFSCREEN_IDENTITY_TIMER__);
    return window.__OFFSCREEN_IDENTITY_SAMPLES__;
  });
  const complete = samples.find((sample) => sample.length === 3 && sample.every((topic) => topic.nodeObjId));
  expect(complete).toBeTruthy();
  expect(complete.map((topic) => topic.nodeObjId).sort()).toEqual(["B", "C", "P"]);
  expect(complete.every((topic) => topic.dataNodeid === `me${topic.nodeObjId}`)).toBe(true);
});
