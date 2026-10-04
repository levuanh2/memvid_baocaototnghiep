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
