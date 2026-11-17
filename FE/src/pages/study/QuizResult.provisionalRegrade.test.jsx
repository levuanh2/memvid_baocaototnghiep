// @vitest-environment jsdom
// Provisional grading recovery (2026-11-17): a result the AI grader left incomplete
// keeps its "Kết quả tạm thời" banner and offers "Chấm lại câu còn thiếu" only when the
// server says a regrade is possible (`regrade_state: "available"`). One request even on
// a double click, polling while the regrade runs, and a plain end when retries are used.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuizResult from "./QuizResult";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-router-dom", () => ({ Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>, useParams: () => ({ attemptId: "attempt-1" }) }));
vi.mock("../../components/study/StudyShell", () => ({ default: ({ loading, children, actions }) => <div>{actions}{loading ? "loading" : children}</div> }));
const getResult = vi.fn();
const getConceptMasteries = vi.fn();
const submitAttempt = vi.fn();
const regradeAttempt = vi.fn();
vi.mock("../../utils/studyApi", () => ({
  MASTERY_LABEL: {}, VERDICT_LABEL: { correct: "Đúng", incorrect: "Sai", partial: "Đúng một phần" },
  formatDuration: (value) => `${value} giây`, formatScore: (score, max) => score == null ? "—" : `${score} / ${max}`,
  masteryPercent: (score) => Math.round(Number(score || 0) * 100),
  optionLabel: (value) => value, moTaLoi: (error, fallback) => error?.message || fallback,
  getResult: (...args) => getResult(...args), getConceptMasteries: (...args) => getConceptMasteries(...args),
  submitAttempt: (...args) => submitAttempt(...args), regradeAttempt: (...args) => regradeAttempt(...args),
}));

const questions = [
  { question_id: "q1", question_type: "multiple_choice", question_text: "Câu 1", user_answer: "A",
    options: ["A", "B"], correct_answer: "A", verdict: "correct", is_correct: true, score: 1 },
  { question_id: "q2", question_type: "short_answer", question_text: "Câu 2", user_answer: "x",
    verdict: null, score: null },
];
const provisional = (regrade_state) => ({
  quiz_title: "Quiz", total_questions: 2, status: "graded", grading_state: "graded",
  score: 1, max_score: 1, percentage: 100, correct_count: 1, incorrect_count: 0,
  ungraded_count: 1, grading_complete: false, regrade_state, questions,
});
const complete = {
  ...provisional(null), score: 2, max_score: 2, correct_count: 2, ungraded_count: 0,
  grading_complete: true,
  questions: [questions[0], { ...questions[1], verdict: "correct", is_correct: true, score: 1 }],
};

let container, root;
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); container = null; root = null; vi.clearAllMocks(); vi.useRealTimers(); });
beforeEach(() => getConceptMasteries.mockResolvedValue([]));
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
async function render() {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(<QuizResult />)); await flush();
}
const regradeButton = () => [...container.querySelectorAll("button")].find((b) => /Chấm lại câu còn thiếu|Đang gửi/.test(b.textContent));

describe("Chấm lại câu còn thiếu", () => {
  it("is offered on a provisional result the server can regrade, next to the banner", async () => {
    getResult.mockResolvedValue(provisional("available"));
    await render();
    expect(container.textContent).toContain("Kết quả tạm thời.");
    expect(regradeButton()).toBeDefined();
  });

  it("is not offered on a complete result, nor by a backend without regrade_state", async () => {
    getResult.mockResolvedValue(complete);
    await render();
    expect(regradeButton()).toBeUndefined();
    act(() => root.unmount()); container.remove(); root = null;
    getResult.mockResolvedValue(provisional(undefined));
    await render();
    expect(container.textContent).toContain("Kết quả tạm thời.");
    expect(regradeButton()).toBeUndefined();
  });

  it("sends one request on a double click and never calls submit", async () => {
    getResult.mockResolvedValueOnce(provisional("available")).mockResolvedValue(provisional("running"));
    let release;
    regradeAttempt.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    await render();
    const button = regradeButton();
    await act(async () => { button.click(); button.click(); });
    expect(regradeAttempt).toHaveBeenCalledTimes(1);
    expect(regradeAttempt).toHaveBeenCalledWith("attempt-1");
    expect(submitAttempt).not.toHaveBeenCalled();
    await act(async () => { release({ grading: "pending", job_id: "j1" }); });
    await flush();
    expect(regradeButton()).toBeUndefined();
    expect(container.textContent).toContain("Đang chấm lại 1 câu còn thiếu");
  });

  it("polls while the regrade runs and shows the complete score when it is done", async () => {
    vi.useFakeTimers();
    getResult.mockResolvedValueOnce(provisional("running")).mockResolvedValue(complete);
    await render();
    expect(container.textContent).toContain("Đang chấm lại");
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    await flush();
    expect(container.textContent).not.toContain("Kết quả tạm thời.");
    expect(container.textContent).toContain("2 / 2");
  });

  it("says so when a regrade did not help, and offers another try", async () => {
    getResult.mockResolvedValueOnce(provisional("available")).mockResolvedValue(provisional("available"));
    regradeAttempt.mockResolvedValue({ grading: "pending", job_id: "j1" });
    await render();
    await act(async () => { regradeButton().click(); });
    await flush();
    expect(container.textContent).toContain("Lần chấm lại vừa rồi chưa chấm được các câu này");
    expect(regradeButton()).toBeDefined();
  });

  it("offers no review plan while the result is provisional, and offers it once complete", async () => {
    const wrong = { ...questions[0], user_answer: "B", verdict: "incorrect", is_correct: false, score: 0 };
    getResult.mockResolvedValue({ ...provisional("available"), score: 0, correct_count: 0,
      incorrect_count: 1, questions: [wrong, questions[1]] });
    await render();
    const planLinks = () => [...container.querySelectorAll("a")].filter((a) => /Kế hoạch ôn tập|Mở kế hoạch ôn tập/.test(a.textContent));
    expect(planLinks()).toHaveLength(0);
    act(() => root.unmount()); container.remove(); root = null;
    getResult.mockResolvedValue({ ...complete, score: 1, correct_count: 1, incorrect_count: 1,
      questions: [wrong, complete.questions[1]] });
    await render();
    expect(planLinks().length).toBeGreaterThan(0);
    // Owner decision 2026-11-17: once retries are used up the provisional result is
    // final, and its plan (graded answers only) is offered.
    act(() => root.unmount()); container.remove(); root = null;
    getResult.mockResolvedValue({ ...provisional("exhausted"), score: 0, correct_count: 0,
      incorrect_count: 1, questions: [wrong, questions[1]] });
    await render();
    expect(planLinks().length).toBeGreaterThan(0);
  });

  it("ends plainly when retries are used up: no button, the provisional result stays", async () => {
    getResult.mockResolvedValueOnce(provisional("available")).mockResolvedValue(provisional("exhausted"));
    regradeAttempt.mockRejectedValue(new Error("Đã hết lượt thử chấm lại cho bài này"));
    await render();
    await act(async () => { regradeButton().click(); });
    await flush();
    expect(regradeButton()).toBeUndefined();
    expect(container.textContent).toContain("Đã hết lượt chấm lại cho bài này. Kết quả tạm thời được giữ nguyên.");
    expect(container.textContent).toContain("Kết quả tạm thời.");
  });
});
