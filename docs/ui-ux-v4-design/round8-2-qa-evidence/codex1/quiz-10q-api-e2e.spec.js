import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.resolve(here, "../../docs/ui-ux-v4-design/round8-2-qa-evidence/codex1");
const API = "http://127.0.0.1:8080";
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:55432/studymap_test";
const SHA = "c02e2b91ae2207d472756cd34003b5cb6fee1620";

function writeJson(name, value) {
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function seedQuiz(userId) {
  const result = spawnSync("python", [path.join(here, "seed_quiz_10q.py"), userId], {
    cwd: here, encoding: "utf8",
    env: { ...process.env, DATABASE_URL: DB_URL, TEST_DATABASE_URL: DB_URL },
  });
  expect(result.status, `seed stderr: ${result.stderr}`).toBe(0);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
}
function checkedUuid(value) { expect(value).toMatch(/^[0-9a-f-]{36}$/i); return value; }
function psqlJson(sql) {
  const result = spawnSync("docker", ["exec", "r82-pg", "psql", "-U", "postgres",
    "-d", "studymap_test", "-At", "-c", sql], { encoding: "utf8" });
  expect(result.status, `psql stderr: ${result.stderr}`).toBe(0);
  return JSON.parse(result.stdout.trim());
}
async function register(request, label) {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e8)}`;
  const response = await request.post(`${API}/auth/register`, { data: {
    email: `r82-${label}-${unique}@example.test`, password: `${randomUUID()}-Aa1!`,
    display_name: `R82 ${label}`,
  }});
  expect(response.status()).toBe(201);
  return response.json();
}
const headers = (token) => ({ Authorization: `Bearer ${token}` });
async function answerQuestion(page, number, option) {
  await page.getByRole("button", { name: new RegExp(`^Câu ${number}(?: |$)`) }).click();
  const group = page.getByRole("radiogroup", { name: `Đáp án câu ${number}` });
  await group.getByText(option, { exact: true }).click();
  await expect(group.getByLabel(option)).toBeChecked();
}

test("10-question real API/Postgres journey, durability, faults, and ownership", async ({ page, request, browser }) => {
  const startedAt = new Date().toISOString();
  const owner = await register(request, "owner");
  const other = await register(request, "other");
  const seeded = seedQuiz(owner.user.id);
  const requestOrder = [], requestIndex = new Map();
  let submitRequests = 0;
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.origin !== API) return;
    const entry = { order: requestOrder.length + 1, method: req.method(), path: url.pathname, status: null };
    requestIndex.set(req, entry); requestOrder.push(entry);
    if (req.method() === "POST" && /\/api\/attempts\/[^/]+\/submit$/.test(url.pathname)) submitRequests += 1;
  });
  page.on("response", (res) => { const entry = requestIndex.get(res.request()); if (entry) entry.status = res.status(); });
  await page.addInitScript((token) => localStorage.setItem("memvid-token", token), owner.token);
  const openMain = page.waitForResponse((res) => res.request().method() === "POST" &&
    res.url().includes(`/api/quizzes/${seeded.quiz_id}/attempts`));
  await page.goto(`/app/study/quiz/${seeded.quiz_id}`);
  const openMainBody = await (await openMain).json();
  const attemptId = checkedUuid(openMainBody.attempt_id);
  expect(openMainBody.status).toBe("in_progress"); expect(openMainBody.score).toBeNull();
  expect(openMainBody.quiz.questions).toHaveLength(10);
  await expect(page.getByText("10 câu hỏi", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Câu 10/ })).toBeVisible();
  const earlyResult = await request.get(`${API}/api/quizzes/results/${attemptId}`, { headers: headers(owner.token) });
  expect(earlyResult.status()).toBe(409);
  const midDb = psqlJson(`SELECT json_build_object(
    'active_attempts',(SELECT count(*) FROM quiz_attempts WHERE quiz_id='${checkedUuid(seeded.quiz_id)}' AND user_id='${checkedUuid(owner.user.id)}' AND status='in_progress'),
    'question_count',(SELECT count(*) FROM quiz_questions WHERE quiz_id='${checkedUuid(seeded.quiz_id)}'),
    'score',(SELECT score FROM quiz_attempts WHERE id='${attemptId}'))::text;`);
  expect(midDb).toEqual({ active_attempts: 1, question_count: 10, score: null });

  const openSwitch = page.waitForResponse((res) => res.request().method() === "POST" && res.url().includes(`/api/quizzes/${seeded.switch_quiz_id}/attempts`));
  await page.goto(`/app/study/quiz/${seeded.switch_quiz_id}`);
  expect((await (await openSwitch).json()).attempt_id).not.toBe(attemptId);
  const reopenMain = page.waitForResponse((res) => res.request().method() === "POST" && res.url().includes(`/api/quizzes/${seeded.quiz_id}/attempts`));
  await page.goto(`/app/study/quiz/${seeded.quiz_id}`);
  expect((await (await reopenMain).json()).attempt_id).toBe(attemptId);

  let delayedPatchSeen, releaseDelayed;
  const delayedSeen = new Promise((resolve) => { delayedPatchSeen = resolve; });
  const delayedRelease = new Promise((resolve) => { releaseDelayed = resolve; });
  let delayFirstPatch = true, abortNextPatch = false;
  await page.route("**/api/attempts/*/answers", async (route) => {
    if (delayFirstPatch && route.request().url().includes(attemptId)) {
      delayFirstPatch = false; delayedPatchSeen(); await delayedRelease; await route.continue(); return;
    }
    if (abortNextPatch && route.request().url().includes(attemptId)) {
      abortNextPatch = false; await route.abort("failed"); return;
    }
    await route.continue();
  });
  await answerQuestion(page, 1, "Wrong 1"); await delayedSeen;
  await answerQuestion(page, 1, "Correct 1"); releaseDelayed();
  await expect.poll(async () => {
    const body = await (await request.get(`${API}/api/attempts/${attemptId}`, { headers: headers(owner.token) })).json();
    return body.answers.find((a) => a.question_id === seeded.question_ids[0])?.user_answer;
  }, { timeout: 15_000 }).toBe("Correct 1");
  await page.reload();
  await expect(page.getByRole("radiogroup", { name: "Đáp án câu 1" }).getByLabel("Correct 1")).toBeChecked();
  for (let n = 2; n <= 8; n += 1) await answerQuestion(page, n, `Correct ${n}`);
  await answerQuestion(page, 9, "Wrong 9"); await answerQuestion(page, 10, "Wrong 10");

  abortNextPatch = true;
  const failedPatch = page.waitForEvent("requestfailed", (req) => req.method() === "PATCH" && req.url().includes(`/api/attempts/${attemptId}/answers`));
  await answerQuestion(page, 2, "Wrong 2"); await failedPatch;
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Nộp bài", exact: true }).last().click();
  await page.getByRole("dialog", { name: "Nộp bài?" }).getByRole("button", { name: "Nộp bài", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible(); expect(submitRequests).toBe(0);
  await answerQuestion(page, 2, "Correct 2");
  const submitResponse = page.waitForResponse((res) => res.request().method() === "POST" && res.url().includes(`/api/attempts/${attemptId}/submit`));
  await page.getByRole("button", { name: "Nộp bài", exact: true }).last().click();
  const confirm = page.getByRole("dialog", { name: "Nộp bài?" }).getByRole("button", { name: "Nộp bài", exact: true });
  await confirm.evaluate((button) => { button.click(); button.click(); });
  expect((await submitResponse).status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/app/study/result/${attemptId}$`));
  expect(submitRequests).toBe(1);
  await expect(page.getByText("8 / 10", { exact: true })).toBeVisible();
  await expect(page.getByText("80% · điểm thô", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Xem lại 2 câu cần ôn" }).click();
  await expect(page.getByText("Deterministic feedback for question 9.")).toBeVisible();
  await expect(page.getByText("Nguồn: 1 đoạn trong tài liệu")).toBeVisible();
  expect((await request.post(`${API}/api/attempts/${attemptId}/submit`, { headers: headers(owner.token) })).status()).toBe(409);

  const crossAccount = {
    get: (await request.get(`${API}/api/attempts/${attemptId}`, { headers: headers(other.token) })).status(),
    patch: (await request.patch(`${API}/api/attempts/${attemptId}/answers`, { headers: headers(other.token), data: { answers: { [seeded.question_ids[0]]: "Wrong 1" } } })).status(),
    submit: (await request.post(`${API}/api/attempts/${attemptId}/submit`, { headers: headers(other.token) })).status(),
  };
  expect(crossAccount).toEqual({ get: 404, patch: 404, submit: 404 });
  await page.getByRole("link", { name: "Mở kế hoạch ôn tập" }).first().click();
  await expect(page.getByRole("button", { name: "Lập kế hoạch ôn tập" })).toBeVisible();
  const planResponse = page.waitForResponse((res) => res.request().method() === "POST" && res.url().includes("/api/review-plans/generate"));
  await page.getByRole("button", { name: "Lập kế hoạch ôn tập" }).click();
  expect((await planResponse).status()).toBe(201);
  await expect(page.getByText("Advanced concepts", { exact: true })).toBeVisible();
  await expect(page.getByText("2 đoạn cần đọc lại", { exact: true })).toBeVisible();

  const finalDb = psqlJson(`SELECT json_build_object(
    'attempt_rows',(SELECT count(*) FROM quiz_attempts WHERE quiz_id='${checkedUuid(seeded.quiz_id)}' AND user_id='${checkedUuid(owner.user.id)}'),
    'active_attempts',(SELECT count(*) FROM quiz_attempts WHERE quiz_id='${checkedUuid(seeded.quiz_id)}' AND user_id='${checkedUuid(owner.user.id)}' AND status='in_progress'),
    'status',(SELECT status FROM quiz_attempts WHERE id='${attemptId}'),
    'score',(SELECT score::float FROM quiz_attempts WHERE id='${attemptId}'),
    'answer_rows',(SELECT count(*) FROM quiz_answers WHERE attempt_id='${attemptId}'),
    'grade_from_persisted_answers',(SELECT count(*)::float FROM quiz_answers a JOIN quiz_questions q ON q.id=a.question_id WHERE a.attempt_id='${attemptId}' AND a.user_answer=q.correct_answer),
    'masteries',(SELECT json_agg(json_build_object('concept',concept_name,'earned',earned_score::float,'total',total_count,'mastery',mastery_score::float,'status',status) ORDER BY concept_name) FROM concept_masteries WHERE attempt_id='${attemptId}'),
    'review_sections_permitted',(SELECT NOT EXISTS (SELECT 1 FROM review_plan_items i JOIN review_plans p ON p.id=i.review_plan_id WHERE p.attempt_id='${attemptId}' AND (i.section_id IS NULL OR i.section_id NOT IN (SELECT id FROM sections WHERE document_id='${checkedUuid(seeded.document_id)}')))),
    'review_chunks_permitted',(SELECT NOT EXISTS (SELECT 1 FROM review_item_chunks ric JOIN review_plan_items i ON i.id=ric.review_item_id JOIN review_plans p ON p.id=i.review_plan_id JOIN document_chunks c ON c.id=ric.chunk_id WHERE p.attempt_id='${attemptId}' AND c.document_id <> '${checkedUuid(seeded.document_id)}'))
  )::text;`);
  expect(finalDb).toMatchObject({ attempt_rows: 1, active_attempts: 0, status: "graded",
    score: 8, answer_rows: 10, grade_from_persisted_answers: 8,
    review_sections_permitted: true, review_chunks_permitted: true });
  expect(finalDb.masteries).toEqual([
    { concept: "Advanced concepts", earned: 3, total: 5, mastery: 0.6, status: "light_review" },
    { concept: "Core concepts", earned: 5, total: 5, mastery: 1, status: "mastered" },
  ]);

  const expiredContext = await browser.newContext({ baseURL: "http://127.0.0.1:4173" });
  const expiredPage = await expiredContext.newPage();
  await expiredPage.addInitScript(() => localStorage.setItem("memvid-token", "expired.invalid.token"));
  await expiredPage.goto(`/app/study/quiz/${seeded.quiz_id}`);
  await expect(expiredPage).toHaveURL(/\/login\?next=/); await expiredContext.close();

  writeJson("quiz-10q-results.json", {
    git_sha: SHA, environment: "Docker Postgres 16:55432; protected Flask:8080; production FE:4173",
    api_db: "real Flask and Postgres; deterministic DB seed replaces only AI question generation",
    timestamp_started: startedAt, timestamp_finished: new Date().toISOString(),
    method: "Playwright Chromium + real HTTP + docker exec psql assertions",
    expected: "10Q durable journey, fault barriers, grading/mastery/review ownership",
    observed: { cross_account_statuses: crossAccount, postgres: finalDb }, verdict: "PASS",
    source_ref_follow: "NOT VERIFIED: source references are non-interactive text; no navigation control exists",
    practice_quiz: "NOT VERIFIED: shared deterministic server does not stub quiz/practice AI generation",
  });
  writeJson("quiz-10q-request-order.json", requestOrder);
  writeJson("quiz-10q-postgres-assertions.json", { mid: midDb, final: finalDb });
});
