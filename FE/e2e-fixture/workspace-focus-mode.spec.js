// V9.3 P4 — Workspace Focus Mode and phone side panels on the real app (Vite dev server, API
// mocked). Focus hides the secondary UI and keeps the mode switch; the typed chat draft
// survives entering/leaving it and toggling panels; no layout action sends /query; Escape
// leaves it and the layout before comes back; on phones only one side panel is open.
// Screenshots only when P4_SHOT_OUT is set.
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const OUT = process.env.P4_SHOT_OUT;
const TAG = process.env.P4_SHOT_TAG || "after";
if (OUT) mkdirSync(OUT, { recursive: true });

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const SOURCE = { video: "tai-lieu-1", video_stem: "tai-lieu-1", filename: "Tài liệu 1.pdf", status: "index_ready" };

async function openWorkspace(page, { width, dark = false }) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((isDark) => {
    localStorage.setItem("memvid-token", "fixture-token");
    localStorage.setItem("memvid-theme", isDark ? "dark" : "light");
  }, dark);
  const queries = [];
  await page.route(/localhost:8080\//, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/query" || p.startsWith("/stream")) queries.push(p);
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [SOURCE] }));
    if (p === "/api/documents" || p === "/api/library") return route.fulfill(json({ documents: [], collections: [] }));
    if (p === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (p === "/summaries") return route.fulfill(json({ summaries: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app?source=tai-lieu-1");
  await expect(page.locator("main#main-content")).toBeVisible();
  return queries;
}

const toggle = (page) => page.locator("button[data-focus-toggle]");
// Phones (<=480px) enter from the "Công cụ học" menu; wider screens from the header toggle.
async function enterFocus(page) {
  if (await toggle(page).isVisible()) return toggle(page).click();
  await page.getByRole("button", { name: "Mở công cụ học" }).click();
  await page.getByRole("menuitem", { name: "Tập trung" }).click();
}
const composer = (page) => page.locator("main textarea:visible").last();
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: path.join(OUT, `${name}-${TAG}.png`) }); };

for (const width of [390, 1024, 1440]) {
  for (const dark of [false, true]) {
    test(`${width}px ${dark ? "dark" : "light"}: focus keeps the draft and the mode switch, Escape restores the layout`, async ({ page }) => {
      const queries = await openWorkspace(page, { width, dark });
      const draft = "Nửa câu hỏi về độ co giãn của cầu";
      await expect(composer(page)).toBeVisible();
      await composer(page).fill(draft);
      const before = await page.evaluate(() => ({
        panels: localStorage.getItem("memvidx.panels.v1"),
        asides: [...document.querySelectorAll("aside")].map((a) => a.getAttribute("aria-hidden")),
      }));
      await shot(page, `workspace-${width}-${dark ? "dark" : "light"}`);

      await enterFocus(page);
      await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
      await expect(toggle(page)).toBeVisible();
      await expect(page.locator(".workspace-mode-switch")).toBeVisible();
      await expect(page.locator(".workspace-home-link")).toBeHidden();
      await expect(page.locator(".study-library-link")).toBeHidden();
      await expect(page.locator("nav.app-bottom-nav")).toBeHidden();
      await expect(composer(page)).toHaveValue(draft);
      const vw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(vw, "horizontal overflow in focus").toBeLessThanOrEqual(0);
      await shot(page, `workspace-focus-${width}-${dark ? "dark" : "light"}`);

      await page.keyboard.press("Escape");
      await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator(".workspace-home-link")).toBeVisible();
      await expect(composer(page)).toHaveValue(draft);
      const after = await page.evaluate(() => ({
        panels: localStorage.getItem("memvidx.panels.v1"),
        asides: [...document.querySelectorAll("aside")].map((a) => a.getAttribute("aria-hidden")),
      }));
      expect(after).toEqual(before);
      expect(queries, "no question sent by layout actions").toEqual([]);
    });
  }
}

test("1024px: the focus toggle is reachable by keyboard and named for what it does", async ({ page }) => {
  await openWorkspace(page, { width: 1024 });
  await toggle(page).focus();
  await expect(toggle(page)).toHaveAccessibleName("Tập trung");
  await page.keyboard.press("Enter");
  await expect(toggle(page)).toHaveAccessibleName("Thoát tập trung");
  await expect(toggle(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
});

test("390px: opening the evidence sheet closes the source drawer", async ({ page }) => {
  await openWorkspace(page, { width: 390 });
  await page.getByRole("button", { name: "Mở công cụ học" }).click();
  await page.getByRole("menuitem", { name: "Mở thư mục nguồn" }).click();
  const left = page.locator("aside").first();
  await expect(left).not.toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Mở công cụ học" }).click();
  await page.getByRole("menuitem", { name: "Mở công cụ" }).click();
  await expect(page.locator("aside.context-inspector-shell")).not.toHaveAttribute("aria-hidden", "true");
  await expect(left).toHaveAttribute("aria-hidden", "true");
});

test("390px: the header keeps its one 56px row; focus is entered from the tools menu", async ({ page }) => {
  await openWorkspace(page, { width: 390 });
  await expect(toggle(page)).toBeHidden();
  const overflow = await page.evaluate(() => { const h = document.querySelector("header"); return h.scrollWidth - h.clientWidth; });
  expect(overflow).toBeLessThanOrEqual(0);
  await enterFocus(page);
  await expect(toggle(page)).toBeVisible();
  await expect(toggle(page)).toHaveAccessibleName("Thoát tập trung");
  await toggle(page).click();
  await expect(toggle(page)).toBeHidden();
});
