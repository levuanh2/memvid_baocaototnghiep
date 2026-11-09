// @vitest-environment jsdom
// W2-2: Practice's graded score % must name its unit too, same as QuizResult's.
// PR #137 review: the unit is "điểm" (percentage = score / max_score * 100 with
// partial = 0.5 points), and with NO graded question there is no score at all,
// so the seal must not announce a fabricated 0%.
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

async function submitWith(result) {
  await renderReady();
  submitPractice.mockResolvedValue(result);
  getPracticeComparison.mockResolvedValue({ concepts: [] });
  const submitButton = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Nộp bài luyện tập"));
  await act(async () => { submitButton.click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
const seal = () => container.querySelector('[role="img"]')?.getAttribute("aria-label");

describe("Practice — percentages name their unit (W2-2)", () => {
  it("provisional: '% điểm tạm tính' and a provisional seal label", async () => {
    await submitWith({
      percentage: 60, score: 3, max_score: 5, correct_count: 3, total_questions: 6,
      grading_complete: false, ungraded_count: 1,
    });
    expect(container.textContent).toContain("60% điểm tạm tính trên 5 câu đã chấm");
    expect(seal()).toBe("Kết quả tạm thời 60 phần trăm điểm trên các câu đã chấm");
  });

  it("fully graded, one correct + one partial: the seal says 75 phần trăm điểm while the caption counts 1/2 fully right", async () => {
    await submitWith({
      percentage: 75, score: 1.5, max_score: 2, correct_count: 1, total_questions: 2,
      grading_complete: true, ungraded_count: 0,
    });
    expect(seal()).toBe("Đạt 75 phần trăm điểm");
    expect(container.textContent).toContain("đúng 1/2");
    expect(container.textContent).not.toContain("câu đúng");
  });

  it("a genuine graded 0% is still announced as a score", async () => {
    await submitWith({
      percentage: 0, score: 0, max_score: 2, correct_count: 0, total_questions: 2,
      grading_complete: true, ungraded_count: 0,
    });
    expect(seal()).toBe("Đạt 0 phần trăm điểm");
  });

  it("nothing could be graded: visible 'Chưa chấm được' and the seal says there is no score, not 0%", async () => {
    await submitWith({
      percentage: null, score: 0, max_score: 0, correct_count: 0, total_questions: 2,
      grading_complete: false, ungraded_count: 2,
    });
    expect(container.textContent).toContain("Chưa chấm được");
    expect(container.textContent).toContain("2 câu chưa chấm được");
    const label = seal();
    expect(label).toBe("Chưa có điểm");
    expect(label).not.toMatch(/\d/);
    // Still exposed to assistive technology, just with the true state.
    expect(container.querySelector('[role="img"]').getAttribute("aria-hidden")).not.toBe("true");
  });
});
