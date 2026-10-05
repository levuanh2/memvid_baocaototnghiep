// Visual + measurement QA for the global header across the release matrix. Same mocked-API
// harness as mobile-header.spec.js. Writes captures and measurements.json to
// MOBILE_HEADER_QA_DIR (default ./qa-artifacts/mobile-header). No generation, no provider.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.MOBILE_HEADER_QA_DIR || path.join(process.cwd(), "qa-artifacts", "mobile-header");
fs.mkdirSync(OUT, { recursive: true });
const RESULTS = {};

const API = /localhost:8080\//;
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const USAGE = { plan: "Free", used: 120, reserved: 0, limit: 1000, remaining: 880, percentage: 12, reset_at: "2026-11-01T00:00:00Z", breakdown: { chat: 120 } };
const MAP = {
  id: "map-a", title: "Bản đồ A", schema_version: 2, sources: [], relations: [], content_hash: "h1",
  nodes: [
    { id: "map-a-root", kind: "root", title: "Chủ đề gốc", parent: null, order: 0 },
    { id: "map-a-m0", kind: "section", title: "Nhánh một", parent: "map-a-root", order: 0 },
    { id: "map-a-m1", kind: "section", title: "Nhánh hai", parent: "map-a-root", order: 1 },
  ],
  generator: { pipeline: "fixture", model: "fixture", elapsed_sec: 0, degraded: false, missing: [] },
};

async function openApp(page, { width, height, dark }) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(API, (route) => {
    const { pathname } = new URL(route.request().url());
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
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
}

const measure = (page) => page.evaluate(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const header = document.querySelector("header");
  const nav = document.querySelector('nav[role="tablist"]');
  const sel = {
    home: 'header a[aria-label^="MemVidX"]',
    tabChat: 'nav[role="tablist"] [role="tab"][title="Trò chuyện"]',
    tabMindmap: 'nav[role="tablist"] [role="tab"][title="Sơ đồ tư duy"]',
    tabSummary: 'nav[role="tablist"] [role="tab"][title="Tóm tắt"]',
    tools: 'header button[aria-label="Mở công cụ StudyMap"]',
    usage: 'header button[aria-label^="Mức sử dụng AI"]',
    account: 'header button[aria-haspopup="menu"][aria-label^="Tài khoản"]',
  };
  const controls = {};
  for (const [k, s] of Object.entries(sel)) {
    const el = document.querySelector(s);
    if (!el) { controls[k] = null; continue; }
    const b = el.getBoundingClientRect();
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    controls[k] = { box: r(el), w: Math.round(b.width), h: Math.round(b.height), hitSelf: !!top && (top === el || el.contains(top)), atCenter: top ? top.tagName + "." + String(top.getAttribute("class") || "").slice(0, 36) : null };
  }
  const library = document.querySelector('button[aria-label="Mở thư viện sơ đồ"]');
  return {
    header: { h: Math.round(header.getBoundingClientRect().height), scrollW: header.scrollWidth, clientW: header.clientWidth, box: r(header) },
    variant: getComputedStyle(nav).overflowX !== undefined && header.getBoundingClientRect().width > 0 && (window.innerWidth < 1024 ? "compact" : "full"),
    nav: { box: r(nav), scrollW: nav.scrollWidth, clientW: nav.clientWidth, overflowX: getComputedStyle(nav).overflowX },
    page: { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth },
    controls,
    minTarget: Math.min(...Object.values(controls).filter(Boolean).map((c) => Math.min(c.w, c.h))),
    contextualRow: library ? { top: Math.round(library.getBoundingClientRect().top), box: r(library) } : null,
  };
});

const MATRIX = [
  { w: 320, h: 720, dark: false }, { w: 360, h: 800, dark: false }, { w: 360, h: 800, dark: true },
  { w: 390, h: 844, dark: false }, { w: 390, h: 844, dark: true },
  { w: 720, h: 900, dark: false },
  { w: 768, h: 1024, dark: false }, { w: 768, h: 1024, dark: true },
  { w: 820, h: 1180, dark: false },
  { w: 912, h: 1368, dark: false },
  { w: 1024, h: 768, dark: false }, { w: 1024, h: 768, dark: true },
  { w: 1440, h: 1024, dark: false }, { w: 1440, h: 1024, dark: true },
];

for (const vp of MATRIX) {
  const tag = `${vp.w}x${vp.h}-${vp.dark ? "dark" : "light"}`;
  test(`visual ${tag}`, async ({ page }) => {
    await openApp(page, { width: vp.w, height: vp.h, dark: vp.dark });
    const clip = { x: 0, y: 0, width: vp.w, height: 56 };
    RESULTS[tag] = { viewport: [vp.w, vp.h], modes: {} };
    for (const mode of ["Trò chuyện", "Sơ đồ tư duy", "Tóm tắt"]) {
      await page.getByRole("tab", { name: mode }).click();
      await page.waitForTimeout(250);
      const key = mode.replace(/\s/g, "");
      RESULTS[tag].modes[key] = await measure(page);
      await page.screenshot({ path: path.join(OUT, `${tag}-${key}-header.png`), clip });
    }
    // Focus-visible on the first mode tab (keyboard modality).
    await page.getByRole("tab", { name: "Trò chuyện" }).focus();
    await page.keyboard.press("Shift");
    await page.screenshot({ path: path.join(OUT, `${tag}-focus-tab-header.png`), clip });

    await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
    await page.locator('header button[aria-label="Mở công cụ StudyMap"]').click();
    const tools = page.getByRole("menu", { name: "Công cụ học" });
    await expect(tools).toBeVisible();
    RESULTS[tag].toolsMenu = await tools.boundingBox();
    await page.screenshot({ path: path.join(OUT, `${tag}-tools-menu.png`) });
    await page.keyboard.press("Escape");

    await page.locator('header button[aria-label^="Mức sử dụng AI"]').click();
    const usage = page.getByRole("dialog", { name: "Mức sử dụng AI" });
    await expect(usage).toBeVisible();
    RESULTS[tag].usagePopover = await usage.boundingBox();
    await page.screenshot({ path: path.join(OUT, `${tag}-usage-popover.png`) });
    await page.keyboard.press("Escape");

    await page.locator('header button[aria-haspopup="menu"][aria-label^="Tài khoản"]').click();
    const acct = page.getByRole("menu").filter({ hasText: "qa@example.test" });
    await expect(acct).toBeVisible();
    RESULTS[tag].accountMenu = await acct.boundingBox();
    await page.screenshot({ path: path.join(OUT, `${tag}-account-menu.png`) });
    await page.keyboard.press("Escape");

    fs.writeFileSync(path.join(OUT, "measurements.json"), JSON.stringify(RESULTS, null, 1));
  });
}
