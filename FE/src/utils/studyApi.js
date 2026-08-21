// StudyMap API — tài liệu, quiz, làm bài, ôn tập, luyện tập, tiến độ.
//
// Dùng lại `apiFetch` + `_appError` của chat: token, sự kiện 401 và shape lỗi
// (`err.status`) y hệt, nên mọi trang StudyMap xử lý hết phiên giống trang chat.
import { apiFetch, _appError } from "./api";

async function _json(res) {
  if (!res.ok) throw await _appError(res);
  return res.json();
}

const _get = (path) => apiFetch(path).then(_json);

const _send = (path, method, body) =>
  apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then(_json);

// ── Tài liệu ────────────────────────────────────────────────────────────────
export const listDocuments = () =>
  _get("/api/documents").then((b) => b.documents || []);

export const getDocument = (documentId) =>
  _get(`/api/documents/${encodeURIComponent(documentId)}`);

export const listSections = (documentId) =>
  _get(`/api/documents/${encodeURIComponent(documentId)}/sections`).then((b) => b.sections || []);

export const listDocumentQuizzes = (documentId) =>
  _get(`/api/documents/${encodeURIComponent(documentId)}/quizzes`).then((b) => b.quizzes || []);

export const uploadDocument = async (file) => {
  const form = new FormData();
  form.append("file", file);
  // KHÔNG đặt Content-Type: trình duyệt phải tự sinh boundary cho multipart.
  return apiFetch("/api/documents/upload", { method: "POST", body: form }).then(_json);
};

// ── Quiz ────────────────────────────────────────────────────────────────────
export const generateQuiz = (payload) => _send("/api/quizzes/generate", "POST", payload);

export const getQuiz = (quizId) => _get(`/api/quizzes/${encodeURIComponent(quizId)}`);

export const listQuizAttempts = (quizId) =>
  _get(`/api/quizzes/${encodeURIComponent(quizId)}/attempts`).then((b) => b.attempts || []);

// ── Làm bài ─────────────────────────────────────────────────────────────────
export const openAttempt = (quizId) =>
  _send(`/api/quizzes/${encodeURIComponent(quizId)}/attempts`, "POST");

export const getAttempt = (attemptId) => _get(`/api/attempts/${encodeURIComponent(attemptId)}`);

export const saveAnswers = (attemptId, answers) =>
  _send(`/api/attempts/${encodeURIComponent(attemptId)}/answers`, "PATCH", { answers });

export const submitAttempt = (attemptId) =>
  _send(`/api/attempts/${encodeURIComponent(attemptId)}/submit`, "POST");

export const getResult = (attemptId) =>
  _get(`/api/quizzes/results/${encodeURIComponent(attemptId)}`);

// ── Ôn tập ──────────────────────────────────────────────────────────────────
export const getConceptMasteries = (attemptId, { weakOnly = false } = {}) =>
  _get(`/api/attempts/${encodeURIComponent(attemptId)}/concept-masteries${weakOnly ? "?weak=1" : ""}`)
    .then((b) => b.concept_masteries || []);

export const generateReviewPlan = (attemptId, { force = false } = {}) =>
  _send("/api/review-plans/generate", "POST", { attempt_id: attemptId, force });

export const getReviewPlan = (attemptId) =>
  _get(`/api/review-plans/${encodeURIComponent(attemptId)}`);

// ── Luyện tập ───────────────────────────────────────────────────────────────
export const generatePractice = (payload) => _send("/api/practice/generate", "POST", payload);

export const getPractice = (practiceQuizId) =>
  _get(`/api/practice/${encodeURIComponent(practiceQuizId)}`);

export const submitPractice = (practiceQuizId, answers) =>
  _send(`/api/practice/${encodeURIComponent(practiceQuizId)}/submit`, "POST", { answers });

export const getPracticeComparison = (practiceQuizId) =>
  _get(`/api/practice/${encodeURIComponent(practiceQuizId)}/comparison`);

// ── Tiến độ ─────────────────────────────────────────────────────────────────
export const getProgressOverview = () => _get("/api/progress/overview");

export const getProgressConcepts = ({ weakOnly = false } = {}) =>
  _get(`/api/progress/concepts${weakOnly ? "?weak=1" : ""}`).then((b) => b.concepts || []);

export const getProgressAttempts = ({ limit = 50 } = {}) =>
  _get(`/api/progress/attempts?limit=${encodeURIComponent(limit)}`).then((b) => b.attempts || []);

// ── Job ─────────────────────────────────────────────────────────────────────
// Một endpoint cho MỌI loại job. Trước đây mỗi tính năng có route riêng và mỗi
// lần thêm trạng thái là một chỗ nữa phải nhớ cập nhật (known-issues 2026-07-17).
export const getJob = (jobId) => _get(`/api/jobs/${encodeURIComponent(jobId)}`);

export const cancelJob = (jobId) => _send(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, "POST");

// `jobPoller` đọc `current_node`, còn API mới trả `current_step` — ánh xạ tại đây
// để dùng lại nguyên poller (đã xử lý interrupted/404/mất mạng) thay vì viết mới.
export const fetchJobStatus = async (jobId) => {
  const j = await getJob(jobId);
  return { ...j, current_node: j.current_step ?? j.current_node ?? "" };
};

// ── Hiển thị ────────────────────────────────────────────────────────────────
export const MASTERY_LABEL = {
  mastered: "Đã nắm tốt",
  light_review: "Cần ôn nhẹ",
  review_needed: "Cần ôn lại",
  critical_gap: "Hổng nghiêm trọng",
};

export const VERDICT_LABEL = {
  correct: "Đúng",
  partial: "Đúng một phần",
  incorrect: "Sai",
};

export const QUESTION_TYPE_LABEL = {
  multiple_choice: "Trắc nghiệm",
  true_false: "Đúng / Sai",
  short_answer: "Trả lời ngắn",
};

// Đúng/sai lưu ở DB là "true"/"false"; người học không đọc chuỗi đó.
export const optionLabel = (option) =>
  option === "true" ? "Đúng" : option === "false" ? "Sai" : option;

/** Phần trăm để vẽ con dấu mastery. Ngoài [0,1] thì kẹp lại chứ không vẽ tràn. */
export const masteryPercent = (score) => {
  const n = Number(score);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(1, Math.max(0, n)) * 100);
};

/** "3 / 10" — điểm thô, không quy đổi thang 10 (đặc tả 4.8). */
export const formatScore = (score, maxScore) => {
  if (score == null || maxScore == null) return "—";
  const trim = (n) => (Number.isInteger(Number(n)) ? String(Number(n)) : String(Number(n)));
  return `${trim(score)} / ${trim(maxScore)}`;
};

export const formatDuration = (seconds) => {
  // `Number(null)` là 0 — chưa nộp bài mà hiện "0 giây" là bịa số liệu.
  if (seconds == null || seconds === "") return "—";
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return "—";
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return m ? `${m} phút ${s} giây` : `${s} giây`;
};
