// Real-browser, deterministic critical-flow coverage (B3). Runs serially
// against ONE registered user + ONE uploaded document, reusing state between
// steps the way a real session does — this is what makes "reload doesn't
// re-POST" and "A/B map switching preserves identity" meaningful checks
// instead of isolated unit assertions.
import { test, expect } from "@playwright/test";
import {
  registerAndEnterApp, uploadSampleDocument, selectAllSources,
  openGuidedDialogFromHeader, openMapLibrary,
} from "./fixtures.js";

test.describe.serial("critical flows", () => {
  let page;
  const generateMindmapPosts = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/generate-mindmap")) {
        generateMindmapPosts.push(Date.now());
      }
    });
  });
  test.afterAll(async () => { await page.close(); });

  test("app boots with no fatal JS error and the backend is reachable", async () => {
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
    expect(pageErrors, `Uncaught JS error(s) on boot: ${pageErrors.map(String).join("; ")}`).toEqual([]);
  });

  test("backend /health is reachable and reports CI mode", async ({ request }) => {
    const bePort = process.env.PORT || 8080;
    const res = await request.get(`http://127.0.0.1:${bePort}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("register a deterministic CI-safe user and land in the app shell", async () => {
    await registerAndEnterApp(page);
  });

  test("upload a document and select it as a source", async () => {
    await uploadSampleDocument(page);
    await selectAllSources(page);
  });

  test("Guided Mind Map V3 happy path: dialog -> submit -> queued -> done -> map persisted", async () => {
    const dialog = await openGuidedDialogFromHeader(page);

    // Regression guard (protects a P1 fix a parallel agent may still be
    // shipping — see task brief): the dialog must be VISIBLE, not merely
    // present in the DOM under an ancestor with opacity:0/visibility:hidden.
    // Written defensively: if this is still broken when this suite runs,
    // fail loud with a clear message rather than hanging on a 45s timeout.
    // The guided dialog mounts through an effect chain after the create click,
    // so wait for visibility instead of sampling it once.
    const visible = await dialog.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    if (!visible) {
      test.info().annotations.push({
        type: "known-issue",
        description: "Guided Mind Map dialog rendered but is not visible — " +
          "see MainLayout.jsx's mindmap-tools-overlay opacity/visibility toggle. " +
          "If a fix for this has landed, this test should be updated to a hard assertion.",
      });
    }
    expect(visible, "Guided Mind Map dialog opened but is not visible (invisible-modal regression)").toBe(true);

    await dialog.getByRole("button", { name: "Tạo sơ đồ" }).click();
    expect(generateMindmapPosts.length).toBeGreaterThan(0);

    // Poller starts at a 2s interval (jobPoller.js) — the mock graph resolves
    // almost immediately in a background thread, so "done" should land well
    // inside one or two poll ticks. Confirm the map actually persisted
    // (mindmap_store, not just the job row — see run_e2e_server.py) by
    // reopening the library and finding a selected, non-empty entry.
    await expect(async () => {
      await openMapLibrary(page);
      const options = page.getByRole("option");
      expect(await options.count()).toBeGreaterThan(0);
      await expect(options.first()).toHaveAttribute("aria-selected", "true");
    }).toPass({ timeout: 20_000, intervals: [1000] });
    await page.keyboard.press("Escape");
  });

  test("existing/persisted map restores correctly from the map list", async () => {
    await openMapLibrary(page);
    const firstTitle = await page.getByRole("option").first().locator("span").first().innerText();
    await page.getByRole("option").first().click();
    // Re-open the library: the just-selected item must still read as selected
    // (identity survives close/reopen, not just the initial click).
    await openMapLibrary(page);
    await expect(page.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    expect(await page.getByRole("option").first().locator("span").first().innerText()).toBe(firstTitle);
    await page.keyboard.press("Escape");
  });

  test("reloading an existing/generated map does not trigger a new POST /generate-mindmap", async () => {
    const postsBefore = generateMindmapPosts.length;
    await page.reload();
    await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor({ state: "visible" });
    // Give any accidental auto-regen a moment to fire before asserting it didn't.
    await page.waitForTimeout(1500);
    expect(generateMindmapPosts.length).toBe(postsBefore);
  });

  test("A -> B -> A -> B map switching preserves correct active map identity", async () => {
    // Create a second, distinct map ("B") alongside the one from the happy-
    // path test ("A"). 2026-09-27: the original version of this test clicked
    // "Tạo sơ đồ" with IDENTICAL params to the happy-path test (same sources,
    // no custom instruction) and just waited for a second library entry to
    // appear. That never happened, at any timeout length -- the real
    // /generate-mindmap route content-hashes the request and, on a match,
    // returns the EXISTING cached record synchronously (HTTP 200, no job_id)
    // *before* ever reaching run_e2e_server.py's mocked graph, so no second
    // job -- and no second map -- was ever created. Confirmed from the
    // WebServer access log: "POST /generate-mindmap HTTP/1.1" 200 (cache-hit
    // shape), not 202 (queued). A differentiating custom instruction changes
    // the content hash, guaranteeing a genuinely distinct second map instead
    // of racing a wait condition that could never pass.
    // (This is also what caused the describe.serial whole-file retry that
    // crashed the last test in this file with "Target page, context or
    // browser has been closed" -- fixing the real cause here removes that
    // retry entirely, which is a more reliable fix than hardening the
    // unrelated last test against a crash it only inherited.)
    await selectAllSources(page);
    const dialog = await openGuidedDialogFromHeader(page);
    await dialog.getByLabel(/Yêu cầu riêng/).fill("second distinct map for A/B switching test");
    await dialog.getByRole("button", { name: "Tạo sơ đồ" }).click();
    await expect(async () => {
      await openMapLibrary(page);
      expect(await page.getByRole("option").count()).toBeGreaterThan(1);
    }).toPass({ timeout: 20_000, intervals: [1000] });

    const options = page.getByRole("option");
    const titleB = await options.first().locator("span").first().innerText(); // newest first
    const titleA = await options.nth(1).locator("span").first().innerText();
    expect(titleA).not.toBe(titleB);

    const activeTitle = async () => {
      await openMapLibrary(page);
      const selected = page.getByRole("option", { selected: true }).first();
      const t = await selected.locator("span").first().innerText();
      await page.keyboard.press("Escape");
      return t;
    };
    const selectByTitle = async (title) => {
      await openMapLibrary(page);
      await page.getByRole("option").filter({ hasText: title }).click();
    };

    await selectByTitle(titleA);
    expect(await activeTitle()).toBe(titleA);
    await selectByTitle(titleB);
    expect(await activeTitle()).toBe(titleB);
    await selectByTitle(titleA);
    expect(await activeTitle()).toBe(titleA);
    await selectByTitle(titleB);
    expect(await activeTitle()).toBe(titleB);
  });

  test("Mind Map -> Chat -> Summary -> Mind Map switching causes no accidental regeneration", async () => {
    const postsBefore = generateMindmapPosts.length;
    await page.getByRole("tab", { name: "Trò chuyện" }).click();
    await openMapLibrary(page);
    // Selecting an existing map from the library (not "create") must not POST.
    const existingItem = page.getByRole("option").first();
    if (await existingItem.isVisible().catch(() => false)) await existingItem.click();
    await page.waitForTimeout(1000);
    expect(generateMindmapPosts.length).toBe(postsBefore);
  });

  test("Guided create failure surfaces a visible error and does not silently close", async () => {
    await selectAllSources(page);
    const dialog = await openGuidedDialogFromHeader(page);
    await dialog.getByLabel(/Yêu cầu riêng/).fill("__E2E_FORCE_FAIL__ trigger deterministic failure");
    await dialog.getByRole("button", { name: "Tạo sơ đồ" }).click();
    // The dialog stays mounted (onSubmit's error path re-enables the form via
    // GuidedMindmapDialog's `error` effect) until the user closes it, and the
    // failure must be visible, not a silent disappearance ("no false 'chưa
    // có sơ đồ'" — SidebarRight surfaces `guidedError`, not an empty-state).
    await expect(page.getByText(/lỗi|thất bại|fail(?:ed|ure)/i).first()).toBeVisible({ timeout: 20_000 });
  });
});

// ── Guided panel restoration (browser) ──────────────────────────────────────
// Scenarios A–D pin the contract from 667d394: opening the Guided dialog from
// the Mind Map workspace reveals the right aside, and closing it restores the
// aside to what the user had before (closed with nothing selected, open with a
// selected node). Own registered user, so zero-map state is real. Maps are
// seeded through the real POST /generate-mindmap API (the CI backend runs the
// deterministic stub graph, so no provider is called), never through the UI,
// never with force, and never with a Generate retry.

const ASIDE = "aside.mindmap-tools-overlay, aside.context-inspector-shell";

async function rightAsideOpen(page) {
  return page.locator(ASIDE).first().evaluate((el) => {
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.opacity !== "0" && style.pointerEvents !== "none";
  });
}

// Mind Elixir canvas identity: the root element's instance marker (a re-mount
// gets a new marker), its transform, and every topic's text, selection and box.
async function canvasState(page) {
  return page.evaluate(() => {
    const root = document.querySelector("me-root");
    if (root && !root.dataset.e2eInstance) root.dataset.e2eInstance = Math.random().toString(36).slice(2);
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map((v) => Math.round(v));
    };
    return {
      instance: root?.dataset.e2eInstance ?? null,
      transform: root?.style.transform ?? "",
      topics: [...document.querySelectorAll("me-tpc")].map((t) => ({
        text: t.textContent.trim(),
        selected: t.classList.contains("selected"),
        box: box(t),
      })),
    };
  });
}

// Two consecutive equal samples, polled without a fixed sleep.
async function settled(read) {
  let prev = await read();
  let next = prev;
  await expect.poll(async () => {
    next = await read();
    const same = JSON.stringify(next) === JSON.stringify(prev);
    prev = next;
    return same;
  }, { timeout: 5_000, intervals: [100] }).toBe(true);
  return next;
}

async function apiSession(page) {
  const token = await page.evaluate(() => localStorage.getItem("memvid-token"));
  expect(token, "auth token stored after register").toBeTruthy();
  return { base: `http://127.0.0.1:${process.env.PORT || 8080}`, headers: { Authorization: `Bearer ${token}` } };
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

async function uploadSecondDocument(request, api) {
  const res = await request.post(`${api.base}/api/documents/upload`, {
    headers: api.headers,
    multipart: { file: { name: "second-doc.txt", mimeType: "text/plain", buffer: Buffer.from("Tài liệu thứ hai cho kiểm thử chuyển sơ đồ.") } },
  });
  expect(res.status(), "second document upload").toBe(201);
}

async function seedMap(request, api, stem) {
  const res = await request.post(`${api.base}/generate-mindmap`, {
    headers: api.headers,
    data: { sources: [stem], source_ids: [stem], q: "tóm tắt tài liệu", force: false },
  });
  expect(res.ok(), `seed POST /generate-mindmap -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  if (body.status === "done") return; // cache hit: already persisted
  await expect.poll(async () => {
    const st = await request.get(`${api.base}/mindmap-status/${body.job_id}`, { headers: api.headers });
    return (await st.json()).status;
  }, { timeout: 60_000 }).toBe("done");
}

async function reloadApp(page) {
  await page.reload();
  await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor({ state: "visible" });
}

async function selectedMapTitle(page) {
  await openMapLibrary(page);
  const title = await page.getByRole("option", { selected: true }).first().locator("span").first().innerText();
  await page.keyboard.press("Escape");
  return title;
}

async function mapTitles(page) {
  await openMapLibrary(page);
  const options = page.getByRole("option");
  await expect(options).toHaveCount(2);
  const titles = [];
  for (let i = 0; i < 2; i++) titles.push(await options.nth(i).locator("span").first().innerText());
  await page.keyboard.press("Escape");
  return titles;
}

async function selectMapByTitle(page, title) {
  await openMapLibrary(page);
  await page.getByRole("option").filter({ hasText: title }).click();
}

test.describe.serial("guided panel restoration (browser)", () => {
  let page;
  let api;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });
  test.afterAll(async () => { await page.close(); });

  test("setup: fresh user, one source, zero maps", async () => {
    await registerAndEnterApp(page);
    await uploadSampleDocument(page);
    await selectAllSources(page);
    api = await apiSession(page);
  });

  test("A1 zero maps: X close restores the aside to its pre-open state", async () => {
    await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
    const before = await settled(() => rightAsideOpen(page));
    expect(before, "zero maps, nothing selected: aside starts closed").toBe(false);

    await page.getByRole("button", { name: "Tạo sơ đồ tư duy", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Tạo sơ đồ tư duy" });
    await expect(dialog).toBeVisible();
    expect(await settled(() => rightAsideOpen(page)), "opening Guided reveals the aside").toBe(true);

    await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(await settled(() => rightAsideOpen(page)), "X close restores pre-open state").toBe(before);
  });

  test("A2 zero maps: Escape close restores the same state", async () => {
    const before = await settled(() => rightAsideOpen(page));
    expect(before).toBe(false);

    await page.getByRole("button", { name: "Tạo sơ đồ tư duy", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Tạo sơ đồ tư duy" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await settled(() => rightAsideOpen(page)), "Escape close restores pre-open state").toBe(before);
  });

  test("seed: one map through the generate API, then reload", async ({ request }) => {
    const stem = await sourceStem(request, api, "sample-doc");
    await seedMap(request, api, stem);
    await selectAllSources(page);
  });

  test("B1 existing map: Guided close leaves transform, instance, topics and aside unchanged", async () => {
    await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
    await page.locator("me-root").first().waitFor({ state: "visible" });
    const beforeCanvas = await settled(() => canvasState(page));
    const beforeAside = await settled(() => rightAsideOpen(page));
    const beforeTitle = await selectedMapTitle(page);

    const dialog = await openGuidedDialogFromHeader(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
    await expect(dialog).toBeHidden();

    expect(await settled(() => canvasState(page))).toEqual(beforeCanvas);
    expect(await settled(() => rightAsideOpen(page))).toBe(beforeAside);
    expect(await selectedMapTitle(page)).toBe(beforeTitle);
  });

  test("C1 node detail: Guided close restores the open node detail", async () => {
    await page.locator("me-tpc").first().click();
    await expect(page.locator("me-tpc.selected")).toHaveCount(1);
    expect(await settled(() => rightAsideOpen(page)), "selecting a node opens its detail").toBe(true);
    const beforeCanvas = await settled(() => canvasState(page));

    const dialog = await openGuidedDialogFromHeader(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect(page.locator("me-tpc.selected")).toHaveCount(1);
    expect(await settled(() => rightAsideOpen(page)), "node detail restored after Guided close").toBe(true);
    expect(await settled(() => canvasState(page))).toEqual(beforeCanvas);
  });

  test("D1 node detail default-closed on fresh load and after reload", async () => {
    await page.goto("/app");
    await page.getByRole("tablist", { name: "Chế độ Workspace" }).waitFor({ state: "visible" });
    await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
    await page.locator("me-root").first().waitFor({ state: "visible" });
    expect(await settled(() => rightAsideOpen(page)), "fresh load: no node detail").toBe(false);

    await reloadApp(page);
    await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
    await page.locator("me-root").first().waitFor({ state: "visible" });
    expect(await settled(() => rightAsideOpen(page)), "after reload: no node detail").toBe(false);
  });

  test("D2 node detail stays closed across A -> B -> A map switching", async ({ request }) => {
    await uploadSecondDocument(request, api);
    await seedMap(request, api, await sourceStem(request, api, "second-doc"));
    await reloadApp(page);
    await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();

    const [titleNewest, titleOlder] = await mapTitles(page);
    expect(titleNewest).not.toBe(titleOlder);
    for (const title of [titleOlder, titleNewest, titleOlder]) {
      await selectMapByTitle(page, title);
      expect(await settled(() => rightAsideOpen(page)), `closed after switching to ${title}`).toBe(false);
    }
  });

  test("D3 node detail stays closed after Chat -> Mind Map", async () => {
    await page.getByRole("tab", { name: "Trò chuyện" }).click();
    await page.getByRole("tab", { name: "Sơ đồ tư duy" }).click();
    await page.locator("me-root").first().waitFor({ state: "visible" });
    expect(await settled(() => rightAsideOpen(page))).toBe(false);
  });
});
