// @vitest-environment jsdom
// W2-1 (owner decision O5): the result screen's next-step action. Wrong
// answers -> primary "Kế hoạch ôn tập (N chủ đề)" (N = weak topics already
// computed on the page), secondary "Xem lại câu sai". All correct -> primary
// "Về Thư viện", no secondary.
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

describe("O5 — result next-step action", () => {
  it("wrong answers: primary review-plan link (with weak-topic count) comes before the secondary 'Xem lại câu sai' button", async () => {
    getResult.mockResolvedValue({
      status: "graded", quiz_title: "Quiz", score: 8, max_score: 10, percentage: 80,
      correct_count: 8, incorrect_count: 2, total_questions: 10, duration_seconds: 60,
      questions: [question(1, "incorrect"), question(2, "incorrect"), ...Array.from({ length: 8 }, (_, i) => question(i + 3, "correct"))],
    });
    getConceptMasteries.mockResolvedValue([
      { concept_mastery_id: "m1", concept_name: "A", status: "review_needed", mastery_score: 0.3, correct_count: 1, total_count: 3 },
      { concept_mastery_id: "m2", concept_name: "B", status: "review_needed", mastery_score: 0.4, correct_count: 1, total_count: 2 },
      { concept_mastery_id: "m3", concept_name: "C", status: "mastered", mastery_score: 0.9, correct_count: 3, total_count: 3 },
    ]);
    await renderReady();

    const primary = container.querySelector('a[href="/app/study/review/attempt-1"]');
    expect(primary?.textContent).toContain("Kế hoạch ôn tập (2 chủ đề)");
    const secondary = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xem lại câu sai");
    expect(secondary).toBeTruthy();

    // Order: the primary action (StudyShell header slot) is earlier in the
    // document than the secondary (score-board button) — same relative
    // order the mocked StudyShell renders `actions` before `children`.
    const all = [...container.querySelectorAll("a, button")];
    expect(all.indexOf(primary)).toBeLessThan(all.indexOf(secondary));
  });

  it("wrong answers with no weak topics computed yet: primary falls back to the plain label", async () => {
    getResult.mockResolvedValue({
      status: "graded", quiz_title: "Quiz", score: 8, max_score: 10, percentage: 80,
      correct_count: 8, incorrect_count: 2, total_questions: 10, duration_seconds: 60,
      questions: [question(1, "incorrect"), question(2, "incorrect"), ...Array.from({ length: 8 }, (_, i) => question(i + 3, "correct"))],
    });
    getConceptMasteries.mockResolvedValue([]);
    await renderReady();
    const primary = container.querySelector('a[href="/app/study/review/attempt-1"]');
    expect(primary?.textContent).toContain("Kế hoạch ôn tập");
    expect(primary?.textContent).not.toContain("chủ đề");
  });

  it("all correct: primary goes back to the Library, no secondary button, no review-plan link", async () => {
    getResult.mockResolvedValue({
      status: "graded", quiz_title: "Quiz", score: 10, max_score: 10, percentage: 100,
      correct_count: 10, incorrect_count: 0, total_questions: 10, duration_seconds: 60,
      questions: Array.from({ length: 10 }, (_, i) => question(i + 1, "correct")),
    });
    getConceptMasteries.mockResolvedValue([
      { concept_mastery_id: "m1", concept_name: "A", status: "mastered", mastery_score: 1, correct_count: 3, total_count: 3 },
    ]);
    await renderReady();

    const library = container.querySelector('a[href="/app/study"]');
    expect(library?.textContent).toContain("Về Thư viện");
    expect(container.querySelector('a[href="/app/study/review/attempt-1"]')).toBeNull();
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Xem lại câu sai")).toBe(false);
  });
});
