// V6 quiz result score header and review guide. Real app on the Vite dev server, API mocked.
// The result page shows the attempt question by question (a strip in quiz order that jumps
// to each question); the review guide has one filled action, on the highest-priority topic.
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const OUT = process.env.V6_SHOT_OUT;
const TAG = process.env.V6_SHOT_TAG || "after";
if (OUT) mkdirSync(OUT, { recursive: true });
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const VERDICTS = ["correct", "correct", "incorrect", "correct", "partial", "correct", "incorrect", "correct", "correct", "incorrect"];
const question = (verdict, i) => (verdict === "partial"
  ? { question_id: `q${i + 1}`, question_type: "short_answer", question_text: `Vì sao đường cầu dốc xuống? (${i + 1})`,
      user_answer: "Vì giá tăng", correct_answer: "Hiệu ứng thay thế và hiệu ứng thu nhập", verdict, score: 0.5,
      explanation: "Cần nêu cả hai hiệu ứng.", chunk_ids: ["c1"] }
  : { question_id: `q${i + 1}`, question_type: "multiple_choice", question_text: `Câu hỏi về cung cầu số ${i + 1}?`,
      options: ["Giá tăng", "Giá giảm", "Không đổi", "Không xác định"], correct_answer: "Giá tăng",
      user_answer: verdict === "correct" ? "Giá tăng" : "Giá giảm", verdict, score: verdict === "correct" ? 1 : 0,
      explanation: "Theo luật cầu.", chunk_ids: ["c2"] });
const RESULT = {
  status: "graded", quiz_title: "Kinh tế vi mô — Chương 3", score: 6.5, max_score: 10, percentage: 65,
  correct_count: 6, incorrect_count: 4, total_questions: 10, duration_seconds: 412,
  grading_complete: true, ungraded_count: 0, questions: VERDICTS.map(question),
};
const MASTERIES = [
  { concept_mastery_id: "m1", concept_name: "Luật cầu", status: "mastered", mastery_score: 0.9, correct_count: 4, total_count: 4 },
  { concept_mastery_id: "m2", concept_name: "Độ co giãn", status: "review_needed", mastery_score: 0.4, correct_count: 2, total_count: 5 },
  { concept_mastery_id: "m3", concept_name: "Thặng dư tiêu dùng", status: "critical_gap", mastery_score: 0.0, correct_count: 0, total_count: 1 },
];
const PLAN = {
  review_plan_id: "p1", attempt_id: "attempt-1", document_id: "d1",
  summary: "Bạn nắm luật cầu nhưng còn hổng ở thặng dư tiêu dùng và độ co giãn.",
  items: [
    { review_item_id: "i1", topic: "Thặng dư tiêu dùng", priority: 1, status: "critical_gap", mastery_score: 0,
      reason: "Sai câu duy nhất về chủ đề này.", review_tasks: ["Đọc lại mục 3.4", "Vẽ lại hình 3.7"], chunk_ids: ["c3", "c4"] },
    { review_item_id: "i2", topic: "Độ co giãn", priority: 2, status: "review_needed", mastery_score: 0.4,
      reason: "Đúng 2 trên 5 câu.", review_tasks: ["Làm lại ví dụ 3.2"], chunk_ids: ["c5"] },
  ],
};

async function mock(page, { width = 1440, dark = false } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((isDark) => {
    localStorage.setItem("memvid-token", "fixture-token");
    localStorage.setItem("memvid-theme", isDark ? "dark" : "light");
  }, dark);
  await page.route(/localhost:8080\//, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/api/quizzes/results/attempt-1") return route.fulfill(json(RESULT));
    if (p === "/api/attempts/attempt-1/concept-masteries") return route.fulfill(json({ concept_masteries: MASTERIES }));
    if (p === "/api/review-plans/attempt-1") return route.fulfill(json(PLAN));
    return route.fulfill(json({}));
  });
}

const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("capture: result and review guide at 390/1440, light and dark", async ({ page }) => {
  test.skip(!OUT, "set V6_SHOT_OUT to capture");
  for (const width of [390, 1440]) {
    for (const dark of [false, true]) {
      await mock(page, { width, dark });
      const mode = dark ? "dark" : "light";
      await page.goto("/app/study/result/attempt-1");
      await expect(page.locator(".quiz-score-hero")).toBeVisible();
      await page.screenshot({ path: path.join(OUT, `quiz-score-${width}-${mode}-${TAG}.png`) });
      await page.goto("/app/study/review/attempt-1");
      await expect(page.getByText("Thặng dư tiêu dùng").first()).toBeVisible();
      await page.screenshot({ path: path.join(OUT, `quiz-review-guide-${width}-${mode}-${TAG}.png`), fullPage: true });
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  }
});

for (const width of [320, 390, 1440]) {
  test(`${width}px: the strip shows every question in quiz order and jumps to it; no overflow`, async ({ page }) => {
    await mock(page, { width });
    await page.goto("/app/study/result/attempt-1");
    const cells = page.getByRole("list", { name: "Bài làm theo thứ tự câu" }).getByRole("button");
    await expect(cells).toHaveCount(10);
    await expect(cells.nth(2)).toHaveAccessibleName("Câu 3: Sai");
    await expect(cells.nth(4)).toHaveAccessibleName("Câu 5: Đúng một phần");
    await cells.nth(6).click();
    await expect(page.locator("#cau-7")).toBeFocused();
    await expect(page.locator("#cau-7")).toBeInViewport();
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  });
}

test("keyboard: Tab reaches the strip and Enter moves focus to the question", async ({ page }) => {
  await mock(page, { width: 1440 });
  await page.goto("/app/study/result/attempt-1");
  const first = page.getByRole("button", { name: "Câu 1: Đúng" });
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#cau-1")).toBeFocused();
});

test("review guide: one filled action, on the highest-priority topic; overview counts topics and passages", async ({ page }) => {
  await mock(page, { width: 1440 });
  await page.goto("/app/study/review/attempt-1");
  const practice = page.getByRole("button", { name: /Luyện ngay/ });
  await expect(practice).toHaveCount(2);
  await expect(practice.nth(0)).toHaveAttribute("data-emphasis", "primary");
  await expect(practice.nth(1)).toHaveAttribute("data-emphasis", "secondary");
  await expect(page.locator(".quiz-review-overview")).toHaveText("2 chủ đề cần ôn, chủ đề nắm yếu nhất đứng đầu. 3 đoạn tài liệu cần đọc lại.");
  expect(await noOverflow(page)).toBeLessThanOrEqual(0);
});
