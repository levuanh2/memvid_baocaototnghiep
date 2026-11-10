import { test, expect } from "@playwright/test";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const INDEXED_SOURCE = { video: "tai-lieu-1", video_stem: "tai-lieu-1", filename: "Tài liệu 1.pdf", status: "index_ready" };

async function openEmptyLibraryApp(page, { collapsedLeft = false, onUpload, sources = [] } = {}) {
  await page.addInitScript(({ collapsed }) => {
    const nativeInputClick = HTMLInputElement.prototype.click;
    window.__uploadFileInputClicks = 0;
    HTMLInputElement.prototype.click = function instrumentedInputClick() {
      if (this.type === "file") window.__uploadFileInputClicks += 1;
      return nativeInputClick.call(this);
    };
    localStorage.setItem("memvid-token", "fixture-token");
    if (collapsed) {
      localStorage.setItem("memvidx.panels.v1", JSON.stringify({
        width: { left: 252, right: 360 },
        collapsed: { left: true, right: true },
      }));
    }
  }, { collapsed: collapsedLeft });
  await page.route(/localhost:8080\//, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (pathname === "/list-indexed") return route.fulfill(json({ sources }));
    if (pathname === "/api/documents" || pathname === "/api/library") return route.fulfill(json({ documents: [], collections: [] }));
    if (pathname === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (pathname === "/summaries") return route.fulfill(json({ summaries: [] }));
    if (pathname === "/upload" && request.method() === "POST") {
      onUpload?.(request);
      return route.fulfill(json({ source_id: "source-1", video_stem: "sample", status: "processing" }));
    }
    if (pathname === "/sources/source-1/status") return route.fulfill(json({ status: "processing", progress: 10 }));
    return route.fulfill(json({}));
  });
  await page.goto("/app");
  await expect(page.getByText("Hỏi tài liệu của bạn")).toBeVisible();
  // With documents, wait until the list has reached the chat: its no-documents upload CTA is gone.
  if (sources.length) await expect(page.locator("main [data-upload-cta]")).toHaveCount(0);
}

// Focus after a layout change must land on a control the user can see and press: an upload
// control, or (when the new layout has none) the control that opens the source panel/drawer.
async function expectFocusOnUsableUploadEntry(page) {
  await expect.poll(() => page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "body";
    if (!el.matches("[data-upload-cta], [data-source-entry]")) return `other:${el.outerHTML.slice(0, 80)}`;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit && (el === hit || el.contains(hit)) ? "ok" : "occluded";
  })).toBe("ok");
}

async function expectOneChooser(page, activate) {
  const before = await page.evaluate(() => window.__uploadFileInputClicks);
  const chooserPromise = page.waitForEvent("filechooser");
  await activate();
  const chooser = await chooserPromise;
  expect(chooser).toBeTruthy();
  await expect.poll(() => page.evaluate(() => window.__uploadFileInputClicks)).toBe(before + 1);
  return chooser;
}

async function expectNoHorizontalOverflow(page) {
  await expect.poll(() => page.evaluate(() => (
    document.body.scrollWidth <= window.innerWidth
      && document.documentElement.scrollWidth <= window.innerWidth
  ))).toBe(true);
}

