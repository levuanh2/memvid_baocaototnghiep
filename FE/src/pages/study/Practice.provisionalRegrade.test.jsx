// @vitest-environment jsdom
// #159 item 17: a practice result the AI grader left incomplete offers "Chấm lại câu còn
// thiếu" (POST /api/practice/<id>/regrade, graded inside the request). One request even
// on a double click; the complete result replaces the provisional one; used-up retries
// end the offer; a failed request keeps it.
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
const regradePractice = vi.fn();
vi.mock("../../utils/studyApi", () => ({
  MASTERY_LABEL: { review_needed: "Cần ôn lại" },
  QUESTION_TYPE_LABEL: { multiple_choice: "Trắc nghiệm", short_answer: "Tự luận" },
  formatScore: (score, max) => score == null ? "—" : `${score} / ${max}`,
  masteryPercent: (score) => Math.round(Number(score || 0) * 100),
  optionLabel: (value) => value, moTaLoi: (error, fallback) => error?.message || fallback,
  getPractice: (...args) => getPractice(...args),
  getPracticeComparison: (...args) => getPracticeComparison(...args),
  submitPractice: (...args) => submitPractice(...args),
  regradePractice: (...args) => regradePractice(...args),
}));

const QUIZ = {
  title: "Quiz", source_attempt_id: null,
  questions: [{ question_id: "q1", question_type: "short_answer", question_text: "Câu hỏi" }],
};
const PROVISIONAL = {
  attempt_id: "att-1", percentage: 100, score: 1, max_score: 1, correct_count: 1,
  total_questions: 2, grading_complete: false, ungraded_count: 1,
};
const COMPLETE = { ...PROVISIONAL, score: 2, max_score: 2, correct_count: 2, grading_complete: true, ungraded_count: 0 };

let container, root;
afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.clearAllMocks();
});
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };

async function submitWith(result) {
  getPractice.mockResolvedValue(QUIZ);
  getPracticeComparison.mockRejectedValue({ status: 409 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Practice />); });
  await flush();
  submitPractice.mockResolvedValue(result);
  getPracticeComparison.mockResolvedValue({ concepts: [] });
  const submitButton = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Nộp bài luyện tập"));
  await act(async () => { submitButton.click(); });
  await flush();
}
const regradeButton = () => [...container.querySelectorAll("button")].find((b) => /Chấm lại câu còn thiếu|Đang chấm lại/.test(b.textContent));
const failure = (status, code, body = {}) => Object.assign(new Error(code), { status, code, body: { error: code, ...body } });

describe("Practice — Chấm lại câu còn thiếu", () => {
  it("is offered on a provisional result only", async () => {
    await submitWith(PROVISIONAL);
    expect(regradeButton()).toBeDefined();
    act(() => root.unmount()); document.body.removeChild(container); root = null; container = null;
    await submitWith(COMPLETE);
    expect(regradeButton()).toBeUndefined();
  });

  it("sends one request on a double click and shows the complete result", async () => {
    await submitWith(PROVISIONAL);
    let release;
    regradePractice.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const button = regradeButton();
    await act(async () => { button.click(); button.click(); });
    expect(regradePractice).toHaveBeenCalledTimes(1);
    expect(regradePractice).toHaveBeenCalledWith("quiz-1", "att-1");
    await act(async () => { release(COMPLETE); });
    await flush();
    expect(container.textContent).not.toContain("điểm tạm tính");
    expect(regradeButton()).toBeUndefined();
  });

  it("ends the offer when retries are used up, keeping the provisional result", async () => {
    await submitWith(PROVISIONAL);
    // Recognised by the machine code, not by the wording (agy task38 F2).
    regradePractice.mockRejectedValue(failure(409, "Thông báo đã đổi chữ", { ma: "het_luot_cham_lai" }));
    await act(async () => { regradeButton().click(); });
    await flush();
    expect(regradeButton()).toBeUndefined();
    expect(container.textContent).toContain("Đã hết lượt chấm lại cho bài này. Kết quả tạm thời được giữ nguyên.");
    expect(container.textContent).toContain("điểm tạm tính");
    expect(document.activeElement?.getAttribute("role"), "focus moves to the banner text").toBe("status");
  });

  it("says so when a regrade did not grade the missing answers, and names how many", async () => {
    await submitWith(PROVISIONAL);
    expect(container.textContent).toContain("1 câu tự luận chưa chấm được do bộ chấm AI không khả dụng");
    regradePractice.mockResolvedValue(PROVISIONAL);
    await act(async () => { regradeButton().click(); });
    await flush();
    expect(container.textContent).toContain("Lần chấm lại vừa rồi chưa chấm được các câu này. Bạn có thể thử thêm.");
    expect(regradeButton()).toBeDefined();
  });

  it("moves focus to the result when the regrade completes and the button goes away", async () => {
    await submitWith(PROVISIONAL);
    regradePractice.mockResolvedValue(COMPLETE);
    regradeButton().focus();
    await act(async () => { regradeButton().click(); });
    await flush();
    expect(regradeButton()).toBeUndefined();
    expect(document.activeElement).not.toBe(document.body);
  });

  it("keeps the offer when the request fails or another one is grading", async () => {
    await submitWith(PROVISIONAL);
    regradePractice.mockRejectedValue(failure(409, "Bài nộp này đang được chấm, thử lại sau ít giây"));
    await act(async () => { regradeButton().click(); });
    await flush();
    expect(container.textContent).toContain("Bài nộp này đang được chấm");
    expect(regradeButton()).toBeDefined();
  });
});
