import { test, expect } from "@playwright/test";

const API = "http://127.0.0.1:8380";

export function freshTestUser() {
  const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return {
    email: `e2e-${id}@example.test`,
    password: "E2E-test-password-1",
    displayName: "E2E Test User",
  };
}

export async function registerAndEnterApp(page, user = freshTestUser()) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(user.password);
  await page.getByLabel("Nhập lại mật khẩu").fill(user.password);
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();
  await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor({ state: "visible" });
  return user;
}

const MEASURE = ([sel, idx]) => {
  const parse = (c) => {
    const m = (c || "").match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 1];
    return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
  };
  const over = (top, bot) => {
    const a = top.a + bot.a * (1 - top.a);
    return a === 0
      ? { r: 0, g: 0, b: 0, a: 0 }
      : {
          r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a,
          g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a,
          b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a,
          a,
        };
  };
  const lum = ({ r, g, b }) =>
    [r, g, b]
      .map((v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      })
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);

  const el = document.querySelectorAll(sel)[idx];
  if (!el) return { text: "NOT FOUND", ratio: 0, fg: "none", bg: "none" };
  const box = el.getBoundingClientRect();
  const x = box.left + Math.min(4, box.width / 2);
  const y = box.top + box.height / 2;
  const stack = document.elementsFromPoint(x, y);
  let bg = { r: 255, g: 255, b: 255, a: 1 };
  const layers = [];
  for (const node of [...stack].reverse()) {
    const cs = getComputedStyle(node);
    const c = parse(cs.backgroundColor);
    const op = Number(cs.opacity);
    if (c.a > 0) {
      const layer = { ...c, a: c.a * op };
      bg = over(layer, bg);
      layers.push(`${node.tagName.toLowerCase()}.${String(node.className).split(" ")[0]} ${cs.backgroundColor}`);
    }
  }
  const rawFg = parse(getComputedStyle(el).color);
  const fg = over(rawFg, bg);
  const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return {
    text: el.textContent.trim().slice(0, 60),
    color: getComputedStyle(el).color,
    fontSize: getComputedStyle(el).fontSize,
    compositedBg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
    compositedFg: `rgb(${Math.round(fg.r)}, ${Math.round(fg.g)}, ${Math.round(fg.b)})`,
    layers,
    ratio: Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100,
  };
};

const getActiveElementDesc = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return "null";
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const colId = el.getAttribute("data-collection-id") ? `[data-collection-id="${el.getAttribute("data-collection-id")}"]` : "";
    const role = el.getAttribute("role") ? `[role="${el.getAttribute("role")}"]` : "";
    const ariaLabel = el.getAttribute("aria-label") ? `[aria-label="${el.getAttribute("aria-label")}"]` : "";
    const name = el.getAttribute("name") ? `[name="${el.getAttribute("name")}"]` : "";
    const text = (el.textContent || "").trim().slice(0, 30);
    const cls = el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    return `${tag}${id}${colId}${role}${ariaLabel}${name}${cls} "${text}"`;
  });

