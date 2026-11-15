// Mobile source drawer, keyboard and focus (V6 Wave 2/3): opening it puts focus inside, Escape
// closes it, and focus comes back to a visible control instead of falling to <body>.
import { test, expect } from "@playwright/test";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const STEM = "kinh-te-vi-mo";

async function openWorkspace(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(/localhost:8080\//, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [{ video: STEM, video_stem: STEM, filename: "Kinh tế vi mô.pdf", status: "index_ready", can_query: true }] }));
    return route.fulfill(json({}));
  });
  await page.goto(`/app?source=${STEM}`);
  await expect(page.locator("textarea").first()).toBeVisible();
}

const drawer = (page) => page.locator("aside").filter({ has: page.locator("[data-upload-cta]") }).first();
const focusInside = (page) => drawer(page).evaluate((el) => el.contains(document.activeElement));

test("opening the source drawer moves focus into it; Escape closes it and focus lands on a visible control", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Mở thư mục nguồn" }).first().click();
  await expect(drawer(page)).not.toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => focusInside(page)).toBe(true);

  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveAttribute("aria-hidden", "true");
  const active = await page.evaluate(() => {
    const el = document.activeElement;
    const r = el?.getBoundingClientRect();
    return { tag: el?.tagName, visible: !!r && r.width > 0 && r.height > 0 };
  });
  expect(active.tag).not.toBe("BODY");
  expect(active.visible).toBe(true);
});

test("Escape does not close the drawer while a dialog is open on top of it", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Mở thư mục nguồn" }).first().click();
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-modal", "true");
    d.id = "fake-dialog";
    document.body.appendChild(d);
  });
  await page.keyboard.press("Escape");
  await expect(drawer(page)).not.toHaveAttribute("aria-hidden", "true");
});
