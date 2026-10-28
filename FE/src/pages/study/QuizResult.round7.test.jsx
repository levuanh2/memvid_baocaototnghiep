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

// Wrong answers at ORIGINAL positions 4 and 9 (nonconsecutive, not at the start of
// the array) -- the exact shape that distinguishes "original question ordinal"
// from "position inside the filtered wrong-answer subset" (which would both show
// 1 and 2 for this case). question_id is deliberately non-numeric-looking
// ("qid-xyz-*") so a fix that reads an ordinal out of the id string also fails.
const QUESTIONS_NONCONSECUTIVE = Array.from({ length: 10 }, (_, index) => {
  const wrongAt = index === 3 || index === 8; // 0-based -> "Câu 4" and "Câu 9"
  return {
    question_id: `qid-xyz-${index}`, question_type: "multiple_choice",
    question_text: `Câu hỏi ${index + 1}`, options: ["A", "B"],
    user_answer: wrongAt ? "A" : "B", correct_answer: "B",
    verdict: wrongAt ? "incorrect" : "correct", explanation: `Giải thích ${index + 1}`,
  };
});
let container, root;
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); container = null; root = null; vi.clearAllMocks(); });
beforeEach(() => getConceptMasteries.mockResolvedValue([]));
async function renderReady() { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); await act(async () => root.render(<QuizResult />)); await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

describe("Round 7 quiz result", () => {
  it("does not expose a provisional score while grading is pending", async () => {
    getResult.mockResolvedValue({
      status: "submitted", quiz_title: "Quiz", score: 8, max_score: 10, percentage: 80,
      correct_count: 8, incorrect_count: 2, total_questions: 10,
      questions: [{
        question_id: "provisional-q", question_type: "multiple_choice",
        question_text: "Nội dung tạm chưa được lộ", options: ["A", "B"],
        user_answer: "A", correct_answer: "B", verdict: "incorrect",
        explanation: "Giải thích tạm chưa được lộ",
      }],
    });
    await renderReady();
    expect(container.textContent).toContain("Đang chấm");
    expect(container.textContent).not.toContain("8 / 10");
    expect(container.textContent).not.toContain("Xem lại 2 câu");
    expect(container.textContent).not.toContain("Nội dung tạm chưa được lộ");
    expect(container.textContent).not.toContain("Giải thích tạm chưa được lộ");
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
    expect(container.querySelector('.quiz-wrong-review__compact-review-link[href="/app/study/review/attempt-1"]')).toBeTruthy();
  });

  it("labels wrong answers with their ORIGINAL question number, not their position in the wrong-answer subset", async () => {
    getResult.mockResolvedValue({
      status: "graded", quiz_title: "Quiz", score: 8, max_score: 10, percentage: 80,
      correct_count: 8, incorrect_count: 2, total_questions: 10, duration_seconds: 60,
      questions: QUESTIONS_NONCONSECUTIVE,
    });
    await renderReady();
    const open = [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Xem lại 2 câu"));
    await act(async () => open.click());

    // Rail: exact real ordinals, neither collapsed to 1/2.
    const railLabels = [...container.querySelectorAll(".quiz-wrong-review__rail button strong")]
      .map((node) => node.textContent);
    expect(railLabels).toEqual(["Câu 4", "Câu 9"]);

    // Detail pane (ReviewedQuestion's own ordinal badge) starts on the first
    // wrong question, which is the ORIGINAL 4th question, not the 1st.
    const badge = container.querySelector(".quiz-wrong-review__content .surface-card span.font-mono");
    expect(badge?.textContent).toBe("04");

    // Paging to the second wrong question shows the original 9th question's badge.
    const next = [...container.querySelectorAll('[aria-label="Câu cần ôn tiếp theo"]')][0];
    await act(async () => next.click());
    const badgeAfter = container.querySelector(".quiz-wrong-review__content .surface-card span.font-mono");
    expect(badgeAfter?.textContent).toBe("09");
  });
});
