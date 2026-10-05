// Visual + measurement QA for the compact mobile header. Same mocked-API harness as
// mobile-header.spec.js; writes captures and a measurements JSON to MOBILE_HEADER_QA_DIR
// (defaults to ./qa-artifacts/mobile-header). Nothing here generates or calls a provider.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.MOBILE_HEADER_QA_DIR || path.join(process.cwd(), "qa-artifacts", "mobile-header");
fs.mkdirSync(OUT, { recursive: true });
const RESULTS = {};

const API = /localhost:8080\//;
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function openApp(page, { width, height, dark = false }) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(API, (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (pathname === "/usage/me") return route.fulfill(json({ plan: "Free", used: 120, reserved: 0, limit: 1000, remaining: 880, percentage: 12, reset_at: "2026-11-01T00:00:00Z", breakdown: {} }));
    if (pathname === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (pathname === "/list-indexed") return route.fulfill(json({ sources: [] }));
    if (pathname === "/api/documents") return route.fulfill(json({ documents: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app");
  await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor({ state: "visible", timeout: 30000 });
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
}

const headerMeasure = (page) => page.evaluate(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const header = document.querySelector("header");
  const nav = document.querySelector('nav[role="tablist"]');
  const controls = {
    home: 'header a[aria-label^="MemVidX"]',
    tabChat: 'nav[role="tablist"] [role="tab"][title="Trò chuyện"]',
    tabMindmap: 'nav[role="tablist"] [role="tab"][title="Sơ đồ tư duy"]',
    tabSummary: 'nav[role="tablist"] [role="tab"][title="Tóm tắt"]',
    tools: 'header button[aria-label="Mở công cụ StudyMap"]',
    usage: 'header button[aria-label^="Mức sử dụng AI"]',
    account: 'header button[aria-haspopup="menu"][aria-label^="Tài khoản"]',
  };
  const out = { header: { h: Math.round(header.getBoundingClientRect().height), scrollW: header.scrollWidth, clientW: header.clientWidth },
    nav: { box: r(nav), scrollW: nav.scrollWidth, clientW: nav.clientWidth, overflowX: getComputedStyle(nav).overflowX },
    page: { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }, controls: {} };
  for (const [k, sel] of Object.entries(controls)) {
    const el = document.querySelector(sel);
    if (!el) { out.controls[k] = null; continue; }
    const b = el.getBoundingClientRect();
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    out.controls[k] = { box: r(el), w: Math.round(b.width), h: Math.round(b.height),
      hitSelf: !!top && (top === el || el.contains(top)), atCenter: top ? top.tagName + "." + String(top.getAttribute("class") || "").slice(0, 36) : null };
  }
  const rows = new Set([...header.querySelectorAll("button, a")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => Math.round(e.getBoundingClientRect().top))).size;
  out.controlRowTops = rows;
  return out;
});

const VIEWPORTS = [
  { w: 320, h: 720, dark: false }, { w: 360, h: 800, dark: false }, { w: 360, h: 800, dark: true },
  { w: 390, h: 844, dark: false }, { w: 390, h: 844, dark: true },
  { w: 768, h: 1024, dark: false }, { w: 1024, h: 768, dark: false }, { w: 1440, h: 1024, dark: false },
];

for (const vp of VIEWPORTS) {
  const tag = `${vp.w}x${vp.h}-${vp.dark ? "dark" : "light"}`;
  test(`visual ${tag}`, async ({ page }) => {
    await openApp(page, { width: vp.w, height: vp.h, dark: vp.dark });
    const shots = {};
    const headerClip = { x: 0, y: 0, width: vp.w, height: 56 };
    RESULTS[tag] = { viewport: [vp.w, vp.h], modes: {} };

    for (const mode of ["Trò chuyện", "Sơ đồ tư duy", "Tóm tắt"]) {
      await page.getByRole("tab", { name: mode }).click();
      await page.waitForTimeout(250);
      const key = mode.replace(/\s/g, "");
      RESULTS[tag].modes[key] = await headerMeasure(page);
      await page.screenshot({ path: path.join(OUT, `${tag}-${key}-header.png`), clip: headerClip });
      shots[key] = true;
    }

    // Focus-visible on the selected mode tab (keyboard modality).
    await page.getByRole("tab", { name: "Trò chuyện" }).focus();
    await page.keyboard.press("Shift");
    await page.screenshot({ path: path.join(OUT, `${tag}-focus-tab-header.png`), clip: headerClip });

    // Workspace-tools menu.
    await page.locator('header button[aria-label="Mở công cụ StudyMap"]').click();
    const menu = page.getByRole("menu", { name: "Công cụ học" });
    await expect(menu).toBeVisible();
    RESULTS[tag].toolsMenu = await menu.boundingBox();
    await page.screenshot({ path: path.join(OUT, `${tag}-tools-menu.png`) });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    // Usage popover.
    await page.locator('header button[aria-label^="Mức sử dụng AI"]').click();
    const usage = page.getByRole("dialog", { name: "Mức sử dụng AI" });
    await expect(usage).toBeVisible();
    RESULTS[tag].usagePopover = await usage.boundingBox();
    await page.screenshot({ path: path.join(OUT, `${tag}-usage-popover.png`) });
    await page.keyboard.press("Escape");
    await expect(usage).toHaveCount(0);

    // Account menu.
    await page.locator('header button[aria-haspopup="menu"][aria-label^="Tài khoản"]').click();
    const acct = page.getByRole("menu").filter({ hasText: "qa@example.test" });
    await expect(acct).toBeVisible();
    RESULTS[tag].accountMenu = await acct.boundingBox();
    await page.screenshot({ path: path.join(OUT, `${tag}-account-menu.png`) });
    await page.keyboard.press("Escape");

    fs.writeFileSync(path.join(OUT, "measurements.json"), JSON.stringify(RESULTS, null, 1));
    expect(Object.keys(shots).length).toBe(3);
  });
}
