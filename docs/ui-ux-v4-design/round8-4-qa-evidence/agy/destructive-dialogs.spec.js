import { test, expect } from "@playwright/test";
import { registerAndEnterApp, uploadSampleDocument, freshTestUser } from "../e2e/fixtures.js";
import path from "node:path";
import { execSync } from "node:child_process";

const API = "http://127.0.0.1:8380";

const MEASURE = ([sel, idx]) => {
  const parse = (c) => {
    const m = c.match(/[\d.]+/g).map(Number);
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
  if (!el) return { text: "NOT FOUND", ratio: 0 };
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
  const fg = over(parse(getComputedStyle(el).color), bg);
  const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return {
    text: el.textContent.trim().slice(0, 60),
    color: getComputedStyle(el).color,
    fontSize: getComputedStyle(el).fontSize,
    composited: `rgb(${bg.r.toFixed(1)}, ${bg.g.toFixed(1)}, ${bg.b.toFixed(1)})`,
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

async function apiSession(page) {
  const token = await page.evaluate(() => localStorage.getItem("memvid-token"));
  expect(token).toBeTruthy();
  return { base: API, headers: { Authorization: `Bearer ${token}` } };
}

async function sourceStem(request, api, needle) {
  let stem = null;
  await expect.poll(async () => {
    const body = await (await request.get(`${api.base}/list-indexed`, { headers: api.headers })).json();
    stem = body.sources.find((s) => String(s.filename ?? "").includes(needle))?.video_stem ?? null;
    return stem;
  }, { timeout: 20_000 }).not.toBeNull();
  return stem;
}

async function seedMap(request, api, stem) {
  const res = await request.post(`${api.base}/generate-mindmap`, {
    headers: api.headers,
    data: { sources: [stem], source_ids: [stem], q: "tóm tắt tài liệu", force: false },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  if (body.status === "done") return body.result.id;
  let payload = null;
  await expect.poll(async () => {
    const st = await request.get(`${api.base}/mindmap-status/${body.job_id}`, { headers: api.headers });
    payload = await st.json();
    return payload.status;
  }, { timeout: 60_000 }).toBe("done");
  return payload.result.id;
}

function seedSummaryDirect(userId, summaryId, title, stem) {
  const dbFile = path.resolve(process.cwd(), "../BE/memory/summaries.sqlite").replace(/\\/g, "/");
  const record = {
    id: summaryId,
    title,
    sources: [stem],
    content_hash: `hash-${summaryId}`,
    created_at: new Date().toISOString(),
    overview: "Bản tóm tắt kiểm thử E2E",
    sections: [{ title: "Phần 1", content: "Nội dung phần 1" }],
    key_points: ["Điểm 1", "Điểm 2"],
  };
  const b64 = Buffer.from(JSON.stringify(record)).toString("base64");
  const pyCode = `import sqlite3, json, base64; con = sqlite3.connect(r'${dbFile}'); rec = json.loads(base64.b64decode('${b64}').decode('utf-8')); con.execute('INSERT OR REPLACE INTO summaries (id, content_hash, sources_json, created_at, record_json, user_id) VALUES (?, ?, ?, ?, ?, ?)', (rec['id'], rec['content_hash'], json.dumps(rec['sources']), rec['created_at'], json.dumps(rec), '${userId}')); con.commit(); con.close()`;
  execSync(`python -c "${pyCode}"`);
  return record;
}

test.describe("Real-App Destructive Dialogs Suite", () => {
  test.setTimeout(120_000);

  test("1. Collection Delete Dialog (Library) - Track B fix verification", async ({ page, request }) => {
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

    // Check 7: Contrast in dark mode (title / consequence / acknowledgement)
    await page.waitForTimeout(600);
    const contrast = {
      title: await page.evaluate(MEASURE, ['[role="dialog"] p.text-body', 0]),
      consequence: await page.evaluate(MEASURE, ['[role="dialog"] p.text-small.text-text-secondary', 0]),
      acknowledgement: await page.evaluate(MEASURE, ['[role="dialog"] .destructive-confirm__ack span', 0]),
    };
    console.log("[COLLECTION] Check 7 (Contrast):", JSON.stringify(contrast, null, 2));
    for (const [k, v] of Object.entries(contrast)) {
      expect(v.ratio, `${k} contrast >= 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }

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

    // Check 6: Failure handling
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

    // Item disappears
    const colList = await (await request.get(`${API}/api/collections`, { headers })).json();
    expect(JSON.stringify(colList).includes(name1)).toBe(false);

    // Focus after success (Track B fix: lands on next collection data-collection-id, never <body>)
    const focusAfterSuccess = await getActiveElementDesc(page);
    const nextCol = page.locator(`[data-collection-id="${col2Id}"]`);
    const isFocusOnNext = await nextCol.evaluate((el) => el === document.activeElement);
    console.log("[COLLECTION] Check 5 (Focus after success):", focusAfterSuccess, "isFocusOnNext:", isFocusOnNext);
    expect(isFocusOnNext).toBe(true);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  });

  test("2. Clear Chat History Dialog (ChatArea)", async ({ page, request }) => {
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

    // Open chat menu
    const menuBtn = page.locator('button[aria-label="Tùy chọn cuộc trò chuyện"]');
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();

    // Trigger: Xóa lịch sử chat
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

    // Check 7: Contrast in dark mode
    await page.waitForTimeout(600);
    const contrast = {
      title: await page.evaluate(MEASURE, ['[role="dialog"] p.text-body', 0]),
      consequence: await page.evaluate(MEASURE, ['[role="dialog"] p.text-small.text-text-secondary', 0]),
      acknowledgement: await page.evaluate(MEASURE, ['[role="dialog"] .destructive-confirm__ack span', 0]),
    };
    console.log("[CHAT-HISTORY] Check 7 (Contrast):", JSON.stringify(contrast, null, 2));
    for (const [k, v] of Object.entries(contrast)) {
      expect(v.ratio, `${k} contrast >= 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }

    // Check 2 & 3: Escape cancels, 0 DELETE requests
    const netBeforeEscape = network.length;
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(300);

    const netAfterEscape = network.slice(netBeforeEscape);
    console.log("[CHAT-HISTORY] Check 2 & 3 (Escape cancel requests):", netAfterEscape);
    expect(netAfterEscape.filter((n) => n.startsWith("DELETE"))).toEqual([]);

    // Check 4: Focus lands after cancel
    // NOTE: handleDeleteHistory calls setMenuOpen(false), so the menu item trigger unmounted!
    const focusAfterCancel = await getActiveElementDesc(page);
    const isBody = await page.evaluate(() => document.activeElement === document.body);
    console.log("[CHAT-HISTORY] Check 4 (Focus after cancel):", focusAfterCancel, "isBody:", isBody);

    // Check 6: Failure handling
    // Reopen menu and trigger
    await menuBtn.click();
    await page.locator('button:has-text("Xóa lịch sử chat")').click();
    await expect(dialog).toBeVisible();

    // Route DELETE to fail with 500
    await page.route("**/conversations/*", (route) => {
      if (route.request().method() === "DELETE") {
        route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Lỗi xoá hội thoại" }) });
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
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(300);

    // Check 5: Confirm success
    await menuBtn.click();
    await page.locator('button:has-text("Xóa lịch sử chat")').click();
    await expect(dialog).toBeVisible();

    const netBeforeDelete = network.length;
    await dialog.locator(".destructive-confirm__ack input").check();
    await dialog.locator(".destructive-confirm__action").click();
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(500);

    const netAfterDelete = network.slice(netBeforeDelete);
    console.log("[CHAT-HISTORY] Check 5 (Success DELETE requests):", netAfterDelete);
    expect(netAfterDelete.filter((n) => n.startsWith("DELETE /conversations"))).toHaveLength(1);

    // Chat messages cleared
    await expect(page.getByText("mock answer")).toHaveCount(0);

    // Focus after success: ChatArea.jsx line 434 calls refocusComposer()!
    const focusAfterSuccess = await getActiveElementDesc(page);
    const isComposerFocused = await composer.evaluate((el) => el === document.activeElement);
    console.log("[CHAT-HISTORY] Check 5 (Focus after success):", focusAfterSuccess, "isComposerFocused:", isComposerFocused);
    expect(isComposerFocused).toBe(true);
  });

  test("3. Delete MindMap Dialog (SidebarRight) - Real App Audit", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await registerAndEnterApp(page);
    await uploadSampleDocument(page);

    const api = await apiSession(page);
    const stem = await sourceStem(request, api, "sample-doc");
    const mapId = await seedMap(request, api, stem);
    console.log("[MINDMAP] Seeded map ID:", mapId);

    await page.goto("/app");
    await page.waitForTimeout(1000);

    // Check whether the trigger button 'Xóa sơ đồ' is mounted in the DOM
    const deleteMapBtn = page.locator('button[aria-label="Xóa sơ đồ"]');
    const deleteBtnCount = await deleteMapBtn.count();
    console.log("[MINDMAP] button[aria-label='Xóa sơ đồ'] count in DOM:", deleteBtnCount);

    // Check legacyInspectorSurfacesEnabled state in SidebarRight
    const legacyDisclosure = page.locator('button:has-text("Tạo từ tài liệu")');
    const legacyDisclosureCount = await legacyDisclosure.count();
    console.log("[MINDMAP] 'Tạo từ tài liệu' disclosure count in DOM:", legacyDisclosureCount);

    // In production build, legacyInspectorSurfacesEnabled = false dead-code gates lines 1089-1241
    expect(deleteBtnCount).toBe(0);
    expect(legacyDisclosureCount).toBe(0);
  });

  test("4. Delete Summary Dialog (SidebarRight) - Real App Audit", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await registerAndEnterApp(page);

    const api = await apiSession(page);
    const meRes = await request.get(`${api.base}/auth/me`, { headers: api.headers });
    expect(meRes.ok()).toBe(true);
    const meBody = await meRes.json();
    const userId = meBody.user?.id;
    expect(userId).toBeTruthy();

    const summaryId = `summary-${Date.now()}`;
    await seedSummaryDirect(userId, summaryId, "Bản tóm tắt kiểm thử E2E", "sample-stem");
    console.log("[SUMMARY] Seeded summary ID:", summaryId, "for userId:", userId);

    // Verify GET /summaries returns it
    const listRes = await (await request.get(`${api.base}/summaries`, { headers: api.headers })).json();
    const foundInApi = (listRes.summaries || []).some((s) => s.id === summaryId);
    console.log("[SUMMARY] Found in GET /summaries API:", foundInApi);
    expect(foundInApi).toBe(true);

    await page.goto("/app");
    await page.waitForTimeout(1000);

    // Check whether the trigger button 'Xóa tóm tắt' is mounted in the DOM
    const deleteSummaryBtn = page.locator('button[aria-label="Xóa tóm tắt"]');
    const deleteSummaryBtnCount = await deleteSummaryBtn.count();
    console.log("[SUMMARY] button[aria-label='Xóa tóm tắt'] count in DOM:", deleteSummaryBtnCount);

    // In production build, legacyInspectorSurfacesEnabled = false dead-code gates lines 1089-1241
    expect(deleteSummaryBtnCount).toBe(0);
  });
});
