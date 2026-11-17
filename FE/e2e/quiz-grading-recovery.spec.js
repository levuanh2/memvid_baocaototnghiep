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

const CRASH_MARKER = "__E2E_GRADE_CRASH__";
const RETRY_MAX = 3;   // GRADING_MANUAL_RETRY_MAX, pinned in playwright.config.js
const BASE = `http://127.0.0.1:${process.env.PORT || 8080}`;

test.describe.configure({ mode: "serial" });

async function stubs(request) {
  const res = await request.get(`${BASE}/__e2e__/stubs`);
  expect(res.status(), "the backend on this port is run_e2e_server.py (not a reused dev server)").toBe(200);
  return res.json();
}

test.beforeAll(async ({ request }) => {
  const s = await stubs(request);
  expect(s.diagnostic_ai_stub && s.short_answer_grading_stub,
    "deterministic quiz and grading stubs are on, so no real model can be called").toBe(true);
});

async function apiSession(page) {
  const token = await page.evaluate(() => localStorage.getItem("memvid-token"));
  expect(token, "auth token stored after register").toBeTruthy();
  return { headers: { Authorization: `Bearer ${token}` } };
}

async function readyDocument(request, api) {
  const res = await request.post(`${BASE}/api/documents/upload`, {
    headers: api.headers,
    multipart: { file: { name: "grading-recovery.txt", mimeType: "text/plain",
                         buffer: Buffer.from("Tài liệu kiểm thử chấm bài.\n\nĐoạn hai.") } },
  });
  expect(res.status(), "document upload").toBe(201);
  const documentId = (await res.json()).document_id;
  // The fake ingest indexes in the background; a quiz generated before it finishes
  // fails with "no indexed chunk".
  await expect.poll(async () => (await (await request.get(`${BASE}/api/documents/${documentId}`,
    { headers: api.headers })).json()).ingest_status, { timeout: 30_000 }).toBe("index_ready");
  return documentId;
}

async function diagnosticQuiz(request, api, documentId) {
  const res = await request.post(`${BASE}/api/quizzes/generate`, {
    headers: api.headers,
    data: { document_id: documentId, question_count: 2,
            question_types: ["multiple_choice", "short_answer"], difficulty: "easy" },
  });
  expect(res.status(), `quiz generation accepted: ${await res.text()}`).toBe(202);
  const job = await res.json();
  let quizId = null;
  await expect.poll(async () => {
    const st = await (await request.get(`${BASE}/api/quizzes/jobs/${job.job_id}`,
                                        { headers: api.headers })).json();
    quizId = st.result?.quiz_id || null;
    return st.status === "error" ? `error: ${st.error}` : st.status;
  }, { timeout: 60_000 }).toBe("done");
  expect(quizId, "quiz id from the generation job").toBeTruthy();
  return quizId;
}

async function submittedAttempt(request, api, quizId, shortAnswer) {
  const opened = await request.post(`${BASE}/api/quizzes/${quizId}/attempts`,
                                    { headers: api.headers });
  expect(opened.ok(), `open attempt -> ${opened.status()}`).toBeTruthy();
  const attempt = await opened.json();
  const byType = Object.fromEntries(attempt.quiz.questions.map((q) => [q.question_type, q.question_id]));
  const saved = await request.patch(`${BASE}/api/attempts/${attempt.attempt_id}/answers`, {
    headers: api.headers,
    data: { answers: { [byType.multiple_choice]: "Correct", [byType.short_answer]: shortAnswer } },
  });
  expect(saved.ok(), `save answers -> ${saved.status()}`).toBeTruthy();
  const submit = await request.post(`${BASE}/api/attempts/${attempt.attempt_id}/submit`,
                                    { headers: api.headers });
  expect(submit.status(), "a short-answer submit is accepted for background grading").toBe(202);
  const body = await submit.json();
  expect(body.grading).toBe("pending");
  expect(body.job_id).toBeTruthy();
  return attempt.attempt_id;
}

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
  const callsBefore = (await stubs(request)).grade_calls;
  expect(callsBefore, "the grading stub counted the first grading").toBeGreaterThan(0);
  const again = await request.post(`${BASE}/api/attempts/${attemptId}/submit`, { headers: api.headers });
  expect(again.status(), "a graded attempt resubmitted").toBe(200);
  const body = await again.json();
  expect(body.grading).toBe("done");
  for (const key of ["score", "max_score", "graded_at", "status"]) {
    expect(body[key], `resubmit returns the stored ${key}`).toEqual(stored[key]);
  }
  expect((await stubs(request)).grade_calls, "nothing was regraded").toBe(callsBefore);
});
