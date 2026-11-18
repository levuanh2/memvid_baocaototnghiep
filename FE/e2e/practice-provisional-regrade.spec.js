// Practice provisional regrade end to end (#159 item 17, #192; owner task39): a practice
// short answer the AI grader could not grade leaves "Kết quả tạm thời"; "Chấm lại câu
// còn thiếu" regrades it inside the request (no job). Real Flask + PostgreSQL + browser;
// the model is the deterministic stub of run_e2e_server.py:
//   __E2E_GRADE_FAIL_ONCE__  the first model call for that answer fails, later ones pass
//   __E2E_GRADE_FAIL__       every model call for that answer fails
// Also: a reload keeps the provisional result and its offer (or the used-up news), and
// the generic result page regrades a practice attempt the practice way.
import { test, expect } from "@playwright/test";
import { BASE, apiSession, diagnosticQuiz, readyDocument, requireStubs, stubs,
         submittedAttempt } from "./quizFixtures.js";
import { registerAndEnterApp } from "./fixtures.js";

const RETRY_MAX = 3;   // GRADING_MANUAL_RETRY_MAX, pinned in playwright.config.js
const SHORT = "E2E practice short answer?";

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ request }) => { await requireStubs(request); });

/** A practice quiz on the weak topic of a graded diagnostic attempt. */
async function practiceQuiz(page, request) {
  await registerAndEnterApp(page);
  const api = await apiSession(page);
  const quizId = await diagnosticQuiz(request, api, await readyDocument(request, api), 2);
  const attemptId = await submittedAttempt(request, api, quizId, (q) => (
    q.question_type === "multiple_choice" ? "Wrong" : "first answer"));
  await expect.poll(async () => (await (await request.get(`${BASE}/api/quizzes/results/${attemptId}`,
    { headers: api.headers })).json()).status, { timeout: 30_000 }).toBe("graded");
  const plan = await request.post(`${BASE}/api/review-plans/generate`,
                                  { headers: api.headers, data: { attempt_id: attemptId } });
  expect([200, 201], `review plan: ${await plan.text()}`).toContain(plan.status());
  const item = (await plan.json()).items.find((i) => i.chunk_ids.length > 0);
  expect(item, "a weak topic with source passages").toBeTruthy();
  const gen = await request.post(`${BASE}/api/practice/generate`,
                                 { headers: api.headers, data: { review_item_id: item.review_item_id } });
  expect(gen.status(), `practice generation: ${await gen.text()}`).toBe(202);
  const { job_id: jobId } = await gen.json();
  let practiceId = null;
  await expect.poll(async () => {
    const st = await (await request.get(`${BASE}/api/quizzes/jobs/${jobId}`, { headers: api.headers })).json();
    practiceId = st.result?.quiz_id || null;
    return st.status === "error" ? `error: ${st.error}` : st.status;
  }, { timeout: 60_000 }).toBe("done");
  return { api, practiceId };
}

/** Answer in the page and submit; returns the submit response body. */
async function submitInPage(page, practiceId, marker) {
  await page.goto(`/app/study/practice/${practiceId}`);
  await page.getByRole("button", { name: /Correct/ }).click();
  await page.getByPlaceholder("Viết câu trả lời ngắn…").fill(`practice ${marker} ${Date.now()}-${Math.random()}`);
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST"
      && r.url().endsWith(`/api/practice/${practiceId}/submit`)),
    page.getByRole("button", { name: "Nộp bài luyện tập" }).click(),
  ]);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect([body.grading_complete, body.ungraded_count]).toEqual([false, 1]);
  await expect(page.getByText("Kết quả tạm thời.")).toBeVisible();
  return body;
}

const regradeButton = (page) => page.getByRole("button", { name: /Chấm lại câu còn thiếu|Đang chấm lại/ });
const isPracticeRegrade = (practiceId) => (r) => r.request().method() === "POST"
  && r.url().endsWith(`/api/practice/${practiceId}/regrade`);

