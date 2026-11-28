// V9.3 P4b — "Nguồn" / "Dẫn chứng" header controls and the narrow-screen "Chế độ học" select
// on the real app (Vite dev server, API mocked, fake data only). Checks, per width and theme:
// one 56px header row without overflow, the right mode control, named panel controls with
// aria-expanded, the typed draft kept through every toggle and mode change, and no question
// sent by any layout action. Screenshots only when P4B_SHOT_OUT is set.
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { MODE_SELECT, chooseMode } from "./workspaceMode.js";

const OUT = process.env.P4B_SHOT_OUT;
const TAG = process.env.P4B_SHOT_TAG || "after";
if (OUT) mkdirSync(OUT, { recursive: true });

const STORE = "memvidx.panels.v1";
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const SOURCE = { video: "tai-lieu-1", video_stem: "tai-lieu-1", filename: "Tài liệu 1.pdf", status: "index_ready" };

async function openWorkspace(page, { width, height = 900, dark = false, stored = null }) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(({ isDark, layout, key }) => {
    localStorage.setItem("memvid-token", "fixture-token");
    localStorage.setItem("memvid-theme", isDark ? "dark" : "light");
    if (layout && !sessionStorage.getItem("seeded")) {
      localStorage.setItem(key, JSON.stringify(layout));
      sessionStorage.setItem("seeded", "1");
    }
  }, { isDark: dark, layout: stored, key: STORE });
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

