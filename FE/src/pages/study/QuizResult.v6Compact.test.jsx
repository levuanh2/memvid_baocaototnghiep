// @vitest-environment jsdom
// V6 result page: a correct question is one compact row; wrong and partial ones stay in full.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import QuizResult from "./QuizResult";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-router-dom", () => ({ Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>, useParams: () => ({ attemptId: "attempt-1" }) }));
vi.mock("../../components/study/StudyShell", () => ({ default: ({ loading, children, actions }) => <div>{actions}{loading ? "loading" : children}</div> }));
const getResult = vi.fn();
const getConceptMasteries = vi.fn();
vi.mock("../../utils/studyApi", () => ({
  MASTERY_LABEL: { mastered: "Đã nắm tốt", light_review: "Cần ôn nhẹ", review_needed: "Cần ôn lại", critical_gap: "Hổng nghiêm trọng" },
  VERDICT_LABEL: { correct: "Đúng", incorrect: "Sai", partial: "Đúng một phần" },
  formatDuration: (value) => `${value} giây`, formatScore: (score, max) => score == null ? "—" : `${score} / ${max}`,
  masteryPercent: (score) => Math.round(Number(score || 0) * 100),
  optionLabel: (value) => value, moTaLoi: (error, fallback) => error?.message || fallback,
  getResult: (...args) => getResult(...args), getConceptMasteries: (...args) => getConceptMasteries(...args),
}));

const question = (i, verdict) => ({
  question_id: `q-${i}`, question_type: "multiple_choice", question_text: `Câu hỏi ${i}`,
  options: ["A", "B"], user_answer: verdict === "correct" ? "A" : "B", correct_answer: "A", verdict,
  explanation: `Giải thích ${i}`,
});

let container, root;
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); container = null; root = null; vi.clearAllMocks(); });
async function renderReady() {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(<QuizResult />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

describe("QuizResult (V6): compact correct answers", () => {
  it("a correct question shows the answer and a disclosed explanation, without listing every option", async () => {
    getResult.mockResolvedValue({
      status: "graded", quiz_title: "Quiz", score: 1, max_score: 3, percentage: 33,
      correct_count: 1, incorrect_count: 2, total_questions: 3, duration_seconds: 60,
      questions: [question(1, "correct"), question(2, "incorrect"), question(3, "partial")],
    });
    getConceptMasteries.mockResolvedValue([]);
    await renderReady();

    const cards = [...container.querySelectorAll("article")];
    expect(cards).toHaveLength(3);
    const [correct, wrong, partial] = cards;
    expect(correct.classList.contains("quiz-reviewed--compact")).toBe(true);
    expect(correct.querySelectorAll(".answer-option")).toHaveLength(0);
    expect(correct.textContent).toContain("Bạn trả lời: A");
    const why = correct.querySelector("details");
    expect(why.open).toBe(false);
    expect(why.textContent).toContain("Giải thích 1");

    // Wrong and partial answers keep every option, the marked answer and the explanation.
    for (const card of [wrong, partial]) {
      expect(card.classList.contains("quiz-reviewed--compact")).toBe(false);
      expect(card.querySelectorAll(".answer-option")).toHaveLength(2);
      expect(card.textContent).toMatch(/Giải thích [23]/);
    }
  });

  it("in the wrong-answer review, the side panel's plan link is not a second filled button", async () => {
    getResult.mockResolvedValue({
      status: "graded", quiz_title: "Quiz", score: 0, max_score: 1, percentage: 0,
      correct_count: 0, incorrect_count: 1, total_questions: 1, duration_seconds: 60,
      questions: [question(1, "incorrect")],
    });
    getConceptMasteries.mockResolvedValue([]);
    await renderReady();
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Xem lại câu chưa đúng").click());
    const planLinks = [...container.querySelectorAll('a[href="/app/study/review/attempt-1"]')];
    const filled = planLinks.filter((a) => a.className.includes("btn-primary") || a.className.includes("btn-seal"));
    expect(filled).toHaveLength(1);
  });
});
