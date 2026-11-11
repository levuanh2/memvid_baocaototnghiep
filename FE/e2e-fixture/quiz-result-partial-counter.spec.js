// Owner decision after PR #137: Quiz Result counts "Đúng / Đúng một phần / Sai"
// separately (a partial answer is no longer shown inside "Sai"). Real app on the Vite
// dev server, API mocked at the network layer (same pattern as
// quiz-result-next-step.spec.js). Checks the counters and the small-screen layout.
import { test, expect } from "@playwright/test";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const question = (i, verdict) => ({
  question_id: `q-${i}`, question_type: "short_answer", question_text: `Câu hỏi ${i}`,
  user_answer: "x", correct_answer: "y", verdict, score: { correct: 1, partial: 0.5, incorrect: 0 }[verdict],
  explanation: `Giải thích ${i}`,
});

// 1 correct + 2 partial + 1 incorrect: score 2 / 4 = 50%; the backend counts
// correct_count 1 and incorrect_count 3 (partials included).
const RESULT = {
  status: "graded", quiz_title: "Quiz", score: 2, max_score: 4, percentage: 50,
  correct_count: 1, incorrect_count: 3, total_questions: 4, duration_seconds: 60,
  grading_complete: true, ungraded_count: 0,
  questions: [question(1, "correct"), question(2, "partial"), question(3, "partial"), question(4, "incorrect")],
};

async function openResult(page) {
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(/localhost:8080\//, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/api/quizzes/results/attempt-1") return route.fulfill(json(RESULT));
    if (p === "/api/attempts/attempt-1/concept-masteries") return route.fulfill(json({ concept_masteries: [] }));
    return route.fulfill(json({}));
  });
  await page.goto("/app/study/result/attempt-1");
  await expect(page.locator(".quiz-score-hero")).toBeVisible();
}

const counters = (page) => page.locator(".quiz-score-hero [data-score-stat]").evaluateAll((els) =>
  Object.fromEntries(els.map((el) => [
    el.querySelector("[data-score-stat-label]").textContent.trim(),
    el.querySelector("[data-score-stat-value]").textContent.trim(),
  ])));

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 720 }]) {
  test(`${viewport.width}px: Đúng 1 · Đúng một phần 2 · Sai 1 next to 50% điểm, all counters on screen, no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openResult(page);
    const c = await counters(page);
    expect([c["Đúng"], c["Đúng một phần"], c["Sai"]]).toEqual(["1", "2", "1"]);
    await expect(page.locator(".quiz-score-hero")).toContainText("50% điểm");
    const boxes = await page.locator(".quiz-score-hero [data-score-stat]").evaluateAll((els) =>
      els.map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; }));
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(viewport.width);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
