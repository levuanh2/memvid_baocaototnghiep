// Learning progress page (V6 Wave 1): only numbers the progress routes return, links to the
// review guide, results and documents, filter, empty state, no overflow at phone width.
import { test, expect } from "@playwright/test";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const CONCEPTS = [
  { concept_name: "Cân bằng thị trường", document_id: "d1", status: "critical_gap", first_mastery_score: 0.4, mastery_score: 0.2, best_mastery_score: 0.4, attempt_count: 2, last_attempt_id: "at2", improvement: -0.2 },
  { concept_name: "Độ co giãn của cầu theo giá", document_id: "d1", status: "review_needed", first_mastery_score: 0.25, mastery_score: 0.55, best_mastery_score: 0.55, attempt_count: 3, last_attempt_id: "at2", improvement: 0.3 },
  { concept_name: "Chi phí cơ hội", document_id: "d2", status: "light_review", first_mastery_score: 0.7, mastery_score: 0.7, best_mastery_score: 0.7, attempt_count: 1, last_attempt_id: "at1", improvement: 0 },
  { concept_name: "Đường giới hạn khả năng sản xuất", document_id: "d2", status: "mastered", first_mastery_score: 0.5, mastery_score: 0.9, best_mastery_score: 0.9, attempt_count: 2, last_attempt_id: "at1", improvement: 0.4 },
];
const ATTEMPTS = [
  { attempt_id: "at3", quiz_id: "q3", quiz_title: "Ôn cân bằng thị trường", quiz_type: "practice", status: "graded", score: 4, max_score: 5, percentage: 80, ungraded_count: 0, duration_seconds: 192, submitted_at: "2026-11-14T09:00:00Z" },
  { attempt_id: "at2", quiz_id: "q2", quiz_title: "Kiểm tra chương 2", quiz_type: "diagnostic", status: "graded", score: 5.5, max_score: 9, percentage: 61.11, ungraded_count: 1, duration_seconds: 640, submitted_at: "2026-11-13T09:00:00Z" },
  { attempt_id: "at4", quiz_id: "q4", quiz_title: "Kiểm tra chương 3", quiz_type: "diagnostic", status: "in_progress", score: null, max_score: 10, percentage: null, started_at: "2026-11-15T09:00:00Z" },
];
const OVERVIEW = { average_percentage: 70.5, attempt_count_by_status: { graded: 2, in_progress: 1 } };
const LIBRARY = { documents: [{ document_id: "d1", display_name: "Kinh tế vi mô" }, { document_id: "d2", display_name: "Nhập môn kinh tế học" }], collections: [] };

async function open(page, { width = 1440, height = 900, dark = false, empty = false } = {}) {
  await page.setViewportSize({ width, height });
  await page.addInitScript((theme) => {
    localStorage.setItem("memvid-token", "fixture-token");
    localStorage.setItem("memvid-theme", theme);
  }, dark ? "dark" : "light");
  await page.route(/localhost:8080\//, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/api/progress/overview") return route.fulfill(json(empty ? { average_percentage: null } : OVERVIEW));
    if (p === "/api/progress/concepts") return route.fulfill(json({ concepts: empty ? [] : CONCEPTS }));
    if (p === "/api/progress/attempts") return route.fulfill(json({ attempts: empty ? [] : ATTEMPTS }));
    if (p === "/api/library") return route.fulfill(json(LIBRARY));
    return route.fulfill(json({}));
  });
  await page.goto("/app/study/progress");
}

test("the thesis states the server's numbers and the weakest concept", async ({ page }) => {
  await open(page);
  await expect(page.locator(".lp-thesis")).toHaveText(
    "Đã nắm tốt 1 trên 4 khái niệm. 3 khái niệm cần ôn, yếu nhất là “Cân bằng thị trường”. Trung bình 71% điểm trên các bài đã chấm xong. 1 bài đang làm dở.",
  );
});

test("weak concepts first, grouped by document; each links to its review guide", async ({ page }) => {
  await open(page);
  const rows = page.locator(".lp-concept");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("Cân bằng thị trường");
  await expect(rows.first()).toContainText("Lần đầu 40% → nay 20% (giảm 20), 2 lần làm bài");
  await expect(page.getByRole("link", { name: "Kinh tế vi mô" })).toHaveAttribute("href", "/app/study/map/d1");
  await expect(page.getByRole("link", { name: "Ôn lại Cân bằng thị trường" })).toHaveAttribute("href", "/app/study/review/at2");
  await page.getByRole("button", { name: /Đã nắm tốt/ }).click();
  await expect(page.getByRole("button", { name: /Đã nắm tốt/ })).toHaveAttribute("aria-pressed", "true");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Đường giới hạn khả năng sản xuất");
  await expect(page.getByRole("link", { name: /Ôn lại/ })).toHaveCount(0);
});

test("past attempts: score in points, provisional said, in-progress continues", async ({ page }) => {
  await open(page);
  const rows = page.locator(".lp-attempt");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("80% điểm · 4 / 5");
  await expect(rows.nth(0)).toContainText("Luyện tập");
  await expect(rows.nth(1)).toContainText("Tạm tính 61% điểm · 5.5 / 9");
  await expect(rows.nth(2)).toContainText("Đang làm dở");
  await expect(page.getByRole("link", { name: "Làm tiếp: Kiểm tra chương 3" })).toHaveAttribute("href", "/app/study/quiz/q4");
  await expect(page.getByRole("link", { name: "Xem bài: Kiểm tra chương 2" })).toHaveAttribute("href", "/app/study/result/at2");
});

test("no graded work yet: one direction, no zeros", async ({ page }) => {
  await open(page, { empty: true });
  await expect(page.getByText("Chưa có bài nào được chấm.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Chọn tài liệu để kiểm tra" })).toHaveAttribute("href", "/app/study");
  await expect(page.locator("main")).not.toContainText("0%");
});

for (const width of [320, 390]) {
  test(`${width}px: no sideways scroll, actions are 44px tall`, async ({ page }) => {
    await open(page, { width, height: 844 });
    await expect(page.locator(".lp-concept").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const box of await page.locator(".lp-concept__action, .lp-attempt__action").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
  });
}

test("capture: 390 and 1440, light and dark", async ({ page }) => {
  const out = process.env.V6_SHOT_OUT;
  test.skip(!out, "set V6_SHOT_OUT to capture");
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    for (const dark of [false, true]) {
      await open(page, { width, height, dark });
      await expect(page.locator(".lp-concept").first()).toBeVisible();
      await page.screenshot({ path: `${out}/learning-progress-${width}-${dark ? "dark" : "light"}.png`, fullPage: true });
    }
  }
});
