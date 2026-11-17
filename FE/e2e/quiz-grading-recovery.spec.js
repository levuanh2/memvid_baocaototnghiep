// Diagnostic grading recovery (#188) end to end: the real QuizResult page against the
// real backend (BE/scripts/run_e2e_server.py), with deterministic quiz generation and
// short-answer grading (E2E_DIAGNOSTIC_AI_STUB / E2E_SHORT_ANSWER_GRADING_STUB, set in
// playwright.config.js). No model is called. An answer containing the crash marker makes
// the grading job itself fail every time (a dead worker), which is exactly a "stuck" attempt.
//
// Contract under test (owner-approved 2026-11-17):
//   202  grading accepted / still grading
//   200  a graded attempt resubmitted: the stored result, nothing regraded
//   409  the learner's retries of a stuck attempt are used up
import { test, expect } from "@playwright/test";
import { registerAndEnterApp } from "./fixtures.js";

const CRASH_MARKER = process.env.E2E_GRADING_CRASH_MARKER || "__E2E_GRADE_CRASH__";
const RETRY_MAX = Number(process.env.GRADING_MANUAL_RETRY_MAX || 3);

test.describe.configure({ mode: "serial" });

async function apiSession(page) {
  const token = await page.evaluate(() => localStorage.getItem("memvid-token"));
  expect(token, "auth token stored after register").toBeTruthy();
  return { base: `http://127.0.0.1:${process.env.PORT || 8080}`,
           headers: { Authorization: `Bearer ${token}` } };
}

async function readyDocument(request, api) {
  const res = await request.post(`${api.base}/api/documents/upload`, {
    headers: api.headers,
    multipart: { file: { name: "grading-recovery.txt", mimeType: "text/plain",
                         buffer: Buffer.from("Tài liệu kiểm thử chấm bài.\n\nĐoạn hai.") } },
  });
  expect(res.status(), "document upload").toBe(201);
  const documentId = (await res.json()).document_id;
  // The fake ingest indexes in the background; a quiz generated before it finishes
  // fails with "no indexed chunk".
  await expect.poll(async () => (await (await request.get(`${api.base}/api/documents/${documentId}`,
    { headers: api.headers })).json()).ingest_status, { timeout: 30_000 }).toBe("index_ready");
  return documentId;
}

async function diagnosticQuiz(request, api, documentId) {
  let job = null;
  await expect.poll(async () => {
    const res = await request.post(`${api.base}/api/quizzes/generate`, {
      headers: api.headers,
      data: { document_id: documentId, question_count: 2,
              question_types: ["multiple_choice", "short_answer"], difficulty: "easy" },
    });
    if (res.status() !== 202) return res.status();   // 409 while the document is indexing
    job = await res.json();
    return 202;
  }, { timeout: 30_000 }).toBe(202);
  let quizId = job.quiz_id || null;
  await expect.poll(async () => {
    const st = await (await request.get(`${api.base}/api/quizzes/jobs/${job.job_id}`,
                                        { headers: api.headers })).json();
    quizId = quizId || st.result?.quiz_id || null;
    return st.status === "error" ? `error: ${st.error}` : st.status;
  }, { timeout: 60_000 }).toBe("done");
  expect(quizId, "quiz id from the generation job").toBeTruthy();
  return quizId;
}

async function submittedAttempt(request, api, quizId, shortAnswer) {
  const opened = await request.post(`${api.base}/api/quizzes/${quizId}/attempts`,
                                    { headers: api.headers });
  expect(opened.ok(), `open attempt -> ${opened.status()}`).toBeTruthy();
  const attempt = await opened.json();
  const byType = Object.fromEntries(attempt.quiz.questions.map((q) => [q.question_type, q.question_id]));
  const saved = await request.patch(`${api.base}/api/attempts/${attempt.attempt_id}/answers`, {
    headers: api.headers,
    data: { answers: { [byType.multiple_choice]: "Correct", [byType.short_answer]: shortAnswer } },
  });
  expect(saved.ok(), `save answers -> ${saved.status()}`).toBeTruthy();
  const submit = await request.post(`${api.base}/api/attempts/${attempt.attempt_id}/submit`,
                                    { headers: api.headers });
  expect(submit.status(), "a short-answer submit is accepted for background grading").toBe(202);
  return attempt.attempt_id;
}

const retryButton = (page) => page.getByRole("button", { name: /Thử chấm lại|Đang gửi/ });

test("a stuck attempt offers a retry, each retry is 202, and used-up retries end in 409", async ({ page, request }) => {
  test.setTimeout(180_000);
  await registerAndEnterApp(page);
  const api = await apiSession(page);
  const quizId = await diagnosticQuiz(request, api, await readyDocument(request, api));
  const attemptId = await submittedAttempt(request, api, quizId, `crashes ${CRASH_MARKER}`);

  const submits = [];
  page.on("response", (r) => {
    if (r.request().method() === "POST" && r.url().endsWith(`/api/attempts/${attemptId}/submit`)) {
      submits.push(r.status());
    }
  });
  await page.goto(`/app/study/result/${attemptId}`);
  await expect(page.getByText("Việc chấm bài đã dừng giữa chừng")).toBeVisible({ timeout: 30_000 });

  for (let i = 1; i <= RETRY_MAX; i += 1) {
    await retryButton(page).click();
    await expect.poll(() => submits.length, { timeout: 10_000 }).toBe(i);
    expect(submits[i - 1], `retry ${i} is accepted`).toBe(202);
    if (i < RETRY_MAX) {
      await expect(page.getByText("Lần chấm lại vừa rồi chưa thành công")).toBeVisible({ timeout: 30_000 });
    }
  }
  await expect(page.getByText("chưa chấm được sau nhiều lần thử")).toBeVisible({ timeout: 30_000 });
  await expect(retryButton(page)).toHaveCount(0);

  const refused = await request.post(`${api.base}/api/attempts/${attemptId}/submit`, { headers: api.headers });
  expect(refused.status(), "retries used up").toBe(409);
});

test("a graded attempt shows its score, and resubmitting it returns the stored result (200)", async ({ page, request }) => {
  test.setTimeout(120_000);
  await registerAndEnterApp(page);
  const api = await apiSession(page);
  const quizId = await diagnosticQuiz(request, api, await readyDocument(request, api));
  const attemptId = await submittedAttempt(request, api, quizId, "a good short answer");

  await page.goto(`/app/study/result/${attemptId}`);
  await expect(page.getByText(/Đang chấm/).first()).toBeVisible();   // 202: still grading
  await expect(page.getByText("2 / 2")).toBeVisible({ timeout: 30_000 });
  await expect(retryButton(page)).toHaveCount(0);

  const first = await (await request.get(`${api.base}/api/quizzes/results/${attemptId}`, { headers: api.headers })).json();
  const again = await request.post(`${api.base}/api/attempts/${attemptId}/submit`, { headers: api.headers });
  expect(again.status(), "a graded attempt resubmitted").toBe(200);
  const body = await again.json();
  expect(body.grading).toBe("done");
  expect(body.score).toBe(first.score);
  expect(body.graded_at).toBe(first.graded_at);
});
