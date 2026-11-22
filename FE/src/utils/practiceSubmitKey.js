// One logical practice submit = one Idempotency-Key (BE: POST /api/practice/<id>/submit).
//
// - Retrying the SAME answers (network error, timeout, double click, reload) reuses the key,
//   so the server returns the result it already graded instead of grading again.
// - Changing an answer, or starting a new attempt after a result, gets a new key.
// The key is kept in sessionStorage so a reload of the tab can still retry; it is cleared
// once a result has arrived. Storage can be unavailable (private mode): then the key only
// lives for this page, which is still correct, just less helpful after a reload.

// Exact body of the BE 409 for "your first request is still being graded".
export const DANG_CHAM = "Bài nộp này đang được chấm, thử lại sau ít giây";

const storeKey = (quizId) => `studymap:practice-submit:${quizId}`;

export function newSubmitKey() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function answersFingerprint(answers) {
  return JSON.stringify(Object.keys(answers || {}).sort().map((k) => [k, answers[k] ?? null]));
}

function read(quizId) {
  try {
    return JSON.parse(sessionStorage.getItem(storeKey(quizId)) || "null");
  } catch {
    return null;
  }
}

// `memo` is a per-page ref ({ current }) used when sessionStorage is unavailable.
export function submitKeyFor(quizId, answers, memo) {
  const fp = answersFingerprint(answers);
  const saved = read(quizId) || memo?.current;
  if (saved?.fp === fp && saved?.key) return saved.key;
  const next = { key: newSubmitKey(), fp };
  if (memo) memo.current = next;
  try {
    sessionStorage.setItem(storeKey(quizId), JSON.stringify(next));
  } catch {
    // ponytail: memo covers this page; a reload then mints a new key.
  }
  return next.key;
}

export function forgetSubmitKey(quizId, memo) {
  if (memo) memo.current = null;
  try {
    sessionStorage.removeItem(storeKey(quizId));
  } catch {
    // nothing stored
  }
}
