// P0-1 (V4.1 audit D01/D02): Summary mode must create and open summaries.
// Real app on the Vite dev server, API mocked at the network layer.
import { test, expect } from "@playwright/test";

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const SAVED = {
  id: "s1", title: "Tóm tắt: Hệ điều hành", sources: ["tai-lieu-1"], created_at: "2026-11-01T00:00:00Z",
  content: "## Tổng quan\nHệ điều hành quản lý tiến trình.", summary: "Hệ điều hành quản lý tiến trình.",
};
const FRESH = { ...SAVED, id: "s2", title: "Tóm tắt mới", content: "## Ý mới\nNội dung vừa tạo.", summary: "Nội dung vừa tạo." };

async function openWorkspace(page, { summaries = [], generate = () => json({ status: "done", result: FRESH }) } = {}) {
  const posts = [];
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(/localhost:8080\//, async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p === "/generate-summary" && req.method() === "POST") {
      posts.push(req.postDataJSON());
      await new Promise((r) => setTimeout(r, 400)); // window for a second click
      return route.fulfill(generate());
    }
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [{ video: "tai-lieu-1", video_stem: "tai-lieu-1", filename: "Hệ điều hành.pdf", status: "index_ready" }] }));
    if (p === "/summaries") return route.fulfill(json({ summaries }));
    if (p === "/mindmaps") return route.fulfill(json({ mindmaps: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app?source=tai-lieu-1&tab=summary");
  await expect(page.locator('[role="tab"][title="Tóm tắt"][aria-selected="true"]')).toBeVisible();
  return posts;
}

test("an existing summary can be opened from Summary mode, also after reload", async ({ page }) => {
  await openWorkspace(page, { summaries: [SAVED] });
  const picker = page.getByRole("combobox", { name: "Chọn tóm tắt" }).first();
  await picker.selectOption({ label: SAVED.title });
  await expect(page.getByText("Hệ điều hành quản lý tiến trình.").first()).toBeVisible();

  await page.reload();
  await page.getByRole("combobox", { name: "Chọn tóm tắt" }).first().selectOption({ label: SAVED.title });
  await expect(page.getByText("Hệ điều hành quản lý tiến trình.").first()).toBeVisible();
});

test("'Tạo tóm tắt' sends exactly one request on a double click and opens the result", async ({ page }) => {
  const posts = await openWorkspace(page);
  const create = page.getByRole("button", { name: "Tạo tóm tắt" }).first();
  await create.dblclick();
  await expect(page.getByText("Nội dung vừa tạo.").first()).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0].sources).toEqual(["tai-lieu-1"]);
});

test("'Tạo tóm tắt' works from the keyboard", async ({ page }) => {
  const posts = await openWorkspace(page);
  await page.getByRole("button", { name: "Tạo tóm tắt" }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Nội dung vừa tạo.").first()).toBeVisible();
  expect(posts).toHaveLength(1);
});

test("a failed create shows an error and can be tried again", async ({ page }) => {
  let fail = true;
  const posts = await openWorkspace(page, { generate: () => (fail ? json({ error: "LLM quá tải" }, 503) : json({ status: "done", result: FRESH })) });
  await page.getByRole("button", { name: "Tạo tóm tắt" }).first().click();
  await expect(page.getByText(/Không tạo được tóm tắt|LLM quá tải/).first()).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Tạo tóm tắt" }).first().click();
  await expect(page.getByText("Nội dung vừa tạo.").first()).toBeVisible();
  expect(posts).toHaveLength(2);
});

test("with a summary open, 'Tạo tóm tắt mới' and the picker stay available", async ({ page }) => {
  const posts = await openWorkspace(page, { summaries: [SAVED] });
  await page.getByRole("combobox", { name: "Chọn tóm tắt" }).first().selectOption({ label: SAVED.title });
  await expect(page.getByText("Hệ điều hành quản lý tiến trình.").first()).toBeVisible();
  await page.getByRole("button", { name: "Tạo tóm tắt mới" }).first().click();
  await expect(page.getByText("Nội dung vừa tạo.").first()).toBeVisible();
  expect(posts).toHaveLength(1);
});
