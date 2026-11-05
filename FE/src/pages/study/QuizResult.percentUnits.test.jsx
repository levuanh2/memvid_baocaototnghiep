// @vitest-environment jsdom
// W2-2 (audit finding, README top-10 #10): the quiz-result score % must
// name "câu đúng" -- both in the visible caption and the score seal's
// accessible label (previously bare "80%" / "Đạt 80 phần trăm").
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

describe("QuizResult — percentages name their unit (W2-2)", () => {
  it("fully-graded score caption and seal label name 'câu đúng'", async () => {
    getResult.mockResolvedValue({
      status: "graded", quiz_title: "Quiz", score: 8, max_score: 10, percentage: 80,
      correct_count: 8, incorrect_count: 2, total_questions: 10, duration_seconds: 60, questions: [],
    });
    await renderReady();
    expect(container.textContent).toContain("80% câu đúng");
    const seal = container.querySelector('[role="img"]');
    expect(seal?.getAttribute("aria-label")).toBe("Đạt 80 phần trăm câu đúng");
  });
});