test.describe("Real-App Destructive Dialogs Suite — Round 8.5", () => {
  test.setTimeout(120_000);

  test("1. Collection Delete Dialog (Library) — Regression & Dual-Theme Contrast", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => localStorage.setItem("memvid-theme", "dark"));
    await registerAndEnterApp(page);

    const token = await page.evaluate(() => localStorage.getItem("memvid-token"));
    const headers = { Authorization: `Bearer ${token}` };

    // Seed 2 collections
    const name1 = `Bộ sưu tập Alpha ${Date.now()}`;
    const name2 = `Bộ sưu tập Beta ${Date.now()}`;
    const res1 = await request.post(`${API}/api/collections`, { headers, data: { name: name1 } });
    const res2 = await request.post(`${API}/api/collections`, { headers, data: { name: name2 } });
    expect(res1.ok()).toBe(true);
    expect(res2.ok()).toBe(true);
    const col1 = await res1.json();
    const col2 = await res2.json();
    const col1Id = col1.collection_id;
    const col2Id = col2.collection_id;

    const network = [];
    page.on("request", (r) => {
      if (r.url().startsWith(API) && r.method() !== "GET" && r.method() !== "OPTIONS") {
        network.push(`${r.method()} ${new URL(r.url()).pathname}`);
      }
    });

    await page.goto("/app/study");
    await expect(page.locator("html")).toHaveClass(/dark/);

    // Reach trigger with Tab
    await page.getByRole("button", { name: `Sửa ${name1}` }).click();
    await expect(page.getByLabel("Tên bộ sưu tập")).toBeFocused();

    const trigger = page.getByRole("button", { name: "Xoá", exact: true });
    let tabs = 0;
    while (!(await trigger.evaluate((el) => el === document.activeElement)) && tabs < 20) {
      await page.keyboard.press("Tab");
      tabs += 1;
    }
    expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(true);

    // Open dialog with Enter
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Check 1: Focus enters dialog on open
    const focusEnters = await page.evaluate(() =>
      Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement))
    );
    const initialFocused = await getActiveElementDesc(page);
    console.log("[COLLECTION] Check 1 (Focus enters):", focusEnters, initialFocused);
    expect(focusEnters).toBe(true);

    // Check 7: Contrast in DARK mode
    await page.waitForTimeout(400);
    const darkContrast = {
      title: await page.evaluate(MEASURE, ['[role="dialog"] p.text-body', 0]),
      consequence: await page.evaluate(MEASURE, ['[role="dialog"] p.text-small.text-text-secondary', 0]),
      acknowledgement: await page.evaluate(MEASURE, ['[role="dialog"] .destructive-confirm__ack span', 0]),
    };
    console.log("[COLLECTION] Check 7 (Dark Contrast):", JSON.stringify(darkContrast, null, 2));
    for (const [k, v] of Object.entries(darkContrast)) {
      expect(v.ratio, `Dark mode ${k} contrast >= 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }

    // Check 7: Contrast in LIGHT mode
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("memvid-theme", "light");
    });
    await page.waitForTimeout(400);
    const lightContrast = {
      title: await page.evaluate(MEASURE, ['[role="dialog"] p.text-body', 0]),
      consequence: await page.evaluate(MEASURE, ['[role="dialog"] p.text-small.text-text-secondary', 0]),
      acknowledgement: await page.evaluate(MEASURE, ['[role="dialog"] .destructive-confirm__ack span', 0]),
    };
    console.log("[COLLECTION] Check 7 (Light Contrast):", JSON.stringify(lightContrast, null, 2));
    for (const [k, v] of Object.entries(lightContrast)) {
      expect(v.ratio, `Light mode ${k} contrast >= 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }

    // Restore dark mode
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      localStorage.setItem("memvid-theme", "dark");
    });
    await page.waitForTimeout(200);

    // Check 2 & 3: Escape cancels, 0 DELETE requests
    const netBeforeEscape = network.length;
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(300);

    const netAfterEscape = network.slice(netBeforeEscape);
    console.log("[COLLECTION] Check 2 & 3 (Escape cancel requests):", netAfterEscape);
    expect(netAfterEscape.filter((n) => n.startsWith("DELETE"))).toEqual([]);

    // Check 4: Focus lands after cancel (must return to trigger 'Xoá')
    const focusAfterCancel = await getActiveElementDesc(page);
    const restoredToTrigger = await trigger.evaluate((el) => el === document.activeElement);
    console.log("[COLLECTION] Check 4 (Focus after cancel):", focusAfterCancel, "restoredToTrigger:", restoredToTrigger);
    expect(restoredToTrigger).toBe(true);

    // Check 6: Failure handling (500)
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();

    await page.route(`**/api/collections/${col1Id}`, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Lỗi máy chủ mẫu" }) })
    );

    await dialog.locator(".destructive-confirm__ack input").check();
    await dialog.locator(".destructive-confirm__action").click();

    await expect(dialog).toBeVisible();
    const errorEl = dialog.locator('p[role="alert"]');
    await expect(errorEl).toBeVisible();
    const errorText = await errorEl.innerText();
    const focusOnFailure = await getActiveElementDesc(page);
    console.log("[COLLECTION] Check 6 (Failure state): errorText=", errorText, "focus=", focusOnFailure);
    expect(errorText).toContain("Lỗi máy chủ mẫu");

    await page.unroute(`**/api/collections/${col1Id}`);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(300);

    // Check 5: Confirm success
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();

    const netBeforeDelete = network.length;
    await dialog.locator(".destructive-confirm__ack input").check();
    await dialog.locator(".destructive-confirm__action").click();
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(500);

    const netAfterDelete = network.slice(netBeforeDelete);
    console.log("[COLLECTION] Check 5 (Success DELETE requests):", netAfterDelete);
    expect(netAfterDelete.filter((n) => n.includes("DELETE"))).toHaveLength(1);

    // Item disappears from API
    const colList = await (await request.get(`${API}/api/collections`, { headers })).json();
    expect(JSON.stringify(colList).includes(name1)).toBe(false);
  });

  test("2. Clear Chat History Dialog (ChatArea) — Focus, Double-Click, Failure & Dual-Theme Contrast", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => localStorage.setItem("memvid-theme", "dark"));
    await registerAndEnterApp(page);

    const network = [];
    page.on("request", (r) => {
      if (r.url().startsWith(API) && r.method() !== "GET" && r.method() !== "OPTIONS") {
        network.push(`${r.method()} ${new URL(r.url()).pathname}`);
      }
    });

    await page.goto("/app");
    await expect(page.locator("html")).toHaveClass(/dark/);

    // Send a message to create conversation history (QUERY_GRAPH is stubbed)
    const composer = page.locator("textarea");
    await expect(composer).toBeVisible();
    await composer.fill("Xin chào hệ thống StudyMap");
    await page.keyboard.press("Enter");

    // Wait for AI message response
    await expect(page.getByText("mock answer")).toBeVisible({ timeout: 15_000 });

    const menuBtn = page.locator('button[aria-label="Tùy chọn cuộc trò chuyện"]');
    await expect(menuBtn).toBeVisible();

    // Open chat menu & trigger dialog
    await menuBtn.click();
    const deleteHistoryTrigger = page.locator('button:has-text("Xóa lịch sử chat")');
    await expect(deleteHistoryTrigger).toBeVisible();
    await deleteHistoryTrigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Check 1: Focus enters dialog on open
    const focusEnters = await page.evaluate(() =>
      Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement))
    );
    const initialFocused = await getActiveElementDesc(page);
    console.log("[CHAT-HISTORY] Check 1 (Focus enters):", focusEnters, initialFocused);
    expect(focusEnters).toBe(true);

    // Check 7: Contrast in DARK mode
    await page.waitForTimeout(400);
    const darkContrast = {
      title: await page.evaluate(MEASURE, ['[role="dialog"] p.text-body', 0]),
      consequence: await page.evaluate(MEASURE, ['[role="dialog"] p.text-small.text-text-secondary', 0]),
      acknowledgement: await page.evaluate(MEASURE, ['[role="dialog"] .destructive-confirm__ack span', 0]),
    };
    console.log("[CHAT-HISTORY] Check 7 (Dark Contrast):", JSON.stringify(darkContrast, null, 2));
    for (const [k, v] of Object.entries(darkContrast)) {
      expect(v.ratio, `Dark mode ${k} contrast >= 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }

    // Check 7: Contrast in LIGHT mode
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("memvid-theme", "light");
    });
    await page.waitForTimeout(400);
    const lightContrast = {
      title: await page.evaluate(MEASURE, ['[role="dialog"] p.text-body', 0]),
      consequence: await page.evaluate(MEASURE, ['[role="dialog"] p.text-small.text-text-secondary', 0]),
      acknowledgement: await page.evaluate(MEASURE, ['[role="dialog"] .destructive-confirm__ack span', 0]),
    };
    console.log("[CHAT-HISTORY] Check 7 (Light Contrast):", JSON.stringify(lightContrast, null, 2));
    for (const [k, v] of Object.entries(lightContrast)) {
      expect(v.ratio, `Light mode ${k} contrast >= 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }

    // Restore dark mode
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      localStorage.setItem("memvid-theme", "dark");
    });
    await page.waitForTimeout(200);

    // Check 2 & 3: Escape cancels, 0 DELETE/non-GET requests
    const netBeforeEscape = network.length;
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(300);

    const netAfterEscape = network.slice(netBeforeEscape);
    console.log("[CHAT-HISTORY] Check 2 & 3 (Escape cancel requests):", netAfterEscape);
    expect(netAfterEscape.filter((n) => n.startsWith("DELETE"))).toEqual([]);
    expect(netAfterEscape).toEqual([]);

    // Check 4 (Part A - Escape): Focus returns to menu button, NOT body
    const focusAfterEscape = await getActiveElementDesc(page);
    const isMenuFocusedAfterEscape = await menuBtn.evaluate((el) => el === document.activeElement);
    const isBodyAfterEscape = await page.evaluate(() => document.activeElement === document.body);
    console.log("[CHAT-HISTORY] Check 4 (After Escape): focus=", focusAfterEscape, "isMenuFocused=", isMenuFocusedAfterEscape, "isBody=", isBodyAfterEscape);
    expect(isMenuFocusedAfterEscape, "Focus must return to menu button after Escape").toBe(true);
    expect(isBodyAfterEscape, "Focus must NOT land on body").toBe(false);

    // Check 4 (Part B - Huỷ button): Cancel via "Huỷ" button returns focus to menu button
    await menuBtn.click();
    await page.locator('button:has-text("Xóa lịch sử chat")').click();
    await expect(dialog).toBeVisible();

    const netBeforeHuy = network.length;
    const huyButton = dialog.getByRole("button", { name: "Huỷ" });
    await expect(huyButton).toBeVisible();
    await huyButton.click();
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(300);

    const netAfterHuy = network.slice(netBeforeHuy);
    console.log("[CHAT-HISTORY] Check 3 (Huỷ cancel requests):", netAfterHuy);
    expect(netAfterHuy.filter((n) => n.startsWith("DELETE"))).toEqual([]);
    expect(netAfterHuy).toEqual([]);

    const focusAfterHuy = await getActiveElementDesc(page);
    const isMenuFocusedAfterHuy = await menuBtn.evaluate((el) => el === document.activeElement);
    const isBodyAfterHuy = await page.evaluate(() => document.activeElement === document.body);
    console.log("[CHAT-HISTORY] Check 4 (After Huỷ button): focus=", focusAfterHuy, "isMenuFocused=", isMenuFocusedAfterHuy, "isBody=", isBodyAfterHuy);
    expect(isMenuFocusedAfterHuy, "Focus must return to menu button after Huỷ button").toBe(true);
    expect(isBodyAfterHuy, "Focus must NOT land on body").toBe(false);

    // Check 6: 500 error handling -> dialog stays + error, then Escape -> focus on menu button
    await menuBtn.click();
    await page.locator('button:has-text("Xóa lịch sử chat")').click();
    await expect(dialog).toBeVisible();

    // Route DELETE to fail with 500
    await page.route("**/conversations/*", (route) => {
      if (route.request().method() === "DELETE") {
        route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Lỗi xoá hội thoại mẫu" }) });
      } else {
        route.continue();
      }
    });

    await dialog.locator(".destructive-confirm__ack input").check();
    await dialog.locator(".destructive-confirm__action").click();

    await expect(dialog).toBeVisible();
    const errorEl = dialog.locator('p[role="alert"]');
    await expect(errorEl).toBeVisible();
    const errorText = await errorEl.innerText();
    const focusOnFailure = await getActiveElementDesc(page);
    console.log("[CHAT-HISTORY] Check 6 (Failure state): errorText=", errorText, "focus=", focusOnFailure);
    expect(errorText).toContain("Không xóa được lịch sử chat trên máy chủ");

    await page.unroute("**/conversations/*");

    // Press Escape on failure state -> dialog closes, focus returns to menu button
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(300);

    const focusAfterFailureEscape = await getActiveElementDesc(page);
    const isMenuFocusedAfterFailureEscape = await menuBtn.evaluate((el) => el === document.activeElement);
    console.log("[CHAT-HISTORY] Check 6 (Focus after Escape from error):", focusAfterFailureEscape, "isMenuFocused=", isMenuFocusedAfterFailureEscape);
    expect(isMenuFocusedAfterFailureEscape, "Focus must return to menu button after Escape from failure state").toBe(true);

    // Check 5: Confirm success with double-click -> exactly one DELETE /conversations/<id>
    await menuBtn.click();
    await page.locator('button:has-text("Xóa lịch sử chat")').click();
    await expect(dialog).toBeVisible();

    const netBeforeDelete = network.length;
    await dialog.locator(".destructive-confirm__ack input").check();

    // Double-click confirm button (using Playwright dblclick)
    const confirmActionBtn = dialog.locator(".destructive-confirm__action");
    await confirmActionBtn.dblclick();

    await expect(dialog).toBeHidden();
    await page.waitForTimeout(500);

    const netAfterDelete = network.slice(netBeforeDelete);
    console.log("[CHAT-HISTORY] Check 5 (Success DELETE requests):", netAfterDelete);
    const deleteReqs = netAfterDelete.filter((n) => n.startsWith("DELETE /conversations"));
    expect(deleteReqs, "Exactly one DELETE request sent even on double click").toHaveLength(1);

    // Chat messages cleared
    await expect(page.getByText("mock answer")).toHaveCount(0);

    // Focus after success: ChatArea.jsx line 434 calls refocusComposer() -> composer textarea
    const focusAfterSuccess = await getActiveElementDesc(page);
    const isComposerFocused = await composer.evaluate((el) => el === document.activeElement);
    console.log("[CHAT-HISTORY] Check 5 (Focus after success):", focusAfterSuccess, "isComposerFocused:", isComposerFocused);
    expect(isComposerFocused, "Focus must return to composer textarea after successful delete").toBe(true);
  });
});
