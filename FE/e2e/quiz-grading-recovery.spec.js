// Diagnostic grading recovery (#188) end to end: the real QuizResult page against the
// real backend (BE/scripts/run_e2e_server.py), with deterministic quiz generation and
// short-answer grading (E2E_DIAGNOSTIC_AI_STUB / E2E_SHORT_ANSWER_GRADING_STUB, set in
// playwright.config.js). No model is called: the spec refuses to run unless the server
// reports those stubs. An answer containing the crash marker makes the grading job itself
// fail every time (a dead worker), which is exactly a "stuck" attempt.
//
// Contract under test (owner-approved 2026-11-17):
//   202  grading accepted / still grading
//   200  a graded attempt resubmitted: the stored result, nothing regraded
//   409  the learner's retries of a stuck attempt are used up
import { test, expect } from "@playwright/test";
import { registerAndEnterApp } from "./fixtures.js";
import { BASE, apiSession, diagnosticQuiz, readyDocument, requireStubs, stubs,
         submittedAttempt as answeredAttempt } from "./quizFixtures.js";

const CRASH_MARKER = "__E2E_GRADE_CRASH__";   // E2E_GRADING_CRASH_MARKER, pinned in the config
const RETRY_MAX = 3;   // GRADING_MANUAL_RETRY_MAX, pinned in playwright.config.js

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => { await requireStubs(request); });

const submittedAttempt = (request, api, quizId, shortAnswer) => answeredAttempt(
  request, api, quizId, (q) => (q.question_type === "multiple_choice" ? "Correct" : shortAnswer));

const retryButton = (page) => page.getByRole("button", { name: /Thử chấm lại|Đang gửi/ });

test("a stuck attempt offers a retry, each retry is 202, and used-up retries end in 409", async ({ page, request }) => {
  test.setTimeout(180_000);
  await registerAndEnterApp(page);
  const api = await apiSession(page);
  const quizId = await diagnosticQuiz(request, api, await readyDocument(request, api));
  const attemptId = await submittedAttempt(request, api, quizId, `crashes ${CRASH_MARKER}`);
  const isSubmit = (r) => r.request().method() === "POST"
    && r.url().endsWith(`/api/attempts/${attemptId}/submit`);
  let submits = 0;
  const count = (r) => { if (isSubmit(r)) submits += 1; };
  page.on("response", count);

  await page.goto(`/app/study/result/${attemptId}`);
  await expect(page.getByText("Việc chấm bài đã dừng giữa chừng")).toBeVisible({ timeout: 30_000 });

  const dispatchesBefore = (await stubs(request)).grading_dispatches;
  const jobIds = new Set();
  for (let i = 1; i <= RETRY_MAX; i += 1) {
    const [res] = await Promise.all([page.waitForResponse(isSubmit), retryButton(page).click()]);
    expect(res.status(), `retry ${i} is accepted`).toBe(202);
    const body = await res.json();
    expect(body.grading, `retry ${i} starts grading`).toBe("pending");
    jobIds.add(body.job_id);
    await expect(page.getByText(i < RETRY_MAX ? "Lần chấm lại vừa rồi chưa thành công"
                                              : "chưa chấm được sau nhiều lần thử"))
      .toBeVisible({ timeout: 30_000 });
  }
  page.off("response", count);
  expect(submits, "one submit per retry click, no duplicates").toBe(RETRY_MAX);
  expect(jobIds.size, "each retry is its own grading job").toBe(RETRY_MAX);
  expect((await stubs(request)).grading_dispatches - dispatchesBefore,
    "the dispatch counter sees every retry").toBe(RETRY_MAX);
  await expect(retryButton(page)).toHaveCount(0);

  const refused = await request.post(`${BASE}/api/attempts/${attemptId}/submit`, { headers: api.headers });
  expect(refused.status(), "retries used up").toBe(409);
  expect((await refused.json()).error).toBe("Đã hết lượt thử chấm lại cho bài này");
});

test("a graded attempt shows its score, and resubmitting it returns the stored result (200)", async ({ page, request }) => {
  test.setTimeout(120_000);
  await registerAndEnterApp(page);
  const api = await apiSession(page);
  const quizId = await diagnosticQuiz(request, api, await readyDocument(request, api));
  const attemptId = await submittedAttempt(request, api, quizId, "a good short answer");

  await page.goto(`/app/study/result/${attemptId}`);
  await expect(page.getByText("2 / 2")).toBeVisible({ timeout: 30_000 });
  await expect(retryButton(page)).toHaveCount(0);

  const stored = await (await request.get(`${BASE}/api/quizzes/results/${attemptId}`, { headers: api.headers })).json();
  const before = await stubs(request);
  expect(before.grade_calls, "the grading stub counted the first grading").toBeGreaterThan(0);
  expect(before.grading_dispatches, "the first grading was dispatched and counted").toBeGreaterThan(0);
  const again = await request.post(`${BASE}/api/attempts/${attemptId}/submit`, { headers: api.headers });
  expect(again.status(), "a graded attempt resubmitted").toBe(200);
  const body = await again.json();
  expect(body.grading).toBe("done");
  for (const key of ["score", "max_score", "graded_at", "status"]) {
    expect(body[key], `resubmit returns the stored ${key}`).toEqual(stored[key]);
  }
  const after = await stubs(request);
  expect(after.grading_dispatches, "no grading job was dispatched").toBe(before.grading_dispatches);
  expect(after.grade_calls, "nothing was regraded").toBe(before.grade_calls);
});
