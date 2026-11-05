// @vitest-environment jsdom
// W2-2: Practice's graded score % must name "câu đúng" too, same as
// QuizResult's -- the audit finding is about these percentages appearing
// without a unit, not about any one screen specifically.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import Practice from "./Practice";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-router-dom", () => ({ Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>, useParams: () => ({ quizId: "quiz-1" }) }));
vi.mock("../../components/study/StudyShell", () => ({ default: ({ loading, children, actions }) => <div>{actions}{loading ? "loading" : children}</div> }));
const getPractice = vi.fn();
const getPracticeComparison = vi.fn();
const submitPractice = vi.fn();
vi.mock("../../utils/studyApi", () => ({
  MASTERY_LABEL: { review_needed: "Cần ôn lại" },
  QUESTION_TYPE_LABEL: { multiple_choice: "Trắc nghiệm", short_answer: "Tự luận" },
  formatScore: (score, max) => score == null ? "—" : `${score} / ${max}`,
  masteryPercent: (score) => Math.round(Number(score || 0) * 100),
  optionLabel: (value) => value, moTaLoi: (error, fallback) => error?.message || fallback,
  getPractice: (...args) => getPractice(...args),
  getPracticeComparison: (...args) => getPracticeComparison(...args),
  submitPractice: (...args) => submitPractice(...args),
}));

const QUIZ = {
  title: "Quiz", source_attempt_id: null,
  questions: [{ question_id: "q1", question_type: "multiple_choice", question_text: "Câu hỏi", options: ["A", "B"] }],
};

let container, root;
afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.clearAllMocks();
});

async function renderReady() {
  getPractice.mockResolvedValue(QUIZ);
  getPracticeComparison.mockRejectedValue({ status: 409 }); // "no prior attempt yet" -- the real not-done shape
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Practice />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

describe("Practice — percentages name their unit (W2-2)", () => {
  it("graded score % names 'câu đúng' (provisional case)", async () => {
    await renderReady();
    submitPractice.mockResolvedValue({
      percentage: 60, score: 3, max_score: 5, correct_count: 3, total_questions: 5,
      grading_complete: false, ungraded_count: 1,
    });
    getPracticeComparison.mockResolvedValue({ concepts: [] });
    const submitButton = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Nộp bài luyện tập"));
    await act(async () => { submitButton.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(container.textContent).toContain("60% câu đúng tạm tính trên 5 câu đã chấm");
    const seal = container.querySelector('[role="img"]');
    expect(seal?.getAttribute("aria-label")).toBe("Đạt 60 phần trăm câu đúng");
  });
});
