// Provisional grading recovery end to end (owner-approved 2026-11-17, stacked on #188):
// the AI grader fails on one short answer, the result page shows "Kết quả tạm thời",
// and "Chấm lại câu còn thiếu" regrades exactly that answer. Real Flask + PostgreSQL +
// browser; the model is the deterministic stub of run_e2e_server.py:
//   __E2E_GRADE_FAIL_ONCE__  the first model call for that answer fails, later ones pass
//   __E2E_GRADE_FAIL__       every model call for that answer fails
// Contract: 202 + one job while regrading, 200 with the stored result when nothing is
// left, 409 when retries are used up (no model call), 404 for another learner.
import { test, expect } from "@playwright/test";
import { freshTestUser, registerAndEnterApp } from "./fixtures.js";
import { BASE, apiSession, diagnosticQuiz, readyDocument, requireStubs, stubs,
         submittedAttempt } from "./quizFixtures.js";

const RETRY_MAX = 3;   // GRADING_MANUAL_RETRY_MAX, pinned in playwright.config.js
const MISSING = "E2E diagnostic short answer 2?";
const PROTECTED = process.env.E2E_EXPECT_PROTECTED_AUTH === "true";

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ request }) => { await requireStubs(request); });

/** A graded attempt whose second short answer the model could not grade. */
async function provisionalAttempt(page, request, marker) {
  await registerAndEnterApp(page);
  const api = await apiSession(page);
  const quizId = await diagnosticQuiz(request, api, await readyDocument(request, api), 3);
  const tag = `${Date.now()}-${Math.random()}`;   // fail-once is keyed by the answer text
  const attemptId = await submittedAttempt(request, api, quizId, (q) => (
    q.question_type === "multiple_choice" ? "Correct"
      : q.question_text === MISSING ? `second ${marker} ${tag}` : "first answer"));
  let r = null;
  await expect.poll(async () => {
    r = await (await request.get(`${BASE}/api/quizzes/results/${attemptId}`,
                                 { headers: api.headers })).json();
    return r.status;
  }, { timeout: 30_000 }).toBe("graded");
  expect(r.ungraded_count).toBe(1);
  expect(r.grading_complete).toBe(false);
  expect(r.regrade_state).toBe("available");
  return { api, attemptId };
}

const overview = async (request, api) =>
  (await request.get(`${BASE}/api/progress/overview`, { headers: api.headers })).json();
// This attempt's own progress row. The overview totals are per learner, so they are
// checked with protected auth only (open auth shares one owner across every test).
async function progressRow(request, api, attemptId) {
  const body = await (await request.get(`${BASE}/api/progress/attempts?limit=200`,
                                         { headers: api.headers })).json();
  const row = (Array.isArray(body) ? body : body.attempts || []).find((a) => a.attempt_id === attemptId);
  expect(row, "the attempt is in the progress history").toBeTruthy();
  return row;
}
const regradeButton = (page) => page.getByRole("button", { name: /Chấm lại câu còn thiếu|Đang gửi/ });
const isRegrade = (attemptId) => (r) => r.request().method() === "POST"
  && r.url().endsWith(`/api/attempts/${attemptId}/regrade`);

test("a failed AI grading is regraded: only the missing answer, then the full score and progress", async ({ page, request }) => {
  test.setTimeout(150_000);
  const { api, attemptId } = await provisionalAttempt(page, request, "__E2E_GRADE_FAIL_ONCE__");
  expect((await progressRow(request, api, attemptId)).grading_complete,
    "a provisional result is not complete").toBe(false);
  if (PROTECTED) {
    const progress = await overview(request, api);
    expect(progress.completion_rate).toBe(0);
    expect(progress.average_percentage).toBeNull();
  }

  await page.goto(`/app/study/result/${attemptId}`);
  await expect(page.getByText("Kết quả tạm thời.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("1 câu chưa chấm được")).toBeVisible();

  // At 320px the banner text keeps a readable width and nothing scrolls sideways (agy
  // task35: a side-by-side button left the text a ~20px column).
  await page.setViewportSize({ width: 320, height: 720 });
  const explanation = page.getByText(/câu chưa chấm được do bộ chấm AI/);
  await expect(regradeButton(page)).toBeVisible();
  expect((await explanation.boundingBox()).width, "banner text width at 320px").toBeGreaterThan(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth),
    "no horizontal scroll at 320px").toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 1280, height: 720 });

  const before = await stubs(request);
  const [res] = await Promise.all([page.waitForResponse(isRegrade(attemptId)),
                                   regradeButton(page).click()]);
  expect(res.status(), "the regrade is accepted").toBe(202);
  const body = await res.json();
  expect(body.grading).toBe("pending");
  expect(body.job_id).toBeTruthy();

  await expect(page.getByText("3 / 3")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Kết quả tạm thời.")).toHaveCount(0);
  await expect(regradeButton(page)).toHaveCount(0);

  const after = await stubs(request);
  expect(after.graded_questions.slice(before.graded_questions.length),
    "the model is asked about the missing answer only").toEqual([MISSING]);
  expect(after.grading_dispatches - before.grading_dispatches).toBe(1);

  const row = await progressRow(request, api, attemptId);
  expect([row.grading_complete, row.score, row.max_score, row.ungraded_count]).toEqual([true, 3, 3, 0]);
  if (PROTECTED) {
    const done = await overview(request, api);
    expect(done.completion_rate).toBe(1);
    expect(done.average_percentage).toBe(100);
  }

  const again = await request.post(`${BASE}/api/attempts/${attemptId}/regrade`, { headers: api.headers });
  expect(again.status(), "nothing left to regrade: the stored result").toBe(200);
  expect((await again.json()).grading).toBe("done");
  expect((await stubs(request)).grading_dispatches).toBe(after.grading_dispatches);
});

