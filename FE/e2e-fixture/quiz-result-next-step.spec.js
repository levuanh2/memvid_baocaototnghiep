// W2-1 (owner decision O5): Quiz Result's next-step action. Wrong answers ->
// primary "Kế hoạch ôn tập (N chủ đề)" + secondary "Xem lại câu chưa đúng". All
// correct -> primary "Về Thư viện", no secondary. Real app on the Vite dev
// server, API mocked at the network layer (pattern copied from
// FE/e2e-fixture/library-mode-navigation.spec.js).
import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const question = (i, verdict) => ({
  question_id: `q-${i}`, question_type: "multiple_choice", question_text: `Câu hỏi ${i}`,
  options: ["A", "B"], user_answer: verdict === "correct" ? "A" : "B", correct_answer: "A", verdict,
  explanation: `Giải thích ${i}`,
});

const EVIDENCE_DIR = "../docs/ui-ux-v4-1/evidence/w2-1";

async function mockAttempt(page, { result, masteries }) {
  await page.addInitScript(() => localStorage.setItem("memvid-token", "fixture-token"));
  await page.route(/localhost:8080\//, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/auth/me") return route.fulfill(json({ user: { id: "u1", email: "qa@example.test", display_name: "QA", provider: "local" } }));
    if (p === "/api/quizzes/results/attempt-1") return route.fulfill(json(result));
    if (p === "/api/attempts/attempt-1/concept-masteries") return route.fulfill(json({ concept_masteries: masteries }));
    return route.fulfill(json({}));
  });
}

test.beforeAll(async () => { await mkdir(new URL(EVIDENCE_DIR, import.meta.url), { recursive: true }); });

test("wrong answers: primary is the review plan with weak-topic count, secondary is 'Xem lại câu chưa đúng'", async ({ page }) => {
  await mockAttempt(page, {
    result: {
      status: "graded", quiz_title: "Quiz", score: 8, max_score: 10, percentage: 80,
      correct_count: 8, incorrect_count: 2, total_questions: 10, duration_seconds: 60,
      questions: [question(1, "incorrect"), question(2, "incorrect"), ...Array.from({ length: 8 }, (_, i) => question(i + 3, "correct"))],
    },
    masteries: [
      { concept_mastery_id: "m1", concept_name: "A", status: "review_needed", mastery_score: 0.3, correct_count: 1, total_count: 3 },
      { concept_mastery_id: "m2", concept_name: "B", status: "review_needed", mastery_score: 0.4, correct_count: 1, total_count: 2 },
      { concept_mastery_id: "m3", concept_name: "C", status: "mastered", mastery_score: 0.9, correct_count: 3, total_count: 3 },
    ],
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/study/result/attempt-1");
  const primary = page.getByRole("link", { name: /Kế hoạch ôn tập \(2 chủ đề\)/ });
  await expect(primary).toBeVisible();
  await expect(page.getByRole("button", { name: "Xem lại câu chưa đúng" })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/wrong-answers-1440.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(primary).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/wrong-answers-390.png`, fullPage: true });
});

test("all correct: primary goes back to the Library, no secondary action", async ({ page }) => {
  await mockAttempt(page, {
    result: {
      status: "graded", quiz_title: "Quiz", score: 10, max_score: 10, percentage: 100,
      correct_count: 10, incorrect_count: 0, total_questions: 10, duration_seconds: 60,
      questions: Array.from({ length: 10 }, (_, i) => question(i + 1, "correct")),
    },
    masteries: [{ concept_mastery_id: "m1", concept_name: "A", status: "mastered", mastery_score: 1, correct_count: 3, total_count: 3 }],
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/study/result/attempt-1");
  const library = page.getByRole("link", { name: "Về Thư viện" });
  await expect(library).toBeVisible();
  await expect(page.getByRole("button", { name: "Xem lại câu chưa đúng" })).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE_DIR}/all-correct-1440.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(library).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/all-correct-390.png`, fullPage: true });
});
