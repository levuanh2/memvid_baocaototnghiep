// @vitest-environment jsdom
// V6 score header: the attempt question by question, in quiz order, each cell a way to that question.
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
  MASTERY_LABEL: { mastered: "Đã nắm tốt" }, masteryPercent: (score) => Math.round(Number(score || 0) * 100),
  VERDICT_LABEL: { correct: "Đúng", incorrect: "Sai", partial: "Đúng một phần" },
  formatDuration: (value) => `${value} giây`, formatScore: (score, max) => score == null ? "—" : `${score} / ${max}`,
  optionLabel: (value) => value, moTaLoi: (error, fallback) => error?.message || fallback,
  getResult: (...args) => getResult(...args), getConceptMasteries: (...args) => getConceptMasteries(...args),
}));

const question = (i, verdict) => ({
  question_id: `q-${i}`, question_type: "multiple_choice", question_text: `Câu hỏi ${i}`,
  options: ["A", "B"], user_answer: verdict === "correct" ? "A" : "B", correct_answer: "A", verdict,
  explanation: `Giải thích ${i}`,
});
const graded = (verdicts, extra = {}) => ({
  status: "graded", quiz_title: "Quiz", score: 1, max_score: verdicts.length, percentage: 25,
  correct_count: verdicts.filter((v) => v === "correct").length,
  incorrect_count: verdicts.filter((v) => v === "incorrect" || v === "partial").length,
  total_questions: verdicts.length, duration_seconds: 60,
  questions: verdicts.map((v, i) => question(i + 1, v)), ...extra,
});

let container, root;
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); container = null; root = null; vi.clearAllMocks(); });
async function render(body) {
  getResult.mockResolvedValue(body);
  getConceptMasteries.mockResolvedValue([]);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(<QuizResult />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}
const strip = () => container.querySelector('[aria-label="Bài làm theo thứ tự câu"]');
const cells = () => [...strip().querySelectorAll("button")];

describe("QuizResult (V6): the attempt, question by question", () => {
  it("one cell per question in quiz order, each named by its number and verdict", async () => {
    await render(graded(["correct", "incorrect", "partial", "correct"]));
    expect(cells().map((b) => b.getAttribute("aria-label")))
      .toEqual(["Câu 1: Đúng", "Câu 2: Sai", "Câu 3: Đúng một phần", "Câu 4: Đúng"]);
    expect(cells().map((b) => b.dataset.verdict)).toEqual(["correct", "incorrect", "partial", "correct"]);
  });

  it("a cell moves focus to that question in the list (also a compact correct one)", async () => {
    await render(graded(["correct", "incorrect", "correct"]));
    await act(async () => cells()[1].click());
    expect(document.activeElement).toBe(container.querySelector("#cau-2"));
    await act(async () => cells()[2].click());
    expect(document.activeElement).toBe(container.querySelector("#cau-3"));
    expect(document.activeElement.classList.contains("quiz-reviewed--compact")).toBe(true);
  });

  it("an ungraded question (provisional result) is a dashed 'Chưa chấm' cell, never counted as wrong", async () => {
    const body = graded(["correct", "incorrect", "correct"], { ungraded_count: 1, grading_complete: false });
    body.questions.push({ ...question(4, null), verdict: null });
    body.total_questions = 4;
    await render(body);
    expect(cells()[3].getAttribute("aria-label")).toBe("Câu 4: Chưa chấm");
    expect(cells()[3].dataset.verdict).toBe("ungraded");
  });

  it("an unknown verdict value is not trusted (no inherited label, no crash)", async () => {
    const body = graded(["correct", "incorrect"]);
    body.questions[1].verdict = "__proto__";
    await render(body);
    expect(cells()[1].getAttribute("aria-label")).toBe("Câu 2: Chưa chấm");
  });

  it("no strip while the attempt is still being graded", async () => {
    await render({ ...graded(["correct", "incorrect"]), status: "submitted",
      questions: [{ ...question(1, null), verdict: null }, { ...question(2, null), verdict: null }] });
    expect(strip()).toBeNull();
  });

  it("ids exist once: the wrong-answer review does not duplicate #cau-N", async () => {
    await render(graded(["incorrect", "incorrect"]));
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Xem lại câu chưa đúng").click());
    expect(container.querySelectorAll('[id^="cau-"]')).toHaveLength(0);
  });
});