test("a practice short answer the grader missed is regraded inside the request, once", async ({ page, request }) => {
  test.setTimeout(150_000);
  const { practiceId } = await practiceQuiz(page, request);
  await submitInPage(page, practiceId, "__E2E_GRADE_FAIL_ONCE__");

  // A reload keeps the provisional result and its offer (task39).
  await page.reload();
  await expect(page.getByText("Kết quả tạm thời.")).toBeVisible({ timeout: 30_000 });
  await expect(regradeButton(page)).toBeVisible();

  const before = await stubs(request);
  const [res] = await Promise.all([page.waitForResponse(isPracticeRegrade(practiceId)),
                                   regradeButton(page).click()]);
  expect(res.status(), "graded inside the request").toBe(200);
  const body = await res.json();
  expect([body.grading, body.grading_complete, body.ungraded_count]).toEqual(["done", true, 0]);
  await expect(page.getByText("Kết quả tạm thời.")).toHaveCount(0);
  await expect(regradeButton(page)).toHaveCount(0);

  const after = await stubs(request);
  expect(after.graded_questions.slice(before.graded_questions.length),
    "the model is asked about the missing answer only, once").toEqual([SHORT]);
  expect(after.grading_dispatches, "no background job").toBe(before.grading_dispatches);

  await page.reload();
  await expect(page.getByText("Nộp bài luyện tập")).toHaveCount(0);
  await expect(page.getByText("Kết quả tạm thời.")).toHaveCount(0);
});

test("used-up retries: the page says so, also after a reload, and no model is called", async ({ page, request }) => {
  test.setTimeout(180_000);
  const { api, practiceId } = await practiceQuiz(page, request);
  const submitted = await submitInPage(page, practiceId, "__E2E_GRADE_FAIL__");

  for (let i = 1; i <= RETRY_MAX; i += 1) {
    const [res] = await Promise.all([page.waitForResponse(isPracticeRegrade(practiceId)),
                                     regradeButton(page).click()]);
    expect(res.status(), `regrade ${i}`).toBe(200);
    await expect(page.getByText("Lần chấm lại vừa rồi chưa chấm được các câu này")).toBeVisible();
  }
  const [last] = await Promise.all([page.waitForResponse(isPracticeRegrade(practiceId)),
                                    regradeButton(page).click()]);
  expect(last.status()).toBe(409);
  await expect(page.getByText("Đã hết lượt chấm lại cho bài này.")).toBeVisible();
  await expect(regradeButton(page)).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("Kết quả tạm thời.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Đã hết lượt chấm lại cho bài này.")).toBeVisible();
  await expect(regradeButton(page)).toHaveCount(0);

  const calls = (await stubs(request)).grade_calls;
  const refused = await request.post(`${BASE}/api/practice/${practiceId}/regrade`,
    { headers: api.headers, data: { attempt_id: submitted.attempt_id } });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).ma).toBe("het_luot_cham_lai");
  expect((await stubs(request)).grade_calls, "no model call after the retries are used up").toBe(calls);
});

test("the result page regrades a practice attempt the practice way", async ({ page, request }) => {
  test.setTimeout(150_000);
  const { practiceId } = await practiceQuiz(page, request);
  const submitted = await submitInPage(page, practiceId, "__E2E_GRADE_FAIL_ONCE__");
  await page.goto(`/app/study/result/${submitted.attempt_id}`);
  await expect(page.getByText("Kết quả tạm thời.")).toBeVisible({ timeout: 30_000 });
  const before = await stubs(request);
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST"
      && r.url().endsWith(`/api/attempts/${submitted.attempt_id}/regrade`)),
    page.getByRole("button", { name: /Chấm lại câu còn thiếu|Đang gửi/ }).click(),
  ]);
  expect(res.status(), "not the old 409 for practice attempts").toBe(200);
  await expect(page.getByText("Kết quả tạm thời.")).toHaveCount(0, { timeout: 30_000 });
  const after = await stubs(request);
  expect(after.graded_questions.slice(before.graded_questions.length)).toEqual([SHORT]);
  expect(after.grading_dispatches).toBe(before.grading_dispatches);
});
