// Shared by the real-backend quiz grading specs (quiz-grading-recovery,
// quiz-provisional-regrade). They need run_e2e_server.py's deterministic quiz and
// grading stubs; `requireStubs` refuses any other server on the port (a reused dev
// backend with real provider keys) before a single write request is sent.
import { expect } from "@playwright/test";

export const BASE = `http://127.0.0.1:${process.env.PORT || 8080}`;

export async function stubs(request) {
  const res = await request.get(`${BASE}/__e2e__/stubs`);
  expect(res.status(), "the backend on this port is run_e2e_server.py (not a reused dev server)").toBe(200);
  return res.json();
}

export async function requireStubs(request) {
  const s = await stubs(request);
  expect(s.e2e_server && s.diagnostic_ai_stub && s.short_answer_grading_stub,
    "deterministic quiz and grading stubs are on, so no real model can be called").toBe(true);
}

export async function apiSession(page) {
  const token = await page.evaluate(() => localStorage.getItem("memvid-token"));
  expect(token, "auth token stored after register").toBeTruthy();
  return { headers: { Authorization: `Bearer ${token}` } };
}

export async function readyDocument(request, api) {
  const res = await request.post(`${BASE}/api/documents/upload`, {
    headers: api.headers,
    multipart: { file: { name: "grading.txt", mimeType: "text/plain",
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

/** 2 questions: multiple choice + one short answer; 3: a second short answer. */
export async function diagnosticQuiz(request, api, documentId, questionCount = 2) {
  const res = await request.post(`${BASE}/api/quizzes/generate`, {
    headers: api.headers,
    data: { document_id: documentId, question_count: questionCount,
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

/** Open an attempt, answer every question with `answerFor(question)`, submit (202). */
export async function submittedAttempt(request, api, quizId, answerFor) {
  const opened = await request.post(`${BASE}/api/quizzes/${quizId}/attempts`,
                                    { headers: api.headers });
  expect(opened.ok(), `open attempt -> ${opened.status()}`).toBeTruthy();
  const attempt = await opened.json();
  const answers = Object.fromEntries(attempt.quiz.questions.map((q) => [q.question_id, answerFor(q)]));
  const saved = await request.patch(`${BASE}/api/attempts/${attempt.attempt_id}/answers`, {
    headers: api.headers, data: { answers },
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
