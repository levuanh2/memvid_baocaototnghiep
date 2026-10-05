// Visible-only repair deadline: the map initialises while the Chat tab is active
// (Mind Map pane hidden, container 0x0). The Chat tab is held for 11 s, longer than
// the old 10 s absolute deadline. After switching to Mind Map the map must be ready
// with no error banner, valid connectors, and the same mind-elixir instance.
// Same mocked-API harness as mobile-header-visual.spec.js. No backend, no provider.
import { test, expect } from "@playwright/test";

const API = /localhost:8080\//;
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const USAGE = { plan: "Free", used: 120, reserved: 0, limit: 1000, remaining: 880, percentage: 12, reset_at: "2026-11-01T00:00:00Z", breakdown: { chat: 120 } };
const MAP = {
  id: "map-visible-repair", title: "Visible repair fixture", schema_version: 3, sources: [], relations: [], content_hash: "h-visible",
  nodes: [
    { id: "map-visible-repair-root", kind: "root", title: "Chủ đề gốc", parent: null, order: 0 },
    { id: "map-visible-repair-a", kind: "section", title: "Nhánh một", parent: "map-visible-repair-root", order: 0 },
    { id: "map-visible-repair-b", kind: "section", title: "Nhánh hai", parent: "map-visible-repair-root", order: 1 },
  ],
  generator: { pipeline: "fixture", model: "fixture", elapsed_sec: 0, degraded: false, missing: [] },
};

async function openChatHeld(page, { width, height, dark }) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(API, (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (pathname === "/usage/me") return route.fulfill(json(USAGE));
    if (pathname === "/mindmaps") return route.fulfill(json({ mindmaps: [MAP] }));
    if (pathname === "/mindmaps/map-visible-repair") return route.fulfill(json(MAP));
    if (pathname === "/list-indexed") return route.fulfill(json({ sources: [] }));
    if (pathname === "/api/documents") return route.fulfill(json({ documents: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app");
  await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor({ state: "visible", timeout: 30000 });
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByRole("tab", { name: "Trò chuyện" }).click();
}

const VIEWPORTS = [
  { width: 390, height: 844, dark: false }, { width: 390, height: 844, dark: true },
  { width: 1024, height: 768, dark: false }, { width: 1024, height: 768, dark: true },
  { width: 1440, height: 1024, dark: false }, { width: 1440, height: 1024, dark: true },
];

for (const vp of VIEWPORTS) {
  const tag = `${vp.width}x${vp.height}-${vp.dark ? "dark" : "light"}`;
  test(`${tag}: held Chat for 11 s, then Mind Map is ready with valid connectors and no banner`, async ({ page }) => {
    await openChatHeld(page, vp);
    await page.waitForTimeout(11_000);
    await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();

    const wrap = page.locator("[data-mindmap-render-state]");
    await expect(wrap).toHaveAttribute("data-mindmap-render-state", "ready", { timeout: 3000 });
    await expect(page.locator(".mm-render-overlay.is-error")).toHaveCount(0);

    const check = await page.evaluate(() => {
      const paths = [...document.querySelectorAll(".lines path, .subLines path")];
      const invalid = paths.filter((p) => /NaN|undefined|Infinity/.test(p.getAttribute("d") || "")).length;
      const connectors = paths.filter((p) => (p.getAttribute("d") || "").trim()).length;
      const topics = [...document.querySelectorAll("me-tpc")].filter((t) => t.getBoundingClientRect().width > 0).length;
      return {
        invalid, connectors, topics,
        roots: document.querySelectorAll("me-root").length,
        canvas: document.querySelector(".map-canvas")?.style.transform || "",
      };
    });
    expect(check.invalid).toBe(0);
    expect(check.connectors).toBeGreaterThanOrEqual(2);
    expect(check.topics).toBe(3);
    // Tab activation re-creates the mind-elixir root element on the base build too, so the
    // invariant checked here is "exactly one live instance", not "same element as before".
    expect(check.roots).toBe(1);
  });
}
