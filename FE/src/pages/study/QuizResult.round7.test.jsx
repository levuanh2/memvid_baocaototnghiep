// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuizResult from "./QuizResult";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-router-dom", () => ({ Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>, useParams: () => ({ attemptId: "attempt-1" }) }));
vi.mock("../../components/study/StudyShell", () => ({ default: ({ loading, children, actions }) => <div>{actions}{loading ? "loading" : children}</div> }));
const getResult = vi.fn();
const getConceptMasteries = vi.fn();
vi.mock("../../utils/studyApi", () => ({
  MASTERY_LABEL: { review_needed: "Cần ôn lại" }, VERDICT_LABEL: { correct: "Đúng", incorrect: "Sai", partial: "Đúng một phần" },
  formatDuration: (value) => `${value} giây`, formatScore: (score, max) => score == null ? "—" : `${score} / ${max}`,
  masteryPercent: (score) => Math.round(Number(score || 0) * 100),
  optionLabel: (value) => value, moTaLoi: (error, fallback) => error?.message || fallback,
  getResult: (...args) => getResult(...args), getConceptMasteries: (...args) => getConceptMasteries(...args),
}));

const QUESTIONS = Array.from({ length: 10 }, (_, index) => ({
  question_id: `q-${index + 1}`, question_type: index === 9 ? "short_answer" : "multiple_choice",
  question_text: `Câu hỏi ${index + 1}`, options: ["A", "B"], user_answer: index < 2 ? "A" : "B", correct_answer: "B",
  verdict: index < 2 ? "incorrect" : "correct", explanation: `Giải thích ${index + 1}`, chunk_ids: [`chunk-${index + 1}`],
}));
let container, root;
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); container = null; root = null; vi.clearAllMocks(); });
beforeEach(() => getConceptMasteries.mockResolvedValue([]));
async function renderReady() { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); await act(async () => root.render(<QuizResult />)); await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

describe("Round 7 quiz result", () => {
  it("does not expose a provisional score while grading is pending", async () => {
    getResult.mockResolvedValue({ status: "submitted", quiz_title: "Quiz", score: 8, max_score: 10, percentage: 80, total_questions: 10, questions: [] });
    await renderReady();
    expect(container.textContent).toContain("Đang chấm");
    expect(container.textContent).not.toContain("8 / 10");
    expect(container.textContent).not.toContain("Xem lại 2 câu");
  });

  it("does not render the mastered seal style while grading is pending, even if the payload carries an early high percentage", async () => {
    getResult.mockResolvedValue({ status: "submitted", quiz_title: "Quiz", score: 9, max_score: 10, percentage: 90, total_questions: 10, questions: [] });
    await renderReady();
    expect(container.querySelector(".seal-meter--mastered")).toBeNull();
  });

  it("opens wrong-answer review without replacing the review-plan route", async () => {
    getResult.mockResolvedValue({ status: "graded", quiz_title: "Quiz", score: 8, max_score: 10, percentage: 80, correct_count: 8, incorrect_count: 2, total_questions: 10, duration_seconds: 60, questions: QUESTIONS });
    await renderReady();
    const open = [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Xem lại 2 câu"));
    await act(async () => open.click());
    expect(container.textContent).toContain("Giải thích 1");
    expect(container.querySelector('a[href="/app/study/review/attempt-1"]')).toBeTruthy();
    expect(container.textContent).toContain("Mở kế hoạch ôn tập");
  });
});
