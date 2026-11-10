// @vitest-environment jsdom
// W2-2 (audit finding, README top-10 #10): the quiz-result score % must name
// its unit -- both in the visible caption and the score seal's accessible label
// (previously bare "80%" / "Đạt 80 phần trăm").
// PR #137 review: the unit is "điểm", not "câu đúng". `percentage` is
// score / max_score * 100 (BE grading.py: correct = 1, partial = 0.5 points), so
// one correct + one partial answer is 75% while only 1/2 answers is fully right.
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
  MASTERY_LABEL: { review_needed: "Cần ôn lại" }, VERDICT_LABEL: { correct: "Đúng", incorrect: "Sai", partial: "Đúng một phần" },
  formatDuration: (value) => `${value} giây`, formatScore: (score, max) => score == null ? "—" : `${score} / ${max}`,
  masteryPercent: (score) => Math.round(Number(score || 0) * 100),
  optionLabel: (value) => value, moTaLoi: (error, fallback) => error?.message || fallback,
  getResult: (...args) => getResult(...args), getConceptMasteries: (...args) => getConceptMasteries(...args),
}));

let container, root;
afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.clearAllMocks();
});
async function renderReady() {
  getConceptMasteries.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<QuizResult />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const graded = (over) => ({
  status: "graded", quiz_title: "Quiz", duration_seconds: 60, questions: [], ...over,
});
const seal = () => container.querySelector('[role="img"]')?.getAttribute("aria-label");

describe("QuizResult — percentages name their unit (W2-2)", () => {
  it("fully-graded score caption and seal label name 'điểm'", async () => {
    getResult.mockResolvedValue(graded({
      score: 8, max_score: 10, percentage: 80, correct_count: 8, incorrect_count: 2, total_questions: 10,
    }));
    await renderReady();
    expect(container.textContent).toContain("80% điểm");
    expect(seal()).toBe("Đạt 80 phần trăm điểm");
  });

  it("all answers correct: 100% điểm", async () => {
    getResult.mockResolvedValue(graded({
      score: 4, max_score: 4, percentage: 100, correct_count: 4, incorrect_count: 0, total_questions: 4,
    }));
    await renderReady();
    expect(container.textContent).toContain("100% điểm");
    expect(seal()).toBe("Đạt 100 phần trăm điểm");
  });

  it("one correct + one partial is 75% of the points, never '75% câu đúng' (only 1/2 is fully right)", async () => {
    getResult.mockResolvedValue(graded({
      score: 1.5, max_score: 2, percentage: 75, correct_count: 1, incorrect_count: 1, total_questions: 2,
    }));
    await renderReady();
    expect(container.textContent).toContain("75% điểm");
    expect(container.textContent).not.toContain("câu đúng");
    expect(seal()).toBe("Đạt 75 phần trăm điểm");
  });

  it("a genuine graded 0% is still announced as a score", async () => {
    getResult.mockResolvedValue(graded({
      score: 0, max_score: 3, percentage: 0, correct_count: 0, incorrect_count: 3, total_questions: 3,
    }));
    await renderReady();
    expect(container.textContent).toContain("0% điểm");
    expect(seal()).toBe("Đạt 0 phần trăm điểm");
  });

  it("provisional: '% điểm tạm tính' and a provisional seal label", async () => {
    getResult.mockResolvedValue(graded({
      score: 1, max_score: 1, percentage: 100, correct_count: 1, incorrect_count: 0, total_questions: 2,
      grading_complete: false, ungraded_count: 1,
    }));
    await renderReady();
    expect(container.textContent).toContain("100% điểm tạm tính trên 1 câu đã chấm");
    expect(seal()).toBe("Kết quả tạm thời 100 phần trăm điểm trên các câu đã chấm");
  });
});
