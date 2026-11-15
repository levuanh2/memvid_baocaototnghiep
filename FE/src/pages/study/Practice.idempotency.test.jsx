// @vitest-environment jsdom
// Practice submit carries an idempotency key (2026-11-15): a retry of the SAME answers reuses
// it, so the server returns the result it already graded; changed answers or a finished
// attempt get a new key. A "still being graded" 409 is asked again with the same key.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Practice from "./Practice";
import { DANG_CHAM } from "../../utils/practiceSubmitKey";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-router-dom", () => ({ Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>, useParams: () => ({ quizId: "quiz-1" }) }));
vi.mock("../../components/study/StudyShell", () => ({ default: ({ loading, error, children }) => <div>{error}{loading ? "loading" : children}</div> }));
const getPractice = vi.fn();
const getPracticeComparison = vi.fn();
const submitPractice = vi.fn();
vi.mock("../../utils/studyApi", () => ({
  MASTERY_LABEL: {}, QUESTION_TYPE_LABEL: { multiple_choice: "Trắc nghiệm" },
  formatScore: (s, m) => `${s} / ${m}`, masteryPercent: () => 0,
  optionLabel: (v) => v, moTaLoi: (e, fallback) => e?.message || fallback,
  getPractice: (...a) => getPractice(...a),
  getPracticeComparison: (...a) => getPracticeComparison(...a),
  submitPractice: (...a) => submitPractice(...a),
}));

const QUIZ = { title: "Quiz", questions: [{ question_id: "q1", question_type: "multiple_choice", question_text: "Câu 1", options: ["A", "B"] }] };
const GRADED = { attempt_id: "at1", status: "graded", percentage: 100, score: 1, max_score: 1, correct_count: 1, total_questions: 1, grading_complete: true, ungraded_count: 0 };
const err = (status, message) => Object.assign(new Error(message), { status });

let container, root;
beforeEach(() => { sessionStorage.clear(); });
afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function render() {
  getPractice.mockResolvedValue(QUIZ);
  getPracticeComparison.mockRejectedValue({ status: 409 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Practice />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}
const button = (text) => [...container.querySelectorAll("button")].find((b) => b.textContent.includes(text));
const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
const keyOf = (call) => call[2]?.idempotencyKey;

describe("Practice submit idempotency key", () => {
  it("a retry of the same answers after a network error reuses the key", async () => {
    await render();
    await act(async () => { button("A").click(); });
    submitPractice.mockRejectedValueOnce(err(0, "Failed to fetch")).mockResolvedValueOnce(GRADED);
    await act(async () => { button("Nộp bài luyện tập").click(); });
    await flush();
    await act(async () => { button("Nộp bài luyện tập").click(); });
    await flush();

    expect(submitPractice).toHaveBeenCalledTimes(2);
    const [first, second] = submitPractice.mock.calls;
    expect(keyOf(first)).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(keyOf(second)).toBe(keyOf(first));
  });

  it("changing an answer after a failed submit makes a new key", async () => {
    await render();
    await act(async () => { button("A").click(); });
    submitPractice.mockRejectedValueOnce(err(500, "boom")).mockResolvedValueOnce(GRADED);
    await act(async () => { button("Nộp bài luyện tập").click(); });
    await flush();
    await act(async () => { button("B").click(); });
    await act(async () => { button("Nộp bài luyện tập").click(); });
    await flush();

    const [first, second] = submitPractice.mock.calls;
    expect(keyOf(second)).not.toBe(keyOf(first));
  });

  it("a finished attempt forgets its key: the next attempt with the same answers is new", async () => {
    await render();
    await act(async () => { button("A").click(); });
    submitPractice.mockResolvedValue(GRADED);
    await act(async () => { button("Nộp bài luyện tập").click(); });
    await flush();
    const firstKey = keyOf(submitPractice.mock.calls[0]);
    expect(sessionStorage.getItem("studymap:practice-submit:quiz-1")).toBeNull();

    // A reload of the page starts a new attempt.
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => { root.render(<Practice />); });
    await flush();
    await act(async () => { button("A").click(); });
    await act(async () => { button("Nộp bài luyện tập").click(); });
    await flush();
    expect(keyOf(submitPractice.mock.calls[1])).not.toBe(firstKey);
  });

  it("a reload after a failed submit still retries with the same key (sessionStorage)", async () => {
    await render();
    await act(async () => { button("A").click(); });
    submitPractice.mockRejectedValueOnce(err(0, "Failed to fetch"));
    await act(async () => { button("Nộp bài luyện tập").click(); });
    await flush();
    const firstKey = keyOf(submitPractice.mock.calls[0]);

    act(() => root.unmount());
    root = createRoot(container);
    submitPractice.mockResolvedValueOnce(GRADED);
    await act(async () => { root.render(<Practice />); });
    await flush();
    await act(async () => { button("A").click(); });
    await act(async () => { button("Nộp bài luyện tập").click(); });
    await flush();
    expect(keyOf(submitPractice.mock.calls[1])).toBe(firstKey);
  });

  it("'still being graded' is asked again with the same key, then shows the result", async () => {
    vi.useFakeTimers();
    await render();
    await act(async () => { button("A").click(); });
    submitPractice.mockRejectedValueOnce(err(409, DANG_CHAM)).mockResolvedValueOnce(GRADED);
    await act(async () => { button("Nộp bài luyện tập").click(); });
    await flush();
    expect(submitPractice).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(2000); });
    await flush();

    expect(submitPractice).toHaveBeenCalledTimes(2);
    expect(keyOf(submitPractice.mock.calls[1])).toBe(keyOf(submitPractice.mock.calls[0]));
    expect(container.textContent).not.toContain(DANG_CHAM);
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Đạt 100 phần trăm điểm");
  });

  it("any other 409 is shown, not retried", async () => {
    await render();
    await act(async () => { button("A").click(); });
    submitPractice.mockRejectedValueOnce(err(409, "Attempt không còn ở trạng thái in_progress"));
    await act(async () => { button("Nộp bài luyện tập").click(); });
    await flush();
    expect(submitPractice).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Attempt không còn ở trạng thái in_progress");
  });
});
