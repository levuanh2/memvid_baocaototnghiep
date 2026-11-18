// @vitest-environment jsdom
// #159 item 17: a practice result the AI grader left incomplete offers "Chấm lại câu còn
// thiếu" (POST /api/practice/<id>/regrade, graded inside the request). One request even
// on a double click; the complete result replaces the provisional one; used-up retries
// end the offer; a failed request keeps it.
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import Practice from "./Practice";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const params = { quizId: "quiz-1" };
vi.mock("react-router-dom", () => ({ Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>, useParams: () => params }));
vi.mock("../../components/study/StudyShell", () => ({ default: ({ loading, children, actions }) => <div>{actions}{loading ? "loading" : children}</div> }));
const getPractice = vi.fn();
const getPracticeComparison = vi.fn();
const submitPractice = vi.fn();
const regradePractice = vi.fn();
const getResult = vi.fn();
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
  getResult: (...args) => getResult(...args),
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
  vi.useRealTimers();
  params.quizId = "quiz-1";
});
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
// The page moves focus in a setTimeout(0) once the button is gone: wait one macrotask, not
// only microtasks (CI run 44260869397 caught the race).
const flushTimers = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

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
    await flushTimers();
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
    await flushTimers();
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

  // task39: a reload used to show the comparison only, so the provisional banner and the
  // regrade offer were gone, and after used-up retries nothing said the score was partial.
  async function reopenWith(result) {
    // As the backend answers: the quiz names its latest graded attempt; the comparison
    // is 409 while that result is provisional.
    getPractice.mockResolvedValue({ ...QUIZ, latest_attempt_id: "att-1" });
    if (result.grading_complete === false) getPracticeComparison.mockRejectedValue({ status: 409 });
    else getPracticeComparison.mockResolvedValue({ practice_attempt_id: "att-1", concepts: [] });
    getResult.mockResolvedValue(result);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<Practice />); });
    await flush();
  }

  it("keeps the provisional result and the offer after a reload", async () => {
    await reopenWith({ ...PROVISIONAL, regrade_state: "available" });
    expect(getResult).toHaveBeenCalledWith("att-1");
    expect(container.textContent).toContain("Kết quả tạm thời.");
    expect(regradeButton()).toBeDefined();
    expect(container.textContent, "the result, not the empty quiz").not.toContain("Nộp bài luyện tập");
  });

  it("after a reload with retries used up, says so and offers nothing", async () => {
    await reopenWith({ ...PROVISIONAL, regrade_state: "exhausted" });
    expect(container.textContent).toContain("Kết quả tạm thời.");
    expect(container.textContent).toContain("Đã hết lượt chấm lại cho bài này.");
    expect(regradeButton()).toBeUndefined();
  });

  it("a complete result after a reload shows no banner", async () => {
    await reopenWith({ ...COMPLETE, regrade_state: null });
    expect(container.textContent).not.toContain("Kết quả tạm thời.");
    expect(regradeButton()).toBeUndefined();
  });

  // task A: the regrade runs in a background job; the page waits for the stored result,
  // bounded, and says so when it takes too long.
  const PENDING = { ...PROVISIONAL, grading: "pending", job_id: "job-1", regrade_state: "running" };
  const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

  it("a queued regrade waits for the job and then shows the complete result", async () => {
    vi.useFakeTimers();
    await submitWith(PROVISIONAL);
    regradePractice.mockResolvedValue(PENDING);
    getResult.mockResolvedValueOnce({ ...PROVISIONAL, regrade_state: "running" })
      .mockResolvedValueOnce({ ...COMPLETE, regrade_state: null });
    await act(async () => { regradeButton().click(); });
    expect(container.textContent).toContain("Đang chấm lại các câu còn thiếu");
    expect(regradeButton().disabled).toBe(true);
    await tick(3000);
    expect(container.textContent, "still running").toContain("Kết quả tạm thời.");
    await tick(3000);
    expect(getResult).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Kết quả tạm thời.");
    expect(regradeButton()).toBeUndefined();
    expect(regradePractice, "one request, the rest is reading").toHaveBeenCalledTimes(1);
  });

  it("a job that ends with retries used up says so", async () => {
    vi.useFakeTimers();
    await submitWith(PROVISIONAL);
    regradePractice.mockResolvedValue(PENDING);
    getResult.mockResolvedValue({ ...PROVISIONAL, regrade_state: "exhausted" });
    await act(async () => { regradeButton().click(); });
    await tick(3000);
    expect(container.textContent).toContain("Đã hết lượt chấm lại cho bài này.");
    expect(regradeButton()).toBeUndefined();
  });

  it("stops waiting after five minutes and says the regrade is taking long", async () => {
    vi.useFakeTimers();
    await submitWith(PROVISIONAL);
    regradePractice.mockResolvedValue(PENDING);
    getResult.mockResolvedValue({ ...PROVISIONAL, regrade_state: "running" });
    await act(async () => { regradeButton().click(); });
    await tick(5 * 60 * 1000 + 3000);
    expect(container.textContent).toContain("Việc chấm lại đang lâu hơn bình thường.");
    expect(container.textContent).toContain("Kết quả tạm thời.");
    const calls = getResult.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(101);
    await tick(60_000);
    expect(getResult.mock.calls.length, "no polling after the bound").toBe(calls);
    expect(regradeButton().disabled).toBe(false);
  });

  it("a reload during the job keeps waiting for it", async () => {
    vi.useFakeTimers();
    getResult.mockResolvedValueOnce({ ...PROVISIONAL, regrade_state: "running" })
      .mockResolvedValueOnce({ ...COMPLETE, regrade_state: null });
    await reopenWith({ ...PROVISIONAL, regrade_state: "running" });
    expect(container.textContent).toContain("Đang chấm lại các câu còn thiếu");
    await tick(3000);
    expect(container.textContent).not.toContain("Kết quả tạm thời.");
    expect(regradePractice, "no second job from a reload").not.toHaveBeenCalled();
  });

  // Codex task44: the app renders in StrictMode (setup, cleanup, setup): the poller must
  // survive it, or the button stays "Đang chấm lại…" for ever after a 202.
  it("waits for the job under StrictMode too", async () => {
    vi.useFakeTimers();
    getPractice.mockResolvedValue(QUIZ);
    getPracticeComparison.mockRejectedValue({ status: 409 });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<StrictMode><Practice /></StrictMode>); });
    await flush();
    submitPractice.mockResolvedValue(PROVISIONAL);
    getPracticeComparison.mockResolvedValue({ concepts: [] });
    const submitButton = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Nộp bài luyện tập"));
    await act(async () => { submitButton.click(); });
    await flush();
    regradePractice.mockResolvedValue(PENDING);
    getResult.mockResolvedValue({ ...COMPLETE, regrade_state: null });
    await act(async () => { regradeButton().click(); });
    await tick(3000);
    expect(getResult).toHaveBeenCalled();
    expect(container.textContent).not.toContain("Kết quả tạm thời.");
    expect(regradeButton()).toBeUndefined();
  });

  // Codex task44: the route reuses the component when only the quiz id changes; a poll
  // of the previous quiz must not write its result into the next one.
  it("a poll of the previous practice quiz never writes into the next one", async () => {
    vi.useFakeTimers();
    await submitWith(PROVISIONAL);
    regradePractice.mockResolvedValue(PENDING);
    getResult.mockResolvedValue({ ...COMPLETE, regrade_state: null });
    await act(async () => { regradeButton().click(); });
    getPractice.mockResolvedValue({ ...QUIZ, title: "Quiz B", latest_attempt_id: null });
    getPracticeComparison.mockRejectedValue({ status: 409 });
    params.quizId = "quiz-2";
    await act(async () => { root.render(<Practice />); });
    await flush();
    await tick(6000);
    expect(getResult, "no read of the previous quiz's attempt").not.toHaveBeenCalled();
    expect(container.textContent).toContain("Nộp bài luyện tập");
    expect(container.textContent).not.toContain("2 / 2");
  });

  // Codex task46: a rejected regrade of quiz A, or A's own late load, must not write into
  // quiz B either (not only the successful poll).
  it("a regrade of the previous quiz that fails late writes nothing into the next one", async () => {
    await submitWith(PROVISIONAL);
    let reject;
    regradePractice.mockReturnValue(new Promise((_, r) => { reject = r; }));
    await act(async () => { regradeButton().click(); });
    // Quiz B has its own provisional result, so a stray error would show in its banner.
    getPractice.mockResolvedValue({ ...QUIZ, title: "Quiz B", latest_attempt_id: "att-2" });
    getPracticeComparison.mockRejectedValue({ status: 409 });
    getResult.mockResolvedValue({ ...PROVISIONAL, attempt_id: "att-2", regrade_state: "available" });
    params.quizId = "quiz-2";
    await act(async () => { root.render(<Practice />); });
    await flush();
    expect(container.textContent).toContain("Kết quả tạm thời.");
    await act(async () => { reject(Object.assign(new Error("Máy chủ bận"), { status: 503 })); });
    await flush();
    expect(container.textContent).not.toContain("Máy chủ bận");
    expect(regradeButton()?.disabled, "B's offer is free, not busy with A's request").toBe(false);
  });

  it("a late load of the previous quiz never replaces the next quiz", async () => {
    let releaseA;
    getPractice.mockReturnValueOnce(new Promise((r) => { releaseA = r; }))
      .mockResolvedValue({ ...QUIZ, title: "Quiz B" });
    getPracticeComparison.mockRejectedValue({ status: 409 });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<Practice />); });
    params.quizId = "quiz-2";
    await act(async () => { root.render(<Practice />); });
    await flush();
    await act(async () => { releaseA({ ...QUIZ, title: "Quiz A", latest_attempt_id: "att-1" }); });
    await flush();
    expect(getResult, "A's provisional result is not loaded into B").not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Kết quả tạm thời.");
    expect(container.textContent).toContain("Nộp bài luyện tập");
  });
});