test("two regrades at the same time start one job", async ({ page, request }) => {
  test.setTimeout(120_000);
  const { api, attemptId } = await provisionalAttempt(page, request, "__E2E_GRADE_FAIL_ONCE__");
  const before = (await stubs(request)).grading_dispatches;
  const send = () => request.post(`${BASE}/api/attempts/${attemptId}/regrade`, { headers: api.headers });
  const [a, b] = await Promise.all([send(), send()]);
  expect([a.status(), b.status()]).toEqual([202, 202]);
  const [ja, jb] = [(await a.json()).job_id, (await b.json()).job_id];
  expect(ja).toBeTruthy();
  expect(jb, "both requests answer with the same job").toBe(ja);
  expect((await stubs(request)).grading_dispatches - before).toBe(1);
});

test("used-up retries end in 409 with a plain message, keep the provisional result, and call no model", async ({ page, request }) => {
  test.setTimeout(180_000);
  const { api, attemptId } = await provisionalAttempt(page, request, "__E2E_GRADE_FAIL__");
  await page.goto(`/app/study/result/${attemptId}`);
  await expect(page.getByText("Kết quả tạm thời.")).toBeVisible({ timeout: 30_000 });

  for (let i = 1; i <= RETRY_MAX; i += 1) {
    const [res] = await Promise.all([page.waitForResponse(isRegrade(attemptId)),
                                     regradeButton(page).click()]);
    expect(res.status(), `regrade ${i} is accepted`).toBe(202);
    await expect(page.getByText(i < RETRY_MAX ? "Lần chấm lại vừa rồi chưa chấm được các câu này"
                                              : "Đã hết lượt chấm lại cho bài này"))
      .toBeVisible({ timeout: 30_000 });
  }
  await expect(regradeButton(page)).toHaveCount(0);
  await expect(page.getByText("Kết quả tạm thời.")).toBeVisible();
  // The provisional score is kept: 2 of the 3 answers graded, one still missing.
  await expect(page.getByText("điểm tạm tính trên 2 câu đã chấm")).toBeVisible();
  const kept = await (await request.get(`${BASE}/api/quizzes/results/${attemptId}`,
                                        { headers: api.headers })).json();
  expect([kept.status, kept.score, kept.max_score, kept.ungraded_count, kept.regrade_state])
    .toEqual(["graded", 2, 2, 1, "exhausted"]);

  const calls = (await stubs(request)).grade_calls;
  const refused = await request.post(`${BASE}/api/attempts/${attemptId}/regrade`, { headers: api.headers });
  expect(refused.status(), "retries used up").toBe(409);
  expect((await refused.json()).error).toBe("Đã hết lượt thử chấm lại cho bài này");
  expect((await stubs(request)).grade_calls, "no model call after the retries are used up").toBe(calls);
});

test("another learner cannot regrade or read the attempt (404)", async ({ page, request }) => {
  test.skip(!PROTECTED, "open auth shares one anonymous owner; ownership holds only with protected auth");
  test.setTimeout(120_000);
  const { attemptId } = await provisionalAttempt(page, request, "__E2E_GRADE_FAIL_ONCE__");
  const other = freshTestUser();
  const reg = await request.post(`${BASE}/auth/register`,
                                 { data: { email: other.email, password: other.password } });
  expect(reg.status(), "second learner registered").toBe(201);
  const headers = { Authorization: `Bearer ${(await reg.json()).token}` };
  const before = (await stubs(request)).grading_dispatches;
  expect((await request.post(`${BASE}/api/attempts/${attemptId}/regrade`, { headers })).status()).toBe(404);
  expect((await request.get(`${BASE}/api/quizzes/results/${attemptId}`, { headers })).status()).toBe(404);
  expect((await stubs(request)).grading_dispatches).toBe(before);
});
