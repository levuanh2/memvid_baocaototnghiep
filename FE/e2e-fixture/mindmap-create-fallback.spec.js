// P0-2 (V4.1 audit D03): the Mind Map empty-state "Tạo sơ đồ tư duy" must never
// dead-end. It uses the same create route as the toolbar's "Tạo sơ đồ mới":
// Guided ON -> Guided dialog; OFF or capability error -> legacy generation;
// capability still loading -> one parked intent, run once when it settles.
// Real app on the Vite dev server, API mocked at the network layer.
import { test, expect } from "@playwright/test";

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const MAP = {
  id: "map-new", title: "Sơ đồ mới", schema_version: 2, sources: ["tai-lieu-1"], relations: [], content_hash: "h1",
  nodes: [
    { id: "r", kind: "root", title: "Chủ đề", parent: null, order: 0 },
    { id: "a", kind: "section", title: "Nhánh A", parent: "r", order: 0 },
  ],
  generator: { pipeline: "fixture", model: "fixture", elapsed_sec: 0, degraded: false, missing: [] },
};

async function openMindmapMode(page, { capability = "disabled", capabilityDelayMs = 0, maps = [] } = {}) {
  const posts = [];
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(/localhost:8080\//, async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p === "/generate-mindmap" && req.method() === "POST") {
      posts.push(req.postDataJSON());
      await new Promise((r) => setTimeout(r, 400));
      return route.fulfill(json({ status: "done", result: MAP }));
    }
    if (p === "/mindmaps/capability") {
      if (capabilityDelayMs) await new Promise((r) => setTimeout(r, capabilityDelayMs));
      if (capability === "error") return route.fulfill(json({ error: "boom" }, 500));
      return route.fulfill(json({ guided_mindmap_v3: capability === "enabled" }));
    }
    if (p === "/mindmaps/suggest-topics") return route.fulfill(json({ topics: [] }));
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [{ video: "tai-lieu-1", video_stem: "tai-lieu-1", filename: "Hệ điều hành.pdf", status: "index_ready" }] }));
    if (p === "/mindmaps") return route.fulfill(json({ mindmaps: maps }));
    if (p.startsWith("/mindmaps/")) return route.fulfill(json(maps[0] || MAP));
    if (p === "/summaries") return route.fulfill(json({ summaries: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app?source=tai-lieu-1&tab=mindmap");
  await expect(page.locator('[role="tab"][title="Sơ đồ tư duy"][aria-selected="true"]')).toBeVisible();
  return posts;
}

const centreCta = (page) => page.locator("main").getByRole("button", { name: "Tạo sơ đồ tư duy" });
const guidedDialog = (page) => page.getByRole("dialog", { name: /Tạo sơ đồ tư duy/ });

test("Guided OFF: the centre button starts exactly one legacy generation on a double click", async ({ page }) => {
  const posts = await openMindmapMode(page, { capability: "disabled" });
  await page.waitForTimeout(500); // let the capability settle
  await centreCta(page).dblclick();
  await expect.poll(() => posts.length).toBe(1);
  await page.waitForTimeout(800);
  expect(posts).toHaveLength(1);
  expect(posts[0].sources).toEqual(["tai-lieu-1"]);
  await expect(guidedDialog(page)).toHaveCount(0);
});

test("Guided ON: the centre button opens the Guided dialog and sends no legacy request", async ({ page }) => {
  const posts = await openMindmapMode(page, { capability: "enabled" });
  await page.waitForTimeout(500);
  await centreCta(page).click();
  await expect(guidedDialog(page)).toBeVisible();
  expect(posts).toHaveLength(0);
});

test("capability fetch failure: falls back to the legacy generation", async ({ page }) => {
  const posts = await openMindmapMode(page, { capability: "error" });
  await page.waitForTimeout(500);
  await centreCta(page).click();
  await expect.poll(() => posts.length).toBe(1);
});

test("capability still loading: clicks park one intent that runs once when it settles", async ({ page }) => {
  const posts = await openMindmapMode(page, { capability: "disabled", capabilityDelayMs: 2500 });
  await centreCta(page).click();
  await centreCta(page).click({ timeout: 1000 }).catch(() => {}); // may already show the waiting state
  await expect.poll(() => posts.length, { timeout: 10_000 }).toBe(1);
  await page.waitForTimeout(800);
  expect(posts).toHaveLength(1);
});

test("keyboard: Enter on the centre button starts the creation", async ({ page }) => {
  const posts = await openMindmapMode(page, { capability: "disabled" });
  await page.waitForTimeout(500);
  await centreCta(page).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => posts.length).toBe(1);
});

test("existing map: no centre button; the toolbar still offers 'Tạo sơ đồ mới'", async ({ page }) => {
  await openMindmapMode(page, { capability: "disabled", maps: [MAP] });
  await expect(centreCta(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Mở thư viện sơ đồ" }).click();
  await expect(page.getByRole("button", { name: /Tạo sơ đồ mới/ })).toBeVisible();
});
