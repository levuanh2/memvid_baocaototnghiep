// @vitest-environment jsdom
// Diagnostic recovery (2026-11-17): "Thử chấm lại" appears only when the server says
// nobody is grading (`grading_state: "stalled"`), sends one request even on a double
// click, polls again after a 202, and says so when the retry did not help.
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
vi.mock("../../utils/studyApi", () => ({
  MASTERY_LABEL: {}, VERDICT_LABEL: { correct: "Đúng", incorrect: "Sai", partial: "Đúng một phần" },
  formatDuration: (value) => `${value} giây`, formatScore: (score, max) => score == null ? "—" : `${score} / ${max}`,
  masteryPercent: (score) => Math.round(Number(score || 0) * 100),
  optionLabel: (value) => value, moTaLoi: (error, fallback) => error?.message || fallback,
  getResult: (...args) => getResult(...args), getConceptMasteries: (...args) => getConceptMasteries(...args),
  submitAttempt: (...args) => submitAttempt(...args),
}));

const base = {
  quiz_title: "Quiz", total_questions: 1, max_score: 1,
  questions: [{ question_id: "q1", question_type: "short_answer", question_text: "Câu 1", user_answer: "x" }],
};
const submitted = (grading_state) => ({ ...base, status: "submitted", grading_state, score: null });
const graded = { ...base, status: "graded", grading_state: "graded", score: 1, percentage: 100,
  correct_count: 1, incorrect_count: 0, grading_complete: true };

let container, root;
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); container = null; root = null; vi.clearAllMocks(); vi.useRealTimers(); });
beforeEach(() => getConceptMasteries.mockResolvedValue([]));
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
async function render() {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(<QuizResult />)); await flush();
}
const retryButton = () => [...container.querySelectorAll("button")].find((b) => /Thử chấm lại|Đang gửi/.test(b.textContent));

describe("Thử chấm lại", () => {
  it("is not offered for a graded attempt", async () => {
    getResult.mockResolvedValue(graded);
    await render();
    expect(retryButton()).toBeUndefined();
  });

  it("is not offered while a grader still holds the claim", async () => {
    getResult.mockResolvedValue(submitted("grading"));
    await render();
    expect(retryButton()).toBeUndefined();
    expect(container.textContent).toContain("Đang chấm");
  });

  it("is not offered by a backend that does not report grading_state", async () => {
    getResult.mockResolvedValue({ ...submitted(undefined) });
    await render();
    expect(retryButton()).toBeUndefined();
  });

  it("sends one request on a double click, then shows grading again after a 202", async () => {
    getResult.mockResolvedValueOnce(submitted("stalled")).mockResolvedValue(submitted("grading"));
    let release;
    submitAttempt.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    await render();
    const button = retryButton();
    expect(button).toBeDefined();
    await act(async () => { button.click(); button.click(); });
    expect(submitAttempt).toHaveBeenCalledTimes(1);
    expect(submitAttempt).toHaveBeenCalledWith("attempt-1");
    expect(retryButton().disabled).toBe(true);
    await act(async () => { release({ status: "submitted", grading: "pending" }); });
    await flush();
    expect(retryButton()).toBeUndefined();
    expect(container.textContent).toContain("Đang chấm");
  });

  it("shows the stored score when the retry graded it at once (200)", async () => {
    getResult.mockResolvedValueOnce(submitted("stalled")).mockResolvedValue(graded);
    submitAttempt.mockResolvedValue({ status: "graded", grading: "done" });
    await render();
    await act(async () => { retryButton().click(); });
    await flush();
    expect(retryButton()).toBeUndefined();
    expect(container.textContent).toContain("1 / 1");
  });

  it("says the request failed and lets the learner try again", async () => {
    getResult.mockResolvedValue(submitted("stalled"));
    submitAttempt.mockRejectedValueOnce(new Error("Mất kết nối"));
    await render();
    await act(async () => { retryButton().click(); });
    await flush();
    expect(container.textContent).toContain("Mất kết nối");
    expect(retryButton().disabled).toBe(false);
  });

  it("says a retry did not help when the attempt is stalled again", async () => {
    getResult.mockResolvedValue(submitted("stalled"));
    submitAttempt.mockResolvedValue({ status: "submitted", grading: "pending" });
    await render();
    await act(async () => { retryButton().click(); });
    await flush();
    expect(container.textContent).toContain("Lần chấm lại vừa rồi chưa thành công");
    expect(retryButton()).toBeDefined();
  });

  it("offers no retry once the attempt's retries are used up", async () => {
    getResult.mockResolvedValue(submitted("failed"));
    await render();
    expect(retryButton()).toBeUndefined();
    expect(container.textContent).toContain("chưa chấm được sau nhiều lần thử");
  });

  it("moves to the used-up state when the server refuses the retry (409)", async () => {
    // agy task27 F1: the page used to keep the stale "stalled" state and its button.
    getResult.mockResolvedValueOnce(submitted("stalled")).mockResolvedValue(submitted("failed"));
    submitAttempt.mockRejectedValueOnce(Object.assign(new Error("Đã hết lượt thử chấm lại cho bài này"), { status: 409 }));
    await render();
    await act(async () => { retryButton().click(); });
    await flush();
    expect(retryButton()).toBeUndefined();
    expect(container.textContent).toContain("chưa chấm được sau nhiều lần thử");
  });

  it("keeps the button busy until the new state has loaded", async () => {
    // agy task27 F2: the button came back before the reload finished.
    let releaseReload;
    getResult.mockResolvedValueOnce(submitted("stalled"))
      .mockReturnValueOnce(new Promise((resolve) => { releaseReload = resolve; }));
    submitAttempt.mockResolvedValue({ status: "submitted", grading: "pending" });
    await render();
    await act(async () => { retryButton().click(); });
    await flush();
    expect(retryButton().disabled).toBe(true);
    await act(async () => { releaseReload(submitted("grading")); });
    await flush();
    expect(retryButton()).toBeUndefined();
  });

  it("stops polling while stalled instead of asking the server forever", async () => {
    vi.useFakeTimers();
    getResult.mockResolvedValue(submitted("stalled"));
    await render();
    const calls = getResult.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(getResult.mock.calls.length).toBe(calls);
  });
});
