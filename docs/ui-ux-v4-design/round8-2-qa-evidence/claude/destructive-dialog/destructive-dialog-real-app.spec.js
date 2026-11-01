// Round 8.2 audit probe (Claude): the REAL destructive confirm dialog in the
// real app (c02e2b9 build :4173, protected Flask :8080, disposable Postgres).
// Flow: Library -> "Sửa <collection>" -> keyboard Tab to "Xoá" -> Enter ->
// DestructiveConfirmDialog. Measures dark-mode contrast against the composited
// stack under each text node and Escape focus restoration with a network log.
import { expect, test } from "@playwright/test";
import { registerAndEnterApp } from "../e2e/fixtures.js";

const API = "http://127.0.0.1:8080";
const NAME = `R82 bộ sưu tập ${Date.now()}`;

// Composite every painted background under (x, y) bottom-up, then compute the
// WCAG contrast of the element's own text colour against that result.
const MEASURE = ([sel, idx]) => {
  const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const over = (top, bot) => { const a = top.a + bot.a * (1 - top.a); return a === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a }; };
  const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const el = document.querySelectorAll(sel)[idx];
  const box = el.getBoundingClientRect();
  const x = box.left + Math.min(4, box.width / 2), y = box.top + box.height / 2;
  const stack = document.elementsFromPoint(x, y);
  let bg = { r: 255, g: 255, b: 255, a: 1 }; // canvas
  const layers = [];
  for (const node of [...stack].reverse()) {
    const cs = getComputedStyle(node);
    const c = parse(cs.backgroundColor);
    const op = Number(cs.opacity);
    if (c.a > 0) { const layer = { ...c, a: c.a * op }; bg = over(layer, bg); layers.push(`${node.tagName.toLowerCase()}.${String(node.className).split(" ")[0]} ${cs.backgroundColor}`); }
  }
  const fg = over(parse(getComputedStyle(el).color), bg);
  const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return { text: el.textContent.trim().slice(0, 60), color: getComputedStyle(el).color, fontSize: getComputedStyle(el).fontSize, composited: `rgb(${bg.r.toFixed(1)}, ${bg.g.toFixed(1)}, ${bg.b.toFixed(1)})`, layers, ratio: Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100 };
};

test("real collection delete dialog: dark contrast, keyboard open, Escape restores focus, no DELETE", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("memvid-theme", "dark"));
  await registerAndEnterApp(page);
  const token = await page.evaluate(() => localStorage.getItem("memvid-token"));
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request.post(`${API}/api/collections`, { headers, data: { name: NAME } });
  expect(created.ok(), `POST /api/collections -> ${created.status()}`).toBeTruthy();

  const network = [];
  page.on("request", (r) => { if (r.url().startsWith(API) && r.method() !== "GET" && r.method() !== "OPTIONS") network.push(`${r.method()} ${new URL(r.url()).pathname}`); });

  await page.goto("/app/study");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: `Sửa ${NAME}` }).click();
  await expect(page.getByLabel("Tên bộ sưu tập")).toBeFocused();

  // Real Tab presses from the autofocused name input to the "Xoá" trigger.
  const trigger = page.getByRole("button", { name: "Xoá", exact: true });
  let tabs = 0;
  while (!(await trigger.evaluate((el) => el === document.activeElement)) && tabs < 20) { await page.keyboard.press("Tab"); tabs += 1; }
  expect(await trigger.evaluate((el) => el === document.activeElement), `trigger reached by ${tabs} Tab presses`).toBe(true);

  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement)))).toBe(true);
  const focusedInside = await page.evaluate(() => `${document.activeElement.tagName.toLowerCase()} "${(document.activeElement.getAttribute("aria-label") || document.activeElement.textContent || "").trim().slice(0, 40)}"`);

  await page.waitForTimeout(800); // let the enter transition finish (opacity 1)
  const contrast = {
    title: await page.evaluate(MEASURE, ['[role="dialog"] p.text-body', 0]),
    consequence: await page.evaluate(MEASURE, ['[role="dialog"] p.text-small.text-text-secondary', 0]),
    acknowledgement: await page.evaluate(MEASURE, ['[role="dialog"] .destructive-confirm__ack span', 0]),
  };
  await page.screenshot({ path: test.info().outputPath("destructive-dark.png") });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => `${document.activeElement.tagName.toLowerCase()} "${(document.activeElement.getAttribute("aria-label") || document.activeElement.textContent || "").trim().slice(0, 40)}"`);
  const triggerStillMounted = (await trigger.count()) > 0;
  const restoredToTrigger = triggerStillMounted ? await trigger.evaluate((el) => el === document.activeElement) : false;

  const list = await (await request.get(`${API}/api/collections`, { headers })).json();
  const stillThere = JSON.stringify(list).includes(NAME);

  test.info().annotations.push({ type: "result", description: JSON.stringify({ tabs, focusedInside, after, triggerStillMounted, restoredToTrigger, writes: network, stillThere, contrast }) });

  expect(network.filter((n) => n.startsWith("DELETE")), "Escape sends no DELETE").toEqual([]);
  expect(stillThere, "collection still exists on the server").toBe(true);
  for (const [k, v] of Object.entries(contrast)) expect(v.ratio, `${k} contrast`).toBeGreaterThanOrEqual(4.5);
  expect(restoredToTrigger, `focus after Escape: ${after}`).toBe(true);
});