for (const width of [320, 390, 768, 1024, 1100, 1280, 1440]) {
  test(`one CTA click opens one chooser at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openEmptyLibraryApp(page);
    const upload = page.getByRole("button", { name: "Tải tài liệu lên" }).first();
    await expect(upload).toBeVisible();
    const chooser = await expectOneChooser(page, () => upload.click());
    await chooser.setFiles([]);
  });
}

test("desktop: CTA still opens the chooser after the source panel is collapsed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEmptyLibraryApp(page);
  await page.getByRole("button", { name: "Thu gọn cột" }).first().click();
  await expect(page.getByRole("button", { name: "Mở Thư mục nguồn", exact: true })).toBeVisible();
  const chooser = await expectOneChooser(page, () => page.getByRole("button", { name: "Tải tài liệu lên" }).first().click());
  await chooser.setFiles([]);
});

test("desktop: restored collapsed preference needs only one CTA click", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEmptyLibraryApp(page, { collapsedLeft: true });
  await expect(page.getByRole("button", { name: "Mở Thư mục nguồn", exact: true })).toBeVisible();
  const chooser = await expectOneChooser(page, () => page.getByRole("button", { name: "Tải tài liệu lên" }).first().click());
  await chooser.setFiles([]);
});

test("tablet: chooser works across rail, shelf, and collapsed-rail transitions", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await openEmptyLibraryApp(page);
  const upload = page.getByRole("button", { name: "Tải tài liệu lên" }).first();
  await (await expectOneChooser(page, () => upload.click())).setFiles([]);
  await page.getByRole("button", { name: "Mở rộng thư mục nguồn" }).click();
  await expect(page.locator('[data-source-layout="shelf"]')).toBeVisible();
  await (await expectOneChooser(page, () => page.getByText("Thêm tài liệu", { exact: true }).click())).setFiles([]);
  await page.getByRole("button", { name: "Thu gọn cột" }).first().click();
  await expect(page.locator('[data-source-layout="rail"]')).toBeVisible();
  await (await expectOneChooser(page, () => upload.click())).setFiles([]);
});

test("mobile: chooser works with the drawer closed and open", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEmptyLibraryApp(page);
  const upload = page.getByRole("button", { name: "Tải tài liệu lên" }).first();
  await (await expectOneChooser(page, () => upload.click())).setFiles([]);
  // PR #126 (W1-2) renamed the header trigger "Mở công cụ StudyMap" -> "Mở công cụ học".
  await page.getByRole("button", { name: "Mở công cụ học", exact: true }).click();
  await page.getByRole("menuitem", { name: /Mở thư mục nguồn/ }).click();
  await expect(page.getByText("Thêm tài liệu", { exact: true })).toBeInViewport();
  await (await expectOneChooser(page, () => page.getByText("Thêm tài liệu", { exact: true }).click())).setFiles([]);
  await page.getByRole("button", { name: "Đóng" }).first().click();
  await (await expectOneChooser(page, () => upload.click())).setFiles([]);
});

test("cancel does not upload; selecting one PDF sends one upload request", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let uploadRequests = 0;
  await openEmptyLibraryApp(page, { collapsedLeft: true, onUpload: () => { uploadRequests += 1; } });
  const upload = page.getByRole("button", { name: "Tải tài liệu lên" }).first();
  await (await expectOneChooser(page, () => upload.click())).setFiles([]);
  expect(uploadRequests).toBe(0);
  const chooser = await expectOneChooser(page, () => upload.click());
  await chooser.setFiles({ name: "sample.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") });
  await expect.poll(() => uploadRequests).toBe(1);
});

test("keyboard activation opens one chooser and keeps focus on the CTA after cancel", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEmptyLibraryApp(page, { collapsedLeft: true });
  const upload = page.getByRole("button", { name: "Tải tài liệu lên" }).first();
  await upload.focus();
  const chooser = await expectOneChooser(page, () => page.keyboard.press("Enter"));
  await chooser.setFiles([]);
  await expect(upload).toBeFocused();
});

test("rapid double-click with a live owner opens one chooser and does not upload on cancel", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let uploadRequests = 0;
  await openEmptyLibraryApp(page, { onUpload: () => { uploadRequests += 1; } });
  const upload = page.getByRole("button", { name: "Tải tài liệu lên" }).first();
  const chooser = await expectOneChooser(page, () => upload.dblclick());
  await chooser.setFiles([]);
  expect(uploadRequests).toBe(0);
});

test("two activations before a collapsed owner remount coalesce and cancel leaves no stale intent", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let uploadRequests = 0;
  await openEmptyLibraryApp(page, { collapsedLeft: true, onUpload: () => { uploadRequests += 1; } });
  const upload = page.getByRole("button", { name: "Tải tài liệu lên" }).first();
  const firstChooser = await expectOneChooser(page, () => upload.evaluate((button) => {
    button.click();
    button.click();
  }));
  await firstChooser.setFiles([]);
  expect(uploadRequests).toBe(0);

  const secondChooser = await expectOneChooser(page, () => upload.click());
  await secondChooser.setFiles({ name: "sample.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") });
  await expect.poll(() => uploadRequests).toBe(1);
});

for (const transition of [
  { from: 767, to: 768, collapsedLeft: false },
  { from: 767, to: 768, collapsedLeft: true },
  { from: 768, to: 767, collapsedLeft: false },
  { from: 768, to: 767, collapsedLeft: true },
  { from: 1279, to: 1280, collapsedLeft: false },
  { from: 1279, to: 1280, collapsedLeft: true },
  { from: 1280, to: 1279, collapsedLeft: false },
  { from: 1280, to: 1279, collapsedLeft: true },
]) {
  test(`live resize ${transition.from} -> ${transition.to} keeps the focused CTA and one upload owner (${transition.collapsedLeft ? "collapsed" : "expanded"})`, async ({ page }) => {
    await page.setViewportSize({ width: transition.from, height: 900 });
    await openEmptyLibraryApp(page, { collapsedLeft: transition.collapsedLeft });
    const upload = page.getByRole("button", { name: "Tải tài liệu lên" }).first();
    await upload.focus();
    await expect(upload).toBeFocused();
    const original = await upload.elementHandle();

    await page.setViewportSize({ width: transition.to, height: 900 });
    // Several controls share the name "Tải tài liệu lên" (rail "+", empty-state CTA), so a
    // re-resolved `.first()` can point at a different node after the resize. Track the node that
    // actually had focus: if it survived the resize it must still have focus; if the new layout
    // removed it, focus must move to that layout's upload control, never fall to <body>.
    await expect.poll(() => original.evaluate((node) => (node.isConnected
      ? node === document.activeElement
      : document.activeElement?.hasAttribute("data-upload-cta") === true))).toBe(true);
    await expectNoHorizontalOverflow(page);
    const focused = page.locator("[data-upload-cta]:focus");
    await expect(focused).toHaveCount(1);
    const target = await focused.elementHandle();
    const chooser = await expectOneChooser(page, () => focused.click());
    await chooser.setFiles([]);
    await expect.poll(() => target.evaluate((node) => node === document.activeElement)).toBe(true);
  });
}

// Codex review P2: with documents in the library there is no empty-state CTA, so when the
// focused upload control unmounts the handoff must fall back to the source-panel entry.
for (const transition of [
  { from: 768, to: 767, collapsedLeft: false },
  { from: 1279, to: 1280, collapsedLeft: true },
]) {
  test(`non-empty library: live resize ${transition.from} -> ${transition.to} hands focus to the source entry (${transition.collapsedLeft ? "collapsed" : "expanded"})`, async ({ page }) => {
    await page.setViewportSize({ width: transition.from, height: 900 });
    await openEmptyLibraryApp(page, { collapsedLeft: transition.collapsedLeft, sources: [INDEXED_SOURCE] });
    const rail = page.locator('[data-source-layout="rail"] [data-upload-cta]');
    await expect(rail).toBeVisible();
    await rail.focus();
    await expect(rail).toBeFocused();
    await page.setViewportSize({ width: transition.to, height: 900 });
    await expect(rail).toHaveCount(0);
    await expectFocusOnUsableUploadEntry(page);
    const focused = page.locator("[data-source-entry]:focus");
    await expect(focused).toHaveCount(1);
    await expect(page.locator("main [data-upload-cta]")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page.getByText("Thêm tài liệu", { exact: true })).toBeInViewport();
  });
}

// Codex review P2: an open tablet shelf must not leave its backdrop over the desktop layout.
// MainLayout closes the shelf whenever `tabletSourceRail` changes (leaving the tablet band too);
// focus must land on a control that is not covered.
test("shelf open: live resize 1279 -> 1280 hands focus to an uncovered upload control", async ({ page }) => {
  await page.setViewportSize({ width: 1279, height: 900 });
  await openEmptyLibraryApp(page);
  await page.getByRole("button", { name: "Mở rộng thư mục nguồn" }).click();
  const shelf = page.locator('[data-source-layout="shelf"]');
  await expect(shelf).toBeVisible();
  const shelfUpload = shelf.locator("[data-upload-cta]");
  await shelfUpload.focus();
  await expect(shelfUpload).toBeFocused();
  const original = await shelfUpload.elementHandle();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(() => original.evaluate((node) => node.isConnected)).toBe(false);
  await expect(page.locator("div.fixed.inset-0.z-30")).toHaveCount(0);
  await expectFocusOnUsableUploadEntry(page);
});