const sourcesButton = (page) => page.locator("header button[data-panel-toggle='sources']");
const evidenceButton = (page) => page.locator("header button[data-panel-toggle='evidence']");
const composer = (page) => page.locator("main textarea:visible").last();
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: path.join(OUT, `${name}-${TAG}.png`) }); };
const overflow = (page) => page.evaluate(() => {
  const h = document.querySelector("header");
  return {
    height: Math.round(h.getBoundingClientRect().height),
    header: h.scrollWidth - h.clientWidth,
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

// 640px stands in for a 1280px window at 200% zoom.
for (const width of [320, 375, 390, 640, 700, 768, 1024, 1440]) {
  for (const dark of [false, true]) {
    test(`${width}px ${dark ? "dark" : "light"}: header fits, controls are named, the draft survives panels and modes`, async ({ page }) => {
      const queries = await openWorkspace(page, { width, dark });
      const o = await overflow(page);
      expect(o.height).toBe(56);
      expect(o.header, "header overflow").toBeLessThanOrEqual(0);
      expect(o.doc, "page overflow").toBeLessThanOrEqual(0);

      // Mode control: the labelled select below 1600px, the tab row from 1600px.
      if (width < 1600) {
        await expect(page.getByLabel("Chế độ học")).toBeVisible();
        await expect(page.getByRole("tablist", { name: "Chế độ Workspace" })).toBeHidden();
        // The first version clipped "Trò chuyện" to "Trò chuyệ" at 375px (native arrow inside a
        // fixed width). The drawn chevron sits in the right padding, so the text box is what is left.
        const fit = await page.locator(MODE_SELECT).evaluate((el) => {
          const cs = getComputedStyle(el);
          const ctx = document.createElement("canvas").getContext("2d");
          ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          return {
            appearance: cs.appearance,
            longest: Math.max(...[...el.options].map((o) => ctx.measureText(o.text).width)),
            room: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
          };
        });
        expect(fit.appearance).toBe("none");
        expect(fit.longest, "longest mode label fits inside the select").toBeLessThanOrEqual(fit.room);
      } else {
        await expect(page.getByRole("tablist", { name: "Chế độ Workspace" })).toBeVisible();
        await expect(page.locator(MODE_SELECT)).toBeHidden();
      }

      const draft = "Nửa câu hỏi về độ co giãn của cầu";
      await composer(page).fill(draft);
      await shot(page, `controls-${width}-${dark ? "dark" : "light"}`);

      if (width <= 480) {
        // Phones: no room in the header; both panels open from the tools menu.
        await expect(sourcesButton(page)).toBeHidden();
        await expect(evidenceButton(page)).toBeHidden();
        const tools = page.getByRole("button", { name: "Mở công cụ học" });
        for (const name of ["Nguồn", "Dẫn chứng"]) {
          await tools.click();
          const item = page.getByRole("menuitemcheckbox", { name });
          await expect(item).toHaveAttribute("aria-checked", "false");
          await item.click();
          await tools.click();
          await expect(page.getByRole("menuitemcheckbox", { name })).toHaveAttribute("aria-checked", "true");
          await page.getByRole("menuitemcheckbox", { name }).click();
        }
      } else {
        for (const [button, name] of [[sourcesButton(page), "Nguồn"], [evidenceButton(page), "Dẫn chứng"]]) {
          await expect(button).toBeVisible();
          await expect(button).toHaveAccessibleName(name);
          const box = await button.boundingBox();
          expect(box.width).toBeGreaterThanOrEqual(40);
          expect(box.height).toBeGreaterThanOrEqual(40);
        }
        for (const button of [evidenceButton(page), evidenceButton(page), sourcesButton(page), sourcesButton(page)]) {
          const before = await button.getAttribute("aria-expanded");
          await button.click();
          await expect(button).toHaveAttribute("aria-expanded", before === "true" ? "false" : "true");
          if (width < 768 && (await button.getAttribute("aria-expanded")) === "true") {
            // A drawer covers the header on phones and small tablets: close it as a user would.
            await page.keyboard.press("Escape");
          }
        }
      }

      for (const mode of ["Tóm tắt", "Sơ đồ tư duy", "Đọc nguồn", "Trò chuyện"]) await chooseMode(page, mode);
      await expect(composer(page)).toHaveValue(draft);
      const after = await overflow(page);
      expect(after.header).toBeLessThanOrEqual(0);
      expect(queries, "no question sent by layout or mode actions").toEqual([]);
    });
  }
}

test("1440px: evidence starts closed with no saved layout, sources open", async ({ page }) => {
  await openWorkspace(page, { width: 1440 });
  await expect(evidenceButton(page)).toHaveAttribute("aria-expanded", "false");
  await expect(sourcesButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#workspace-evidence")).toHaveAttribute("aria-hidden", "true");
  await expect(evidenceButton(page)).toHaveAttribute("aria-controls", "workspace-evidence");
  await expect(sourcesButton(page)).toHaveAttribute("aria-controls", "workspace-sources");
});

test("1440px: a saved layout with evidence open is kept, and toggling saves it", async ({ page }) => {
  await openWorkspace(page, { width: 1440, stored: { width: { left: 252, right: 360 }, collapsed: { left: false, right: false } } });
  await expect(evidenceButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#workspace-evidence")).not.toHaveAttribute("aria-hidden", "true");
  await evidenceButton(page).click();
  await expect(evidenceButton(page)).toHaveAttribute("aria-expanded", "false");
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).collapsed, STORE);
  expect(saved).toEqual({ left: false, right: true });
  await page.reload();
  await expect(evidenceButton(page)).toHaveAttribute("aria-expanded", "false");
});

test("700px: one side drawer at a time", async ({ page }) => {
  await openWorkspace(page, { width: 700 });
  await sourcesButton(page).click();
  await expect(page.locator("#workspace-sources")).not.toHaveAttribute("aria-hidden", "true");
  // The open drawer and its backdrop cover the page; the header control stays reachable.
  await evidenceButton(page).click();
  await expect(evidenceButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(sourcesButton(page)).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#workspace-sources")).toHaveAttribute("aria-hidden", "true");
});

test("1024px keyboard: Enter and Space toggle the panel controls and focus stays on them", async ({ page }) => {
  await openWorkspace(page, { width: 1024 });
  for (const [button, key] of [[evidenceButton(page), "Enter"], [sourcesButton(page), "Space"]]) {
    await button.focus();
    const before = await button.getAttribute("aria-expanded");
    await page.keyboard.press(key);
    await expect(button).toHaveAttribute("aria-expanded", before === "true" ? "false" : "true");
    await expect(button).toBeFocused();
    await page.keyboard.press(key);
    await expect(button).toHaveAttribute("aria-expanded", before);
  }
});

test("390px keyboard: the mode select changes mode with the arrow keys", async ({ page }) => {
  await openWorkspace(page, { width: 390 });
  const select = page.getByLabel("Chế độ học");
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('nav[role="tablist"] [role="tab"][title="Đọc nguồn"]')).toHaveAttribute("aria-selected", "true");
  await expect(select).toBeFocused();
});

test("1440px Focus Mode: evidence opens without leaving focus or saving; a dialog keeps Escape", async ({ page }) => {
  const queries = await openWorkspace(page, { width: 1440, stored: { width: { left: 252, right: 360 }, collapsed: { left: false, right: true } } });
  const stored = await page.evaluate((k) => localStorage.getItem(k), STORE);
  const toggle = page.locator("button[data-focus-toggle]");
  await toggle.click();
  await expect(sourcesButton(page)).toBeHidden();
  await expect(evidenceButton(page)).toBeVisible();
  await evidenceButton(page).click();
  await expect(evidenceButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await shot(page, "focus-evidence-1440");

  // The shortcut help dialog takes Escape first; Focus Mode is still on after it closes.
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Phím tắt" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(evidenceButton(page)).toHaveAttribute("aria-expanded", "false");
  await expect(sourcesButton(page)).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), STORE)).toBe(stored);
  expect(queries).toEqual([]);
});

test("390px Focus Mode: Dẫn chứng is back in the emptied header and the row still fits", async ({ page }) => {
  await openWorkspace(page, { width: 390 });
  await expect(evidenceButton(page)).toBeHidden();
  await page.getByRole("button", { name: "Mở công cụ học" }).click();
  await page.getByRole("menuitem", { name: "Tập trung" }).click();
  await expect(evidenceButton(page)).toBeVisible();
  await expect(sourcesButton(page)).toBeHidden();
  await evidenceButton(page).click();
  await expect(evidenceButton(page)).toHaveAttribute("aria-expanded", "true");
  const o = await overflow(page);
  expect(o.header).toBeLessThanOrEqual(0);
  await shot(page, "focus-evidence-390");
});

// Codex P1 (#208): tools from "Công cụ học" must open a collapsed desktop column.
for (const [width, stored] of [[1440, null], [1024, { width: { left: 252, right: 360 }, collapsed: { left: true, right: true } }]]) {
  test(`${width}px ${stored ? "saved collapsed" : "first run"}: Gia sư AI from the tools menu opens the column`, async ({ page }) => {
    await openWorkspace(page, { width, stored });
    await expect(page.locator("#workspace-evidence")).toHaveAttribute("aria-hidden", "true");
    await page.getByRole("button", { name: "Mở công cụ học" }).click();
    await page.getByRole("menuitem", { name: /Gia sư AI/ }).click();
    await expect(page.locator("#workspace-evidence")).not.toHaveAttribute("aria-hidden", "true");
    const width0 = await page.locator("#workspace-evidence").evaluate((el) => el.getBoundingClientRect().width);
    expect(width0).toBeGreaterThan(300);
  });
}

// Codex P2 (#208): the tools menu follows the menu keyboard pattern.
test("390px: tools menu takes focus and moves with the arrow keys, Home and End", async ({ page }) => {
  await openWorkspace(page, { width: 390 });
  await page.getByRole("button", { name: "Mở công cụ học" }).focus();
  await page.keyboard.press("Enter");
  const items = page.getByRole("menu", { name: "Công cụ học" }).locator('[role^="menuitem"]');
  const count = await items.count();
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(items.nth(count - 1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(items.nth(count - 1)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Mở công cụ học" })).toBeFocused();
});
