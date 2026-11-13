// V6 quiz setup: the document picker says why a document cannot be used yet, an empty list says
// so, and generation progress is in words. Real app on the Vite dev server, API mocked.
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const OUT = process.env.V6_SHOT_OUT;
const TAG = process.env.V6_SHOT_TAG || "after";
if (OUT) mkdirSync(OUT, { recursive: true });
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const DOCS = [
  { document_id: "d1", title: "Kinh tế vi mô — Chương 3.pdf", status: "completed", ingest_status: "index_ready" },
  { document_id: "d2", title: "Xác suất thống kê — Bài giảng 5.pdf", status: "processing", ingest_status: "processing" },
  { document_id: "d3", title: "scan_bai_tap_tuan_7.pdf", status: "failed", ingest_status: "error" },
];

async function mock(page, { documents = DOCS, node = "BuSoCauThieu", width = 1440, dark = false } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((isDark) => {
    localStorage.setItem("memvid-token", "fixture-token");
    localStorage.setItem("memvid-theme", isDark ? "dark" : "light");
  }, dark);
  await page.route(/localhost:8080\//, (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/api/documents") return route.fulfill(json({ documents }));
    if (p === "/api/documents/d1") return route.fulfill(json(DOCS[0]));
    if (p === "/api/documents/d1/sections") return route.fulfill(json({ sections: [] }));
    if (/\/quizzes/.test(p) && req.method() === "POST") return route.fulfill(json({ job_id: "job-q" }));
    if (/job-q/.test(p)) return route.fulfill(json({ job_id: "job-q", status: "running", progress: 80, current_node: node }));
    return route.fulfill(json({}));
  });
}

for (const width of [390, 1440]) {
  for (const dark of [false, true]) {
    test(`${width}px ${dark ? "dark" : "light"}: the picker says why a document cannot be used yet`, async ({ page }) => {
      await mock(page, { width, dark });
      await page.goto("/app/study/quiz/new");
      const ready = page.getByRole("button", { name: /Kinh tế vi mô/ });
      await expect(ready).toBeEnabled();
      await expect(page.getByRole("button", { name: /Xác suất thống kê/ })).toBeDisabled();
      await expect(page.getByRole("button", { name: /scan_bai_tap/ })).toBeDisabled();
      await expect(page.getByText("Xử lý tài liệu bị lỗi nên chưa ra đề được.")).toBeVisible();
      if (OUT) await page.screenshot({ path: path.join(OUT, `quiz-setup-picker-${width}-${dark ? "dark" : "light"}-${TAG}.png`), fullPage: true });
    });
  }
}

test("an empty document list says so and leads to the Library", async ({ page }) => {
  await mock(page, { documents: [] });
  await page.goto("/app/study/quiz/new");
  await expect(page.getByText("Chưa có tài liệu nào để ra đề.")).toBeVisible();
  await page.getByRole("button", { name: "Về Thư viện" }).click();
  await expect(page).toHaveURL(/\/app\/study$/);
});

test("generation progress names the step in words, not the job's internal name", async ({ page }) => {
  await mock(page);
  await page.goto("/app/study/quiz/new?document=d1");
  await page.getByRole("button", { name: /Tạo quiz/ }).click();
  await expect(page.getByText("Đang viết thêm câu cho đủ số câu")).toBeVisible();
  await expect(page.getByText("BuSoCauThieu")).toHaveCount(0);
  if (OUT) await page.screenshot({ path: path.join(OUT, `quiz-setup-progress-1440-light-${TAG}.png`) });
});
