// Breakpoint audit for the global header (diagnostic, not a gate). Measures the full
// desktop header's natural width, then checks overflow and child boxes across widths.
import { test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.HEADER_AUDIT_DIR || path.join(process.cwd(), "qa-artifacts", "header-width-audit");
fs.mkdirSync(OUT, { recursive: true });

const API = /localhost:8080\//;
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function openApp(page, width, height) {
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
}

const MEASURE = () => {
  const header = document.querySelector("header");
  const hb = header.getBoundingClientRect();
  const kids = [...header.children].map((c) => {
    const b = c.getBoundingClientRect();
    return { tag: c.tagName.toLowerCase(), cls: String(c.getAttribute("class") || "").slice(0, 60), x: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) };
  });
  const groups = {};
  // natural width = sum of child widths + gaps (16px at sm/md, the header's own gap) + side padding
  const cs = getComputedStyle(header);
  const gap = parseFloat(cs.columnGap) || 0;
  const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight);
  const sum = kids.reduce((s, k) => s + k.w, 0);
  groups.naturalWidth = Math.round(sum + gap * (kids.length - 1) + padL + padR);
  return {
    viewport: [innerWidth, innerHeight],
    header: { h: Math.round(hb.height), scrollW: header.scrollWidth, clientW: header.clientWidth, gap, padL, padR },
    kids,
    naturalWidth: groups.naturalWidth,
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
  };
};

test("audit header natural width and overflow across breakpoints", async ({ page }) => {
  const widths = [320, 360, 390, 720, 768, 820, 912, 1024, 1280, 1440];
  const out = { widths: {} };
  await openApp(page, 1440, 1024);
  out.fullAt1440 = await page.evaluate(MEASURE);
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(150);
    out.widths[w] = await page.evaluate(MEASURE);
  }
  fs.writeFileSync(path.join(OUT, "audit.json"), JSON.stringify(out, null, 1));
});
