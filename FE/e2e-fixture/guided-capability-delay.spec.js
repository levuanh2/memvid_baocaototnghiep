// Guided create gate, with the capability response deliberately held open.
// Same mocked-API harness as mobile-header-visual.spec.js. No backend, no
// provider: every generation POST is counted and answered with 500, and the
// suite asserts zero POSTs. Writes screenshots to qa-artifacts/guided-capability-delay.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.GUIDED_CAPABILITY_QA_DIR || path.join(process.cwd(), "qa-artifacts", "guided-capability-delay");
fs.mkdirSync(OUT, { recursive: true });

const API = /localhost:8080\//;
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const USAGE = { plan: "Free", used: 120, reserved: 0, limit: 1000, remaining: 880, percentage: 12, reset_at: "2026-11-01T00:00:00Z", breakdown: { chat: 120 } };
const MAP = {
  id: "map-a", title: "Bản đồ A", schema_version: 2, sources: [], relations: [], content_hash: "h1",
  nodes: [
    { id: "map-a-root", kind: "root", title: "Chủ đề gốc", parent: null, order: 0 },
    { id: "map-a-m0", kind: "section", title: "Nhánh một", parent: "map-a-root", order: 0 },
  ],
  generator: { pipeline: "fixture", model: "fixture", elapsed_sec: 0, degraded: false, missing: [] },
};
const VALIDATION = "Vui lòng chọn ít nhất một tài liệu để tạo Sơ đồ!";

const WIDTHS = [
  { w: 390, h: 844 }, { w: 1023, h: 768 }, { w: 1024, h: 768 }, { w: 1025, h: 768 }, { w: 1440, h: 1024 },
];

// Fresh page per run. Capability is held open (route not fulfilled) until the
// test resolves it. Every POST is recorded.
async function openHeldCapability(page, { w, h }) {
  const posts = [];
  let capabilityRoute = null;
  let capabilityCalls = 0;
  await page.setViewportSize({ width: w, height: h });
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(API, (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    if (req.method() === "POST") {
      posts.push(pathname);
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "fixture: POST blocked" }) });
    }
    if (pathname === "/mindmaps/capability") {
      capabilityCalls += 1;
      capabilityRoute = route; // held open until the test resolves it
      return;
    }
    if (pathname === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (pathname === "/usage/me") return route.fulfill(json(USAGE));
    if (pathname === "/mindmaps") return route.fulfill(json({ mindmaps: [MAP] }));
    if (pathname === "/mindmaps/map-a") return route.fulfill(json(MAP));
    if (pathname === "/list-indexed") return route.fulfill(json({ sources: [] }));
    if (pathname === "/api/documents") return route.fulfill(json({ documents: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app");
  await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor({ state: "visible", timeout: 30000 });
  await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
  await page.getByRole("button", { name: "Mở thư viện sơ đồ" }).click();
  const createButton = page.locator(".mm-map-selector__new");
  await expect(createButton).toBeVisible();
  return {
    posts,
    createButton,
    capabilityCalls: () => capabilityCalls,
    resolve: (body) => capabilityRoute.fulfill(json(body)),
    resolveError: () => capabilityRoute.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "fixture: capability error" }) }),
  };
}

const guidedDialog = (page) => page.locator('[role="dialog"]');

for (const vp of WIDTHS) {
  const tag = `${vp.w}x${vp.h}`;

  test(`${tag}: pending click shows loading, opens nothing, then capability true opens Guided once`, async ({ page }) => {
    const run = await openHeldCapability(page, vp);
    await run.createButton.click();

    // Loading state: control visible, busy, labelled, disabled against duplicates.
    await expect(run.createButton).toHaveAttribute("aria-busy", "true");
    await expect(run.createButton).toBeDisabled();
    await expect(run.createButton).toContainText("Đang kiểm tra tính năng");
    const box = await run.createButton.boundingBox();
    await page.screenshot({ path: path.join(OUT, `${tag}-pending.png`) });

    // Hold the window open briefly: nothing may open or POST while pending.
    await page.waitForTimeout(800);
    await expect(guidedDialog(page)).toHaveCount(0);
    await expect(page.getByText(VALIDATION)).toHaveCount(0);
    expect(run.posts).toEqual([]);
    expect(run.capabilityCalls()).toBe(1);

    await run.resolve({ guided_mindmap_v3: true });
    await expect(guidedDialog(page)).toHaveCount(1);
    await expect(page.locator(".mm-map-selector__new")).toHaveCount(0); // library closed after settle
    await page.waitForTimeout(400);
    await expect(guidedDialog(page)).toHaveCount(1);
    expect(run.posts).toEqual([]);
    await page.screenshot({ path: path.join(OUT, `${tag}-guided-after-true.png`) });
    // Recorded for the report; the 40x40 target applies to the compact header controls.
    fs.writeFileSync(path.join(OUT, `${tag}-pending-box.json`), JSON.stringify({ box }, null, 1));
  });

  test(`${tag}: pending click, capability false runs legacy path once and never opens Guided`, async ({ page }) => {
    const run = await openHeldCapability(page, vp);
    await run.createButton.click();
    await expect(run.createButton).toHaveAttribute("aria-busy", "true");

    await page.waitForTimeout(400);
    await expect(guidedDialog(page)).toHaveCount(0);
    expect(run.posts).toEqual([]);

    await run.resolve({ guided_mindmap_v3: false });
    // No sources are selected in the fixture, so the legacy path shows its
    // validation toast and returns before any POST. Exactly one toast proves
    // the legacy branch ran once.
    await expect(page.getByText(VALIDATION)).toHaveCount(1);
    await page.waitForTimeout(400);
    await expect(guidedDialog(page)).toHaveCount(0);
    await expect(page.getByText(VALIDATION)).toHaveCount(1);
    expect(run.posts).toEqual([]);
    expect(run.capabilityCalls()).toBe(1);
  });

  test(`${tag}: pending click, capability error keeps the fail-closed fallback and never opens Guided`, async ({ page }) => {
    const run = await openHeldCapability(page, vp);
    await run.createButton.click();
    await run.resolveError();
    await expect(page.getByText(VALIDATION)).toHaveCount(1);
    await expect(guidedDialog(page)).toHaveCount(0);
    expect(run.posts).toEqual([]);
  });
}
