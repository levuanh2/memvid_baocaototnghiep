// W1-4: below `md` (768px) the empty-Chat hint must not say "bên trái" (there
// is no left column on a phone) and must instead offer a real button that
// opens the sources drawer. jsdom (unit tests) never applies CSS media
// queries, so this is the real check that the Tailwind `md:hidden`/`hidden
// md:block` split actually renders correctly in a real browser. Real app on
// the Vite dev server, API mocked at the network layer (pattern copied from
// FE/e2e-fixture/library-mode-navigation.spec.js).
import { test, expect } from "@playwright/test";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function openEmptyChat(page) {
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(/localhost:8080\//, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    // A non-empty library: this spec is about item 1 (the mobile hint/
    // drawer-button split for "none SELECTED"), not item 2's separate "no
    // documents at all" upload CTA (covered by no-documents-empty-state.spec.js).
    if (p === "/list-indexed") return route.fulfill(json({ sources: [{ video: "tai-lieu-1", video_stem: "tai-lieu-1", filename: "Tài liệu 1.pdf", status: "index_ready" }] }));
    if (p === "/api/documents" || p === "/api/library") return route.fulfill(json({ documents: [], collections: [] }));
    if (p === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    if (p === "/summaries") return route.fulfill(json({ summaries: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app");
  await expect(page.getByText("Hỏi tài liệu của bạn")).toBeVisible();
}

for (const width of [320, 390]) {
  test(`at ${width}px: hint has no "bên trái", and the drawer button opens the sources panel`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openEmptyChat(page);

    // Full exact sentence, not a substring match: other panes (Mind Map/
    // Summary, simultaneously mounted but `hidden`) have their own
    // unrelated "bên trái" caption, and a bare substring locator would hit
    // those too.
    await expect(page.getByText(
      "Mỗi câu trả lời được truy hồi từ tài liệu đã chọn và gắn nguồn ở lề phải. Chọn tài liệu bên trái, rồi đặt câu hỏi.",
      { exact: true },
    )).toBeHidden();
    const button = page.getByRole("button", { name: "Mở thư mục nguồn" }).first();
    await expect(button).toBeVisible();

    // The real drawer SidebarLeft slides in from off-screen on click -- check
    // its own upload control actually lands inside the viewport,
    // not just that its node exists in the DOM. Several controls are named
    // "Tải tài liệu lên", so target the panel's own button, not a name.
    const addButton = page.locator('aside [data-upload-cta]:not(.source-rail__add)');
    const before = await addButton.boundingBox();
    expect(before === null || before.x < 0).toBe(true);
    await button.click();
    // The drawer is always `display`-visible (only its transform moves it
    // on/off-screen, see the `before` check above), so plain `toBeVisible()`
    // would already pass pre-click -- poll the actual position until the
    // 200ms slide-in transition settles instead.
    await expect.poll(async () => (await addButton.boundingBox())?.x).toBeGreaterThanOrEqual(0);
    const after = await addButton.boundingBox();
    expect(after.x).toBeLessThan(width);
  });
}

test("at 1440px: desktop hint keeps 'bên trái' and the mobile drawer button is not shown", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEmptyChat(page);

  await expect(page.getByText(
    "Mỗi câu trả lời được truy hồi từ tài liệu đã chọn và gắn nguồn ở lề phải. Chọn tài liệu bên trái, rồi đặt câu hỏi.",
    { exact: true },
  )).toBeVisible();
  // The button still exists in the DOM (md:hidden, not removed) but must not
  // be visible at this breakpoint.
  await expect(page.getByRole("button", { name: "Mở thư mục nguồn" }).first()).toBeHidden();
});
