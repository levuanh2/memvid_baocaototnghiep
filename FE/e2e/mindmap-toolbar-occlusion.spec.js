import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  openMapLibrary,
  registerAndEnterApp,
  selectAllSources,
  uploadSampleDocument,
} from "./fixtures.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PHASE = process.env.TOOLBAR_OCCLUSION_PHASE === "before" ? "before" : "after";
const OUT = path.resolve(HERE, "..", "qa-artifacts", "mindmap-toolbar-occlusion");
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "tablet-edge", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];
const CONTROLS = [".mm-appearance-trigger", ".mm-export-trigger", ".mm-overflow-trigger"];

async function apiSession(page) {
  const token = await page.evaluate(() => localStorage.getItem("memvid-token"));
  expect(token, "auth token stored after register").toBeTruthy();
  return {
    base: `http://127.0.0.1:${process.env.PORT || 8080}`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

async function sourceStem(request, api) {
  let stem = null;
  await expect.poll(async () => {
    const response = await request.get(`${api.base}/list-indexed`, { headers: api.headers });
    const body = await response.json();
    stem = body.sources.find((source) => String(source.filename || "").includes("sample-doc"))?.video_stem || null;
    return stem;
  }, { timeout: 20_000 }).not.toBeNull();
  return stem;
}

async function seedMap(request, api, stem) {
  const response = await request.post(`${api.base}/generate-mindmap`, {
    headers: api.headers,
    data: {
      sources: [stem],
      source_ids: [stem],
      q: `toolbar occlusion ${Date.now()}`,
      force: false,
    },
  });
  expect(response.ok(), `seed POST /generate-mindmap -> ${response.status()}`).toBeTruthy();
  const queued = await response.json();
  if (queued.result?.id) return queued.result.id;

  let mapId = null;
  await expect.poll(async () => {
    const statusResponse = await request.get(`${api.base}/mindmap-status/${queued.job_id}`, { headers: api.headers });
    const body = await statusResponse.json();
    mapId = body.result?.id || null;
    return body.status;
  }, { timeout: 60_000, intervals: [250, 500, 1_000] }).toBe("done");
  return mapId;
}

async function hitTestToolbar(page) {
  return page.evaluate((selectors) => Object.fromEntries(selectors.map((selector) => {
    const control = document.querySelector(selector);
    const rect = control.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return [selector, {
      center: { x, y },
      rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
      ownsCenter: Boolean(hit && (hit === control || control.contains(hit))),
      hit: hit ? `${hit.tagName}.${String(hit.className || "").trim().split(/\s+/).join(".")}` : null,
      interceptedByOverlay: Boolean(hit?.closest(".mindmap-tools-overlay")),
    }];
  })), CONTROLS);
}

test("selected-node inspector never occludes Appearance, Export, or Overflow", async ({ page }) => {
  test.setTimeout(90_000);
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await registerAndEnterApp(page);
  await uploadSampleDocument(page);
  await selectAllSources(page);
  const api = await apiSession(page);
  const stem = await sourceStem(page.request, api);
  const mapId = await seedMap(page.request, api, stem);

  await page.goto("/app");
  const listbox = await openMapLibrary(page);
  await listbox.getByRole("option", { selected: true }).click();
  await expect(page.locator("me-tpc")).not.toHaveCount(0);
  await page.locator("me-tpc").nth(1).click();
  await expect(page.locator("aside.mindmap-tools-overlay")).toBeVisible();

  const measurements = {};
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.locator("aside.mindmap-tools-overlay")).toBeVisible();
    measurements[viewport.name] = await hitTestToolbar(page);
    await page.screenshot({
      path: path.join(OUT, `${PHASE}-${viewport.name}-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    });
  }
  fs.writeFileSync(path.join(OUT, `${PHASE}-element-from-point.json`), JSON.stringify({ mapId, measurements }, null, 2));

  for (const [viewport, controls] of Object.entries(measurements)) {
    for (const [selector, proof] of Object.entries(controls)) {
      expect(proof.ownsCenter, `${viewport} ${selector}: center hit ${proof.hit}`).toBe(true);
      expect(proof.interceptedByOverlay, `${viewport} ${selector}: overlay intercepted center`).toBe(false);
    }
  }

  // Real clicks complement the hit-test proof: each control must still open
  // its own surface while the selected-node Inspector remains mounted.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".mm-appearance-trigger").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.locator(".mm-export-trigger").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.locator(".mm-overflow-trigger").click();
  await expect(page.locator(".mm-toolbar-menu")).toBeVisible();
});
