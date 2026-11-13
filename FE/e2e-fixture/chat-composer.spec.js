// V6 chat composer: after an answer, every follow-up suggestion and the input stay inside the
// composer at every width (they were cut at its right edge), and stopping looks different from
// sending. Real app on the Vite dev server, API mocked at the network layer.
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const OUT = process.env.V6_SHOT_OUT;
const TAG = process.env.V6_SHOT_TAG || "after";
if (OUT) mkdirSync(OUT, { recursive: true });
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const STEM = "kinh-te-vi-mo";
const RESULT = {
  payload: {
    answer: "Khi giá tăng, **lượng cầu giảm** [Nguồn: kinh-te-vi-mo, đoạn 12].",
    sources: [STEM],
    chunks: [{ video_stem: STEM, chunk_id: 12, text: "Luật cầu.", page: 4 }],
  },
};

async function openChat(page, { width, dark = false, holdStream = false }) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((isDark) => {
    localStorage.setItem("memvid-token", "fixture-token");
    localStorage.setItem("memvid-theme", isDark ? "dark" : "light");
  }, dark);
  await page.route(/localhost:8080\//, async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/list-indexed") return route.fulfill(json({ sources: [{ video: STEM, video_stem: STEM, filename: "Kinh tế vi mô — Chương 3: Cung và cầu trên thị trường hàng hoá.pdf", status: "index_ready", can_query: true }] }));
    if (p === "/query" && req.method() === "POST") return route.fulfill(json({ job_id: "job-1" }));
    if (p === "/query-stream/job-1") {
      if (holdStream) return; // never answers: the question stays in flight
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: `data: ${JSON.stringify({ status: "done", result: RESULT })}\n\n` });
    }
    return route.fulfill(json({}));
  });
  await page.goto(`/app?source=${STEM}`);
  await page.locator("textarea").first().fill("Khi giá tăng thì lượng cầu thay đổi thế nào?");
  await page.getByRole("button", { name: "Gửi câu hỏi" }).click();
}

for (const width of [320, 390, 768, 1440]) {
  for (const dark of [false, true]) {
    test(`${width}px ${dark ? "dark" : "light"}: follow-up suggestions and the input stay inside the composer`, async ({ page }) => {
      await openChat(page, { width, dark });
      const group = page.getByRole("group", { name: "Câu hỏi gợi ý" });
      await expect(group).toBeVisible();
      const items = group.getByRole("button");
      await expect(items).toHaveCount(3);
      // Names, not file names: no ".pdf" in a suggestion.
      for (const text of await items.allTextContents()) expect(text).not.toMatch(/\.pdf/);
      const composer = await group.evaluate((el) => el.parentElement.getBoundingClientRect().toJSON());
      for (let i = 0; i < 3; i += 1) {
        const box = await items.nth(i).boundingBox();
        expect(box.x, `suggestion ${i} left`).toBeGreaterThanOrEqual(composer.x - 0.5);
        expect(box.x + box.width, `suggestion ${i} right`).toBeLessThanOrEqual(composer.right + 0.5);
        if (width < 768) expect(Math.round(box.height * 100) / 100, `suggestion ${i} height`).toBeGreaterThanOrEqual(44);
      }
      const input = await page.locator("textarea").first().boundingBox();
      expect(input.x + input.width).toBeLessThanOrEqual(composer.right + 0.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      if (OUT) await page.screenshot({ path: path.join(OUT, `composer-${width}-${dark ? "dark" : "light"}-${TAG}.png`) });
    });
  }
}

test("a suggestion is reachable from the keyboard and fills the input", async ({ page }) => {
  await openChat(page, { width: 1440 });
  const first = page.getByRole("group", { name: "Câu hỏi gợi ý" }).getByRole("button").first();
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("textarea").first()).toHaveValue(await first.textContent());
});

test("while an answer is coming, the control says 'Huỷ' in words and does not look like send", async ({ page }) => {
  await openChat(page, { width: 390, holdStream: true });
  const stop = page.getByRole("button", { name: "Huỷ truy vấn" });
  await expect(stop).toBeVisible();
  await expect(stop).toContainText("Huỷ");
  await expect(page.getByRole("button", { name: "Gửi câu hỏi" })).toHaveCount(0);
  const box = await stop.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
});
