// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuizTaking from "./QuizTaking";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigate = vi.fn();
let currentQuizId = "quiz-1";
vi.mock("react-router-dom", () => ({
  useLocation: () => ({ state: null }),
  useNavigate: () => navigate,
  useParams: () => ({ quizId: currentQuizId }),
}));
vi.mock("../../components/study/StudyShell", () => ({ default: ({ loading, children, actions }) => <div>{actions}{loading ? "loading" : children}</div> }));
vi.mock("../../components/ui/Modal", () => ({ default: ({ open, children, footer, title }) => open ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null }));

const openAttempt = vi.fn();
const saveAnswers = vi.fn();
const submitAttempt = vi.fn();
vi.mock("../../utils/studyApi", async () => ({
  QUESTION_TYPE_LABEL: { multiple_choice: "Trắc nghiệm", true_false: "Đúng / Sai", short_answer: "Trả lời ngắn" },
  optionLabel: (value) => value === "true" ? "Đúng" : value === "false" ? "Sai" : value,
  moTaLoi: (error, fallback) => error?.message || fallback,
  openAttempt: (...args) => openAttempt(...args),
  saveAnswers: (...args) => saveAnswers(...args),
  submitAttempt: (...args) => submitAttempt(...args),
}));

const QUESTIONS = Array.from({ length: 10 }, (_, index) => ({
  question_id: `q-${index + 1}`,
  question_type: index === 8 ? "true_false" : index === 9 ? "short_answer" : "multiple_choice",
  question_text: `Câu hỏi ${index + 1}`,
  options: index === 8 ? ["true", "false"] : index === 9 ? [] : ["A", "B", "C", "D"],
  concept_tags: [index < 5 ? "Tiến trình" : "Bộ nhớ"],
}));

let container, root;
beforeEach(() => {
  vi.useFakeTimers();
  currentQuizId = "quiz-1";
  navigate.mockReset();
  openAttempt.mockReset();
  saveAnswers.mockReset();
  submitAttempt.mockReset();
  openAttempt.mockResolvedValue({ quiz: { title: "Hệ điều hành", questions: QUESTIONS }, attempt_id: "attempt-1", answers: [], status: "in_progress" });
  saveAnswers.mockResolvedValue({});
  submitAttempt.mockResolvedValue({});
});
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove(); container = null; root = null;
  vi.clearAllMocks(); vi.useRealTimers();
});

async function renderReady({ strict = false } = {}) {
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(strict ? <StrictMode><QuizTaking /></StrictMode> : <QuizTaking />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function chooseFirstAnswer() {
  await act(async () => container.querySelectorAll('input[type="radio"]')[0].click());
}

async function openAndConfirmSubmit() {
  const submit = [...container.querySelectorAll("button")].find((button) => button.textContent === "Nộp bài");
  await act(async () => submit.click());
  const dialog = document.body.querySelector('[role="dialog"]');
  const confirm = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Nộp bài");
  await act(async () => confirm.click());
  return confirm;
}

async function startDebouncedSave() {
  await act(async () => { vi.advanceTimersByTime(600); await Promise.resolve(); });
}

describe("Round 7 populated quiz taking", () => {
  it("autosaves and submits once when mounted through React StrictMode", async () => {
    await renderReady({ strict: true });
    await chooseFirstAnswer();
    await startDebouncedSave();

    expect(saveAnswers).toHaveBeenCalledWith("attempt-1", { "q-1": "A" });

    await openAndConfirmSubmit();
    expect(submitAttempt).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/app/study/result/attempt-1", { replace: true });
  });

  it("renders a 10-question fixture with rail, context, and real radio semantics", async () => {
    await renderReady();
    expect(container.querySelectorAll(".quiz-question-index")).toHaveLength(10);
    expect(container.querySelector('[role="radiogroup"]')).toBeTruthy();
    const radios = container.querySelectorAll('input[type="radio"]');
    expect(radios).toHaveLength(4);
    await act(async () => radios[1].click());
    expect([...radios].filter((radio) => radio.checked)).toHaveLength(1);
    expect(container.textContent).toContain("1 đã trả lời");
  });

  it("shows pending autosave state and flushes before submit", async () => {
    await renderReady();
    await act(async () => container.querySelectorAll('input[type="radio"]')[0].click());
    expect(container.textContent).toContain("1 câu chưa lưu được");
    const submit = [...container.querySelectorAll("button")].find((button) => button.textContent === "Nộp bài");
    await act(async () => submit.click());
    const confirm = [...document.body.querySelector('[role="dialog"]').querySelectorAll("button")].find((button) => button.textContent === "Nộp bài");
    await act(async () => confirm.click());
    expect(saveAnswers).toHaveBeenCalledWith("attempt-1", { "q-1": "A" });
    expect(submitAttempt).toHaveBeenCalledTimes(1);
  });

  it("does not submit when the flush-before-submit save rejects, then submits exactly once after a successful retry", async () => {
    await renderReady();
    await act(async () => container.querySelectorAll('input[type="radio"]')[0].click());

    saveAnswers.mockRejectedValueOnce(new Error("save failed"));
    const submit = [...container.querySelectorAll("button")].find((button) => button.textContent === "Nộp bài");
    await act(async () => submit.click());
    let confirm = [...document.body.querySelector('[role="dialog"]').querySelectorAll("button")].find((button) => button.textContent === "Nộp bài");
    await act(async () => confirm.click());

    // The rejected flush must block submission entirely -- no unsafe submit.
    expect(submitAttempt).not.toHaveBeenCalled();
    expect(container.textContent).toContain("save failed");
    // The rejected batch goes back into the pending queue, not silently dropped.
    expect(container.textContent).toContain("1 câu chưa lưu được");

    // Retry: this time the flush succeeds, and submit goes through exactly once.
    saveAnswers.mockResolvedValueOnce({});
    const retrySubmit = [...container.querySelectorAll("button")].find((button) => button.textContent === "Nộp bài");
    await act(async () => retrySubmit.click());
    confirm = [...document.body.querySelector('[role="dialog"]').querySelectorAll("button")].find((button) => button.textContent === "Nộp bài");
    await act(async () => confirm.click());

    expect(saveAnswers).toHaveBeenCalledTimes(2);
    expect(saveAnswers).toHaveBeenLastCalledWith("attempt-1", { "q-1": "A" });
    expect(submitAttempt).toHaveBeenCalledTimes(1);
    expect(saveAnswers.mock.invocationCallOrder.at(-1)).toBeLessThan(submitAttempt.mock.invocationCallOrder[0]);
    expect(navigate).toHaveBeenCalledWith("/app/study/result/attempt-1", { replace: true });
  });

  it("blocks submit behind an already in-flight autosave and submits once after acknowledgement", async () => {
    const save = deferred();
    saveAnswers.mockReturnValueOnce(save.promise);
    await renderReady();
    await chooseFirstAnswer();
    await startDebouncedSave();
    expect(saveAnswers).toHaveBeenCalledTimes(1);

    await openAndConfirmSubmit();
    expect(submitAttempt).not.toHaveBeenCalled();

    await act(async () => { save.resolve({}); await save.promise; await Promise.resolve(); });
    expect(submitAttempt).toHaveBeenCalledTimes(1);
  });

  it("does not submit when the in-flight autosave rejects and preserves the answer for retry", async () => {
    const save = deferred();
    saveAnswers.mockReturnValueOnce(save.promise);
    await renderReady();
    await chooseFirstAnswer();
    await startDebouncedSave();
    await openAndConfirmSubmit();

    await act(async () => { save.reject(new Error("in-flight failed")); try { await save.promise; } catch { /* expected */ } await Promise.resolve(); });
    expect(submitAttempt).not.toHaveBeenCalled();
    expect(container.textContent).toContain("1 câu chưa lưu được");
    expect(container.textContent).toContain("in-flight failed");
  });

  it("waits for the durable newer answer when A is saving and the user changes to B", async () => {
    const saveA = deferred();
    const saveB = deferred();
    saveAnswers.mockReturnValueOnce(saveA.promise).mockReturnValueOnce(saveB.promise);
    await renderReady();
    await chooseFirstAnswer();
    await startDebouncedSave();

    await act(async () => container.querySelectorAll('input[type="radio"]')[1].click());
    await openAndConfirmSubmit();
    await act(async () => { saveA.resolve({}); await saveA.promise; await Promise.resolve(); });

    expect(saveAnswers).toHaveBeenNthCalledWith(1, "attempt-1", { "q-1": "A" });
    expect(saveAnswers).toHaveBeenNthCalledWith(2, "attempt-1", { "q-1": "B" });
    expect(submitAttempt).not.toHaveBeenCalled();

    await act(async () => { saveB.resolve({}); await saveB.promise; await Promise.resolve(); });
    expect(submitAttempt).toHaveBeenCalledTimes(1);
  });

  it("guards a double confirmation click with one synchronous submit owner", async () => {
    const submit = deferred();
    submitAttempt.mockReturnValueOnce(submit.promise);
    await renderReady();
    await chooseFirstAnswer();
    const confirm = await openAndConfirmSubmit();
    await act(async () => { confirm.click(); confirm.click(); await Promise.resolve(); });
    expect(saveAnswers).toHaveBeenCalledTimes(1);
    expect(submitAttempt).toHaveBeenCalledTimes(1);
    await act(async () => { submit.resolve({}); await submit.promise; });
  });

  it("does not submit or navigate after unmount while a save barrier is pending", async () => {
    const save = deferred();
    saveAnswers.mockReturnValueOnce(save.promise);
    await renderReady();
    await chooseFirstAnswer();
    await startDebouncedSave();
    await openAndConfirmSubmit();
    act(() => root.unmount());
    root = null;

    await act(async () => { save.resolve({}); await save.promise; await Promise.resolve(); });
    expect(submitAttempt).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not carry an old attempt's in-flight completion into a new quiz attempt", async () => {
    const oldSave = deferred();
    saveAnswers.mockReturnValueOnce(oldSave.promise);
    openAttempt.mockImplementation(async (quizId) => ({
      quiz: { title: "Hệ điều hành", questions: QUESTIONS },
      attempt_id: quizId === "quiz-2" ? "attempt-2" : "attempt-1",
      answers: [], status: "in_progress",
    }));
    await renderReady();
    await chooseFirstAnswer();
    await startDebouncedSave();
    await openAndConfirmSubmit();

    currentQuizId = "quiz-2";
    await act(async () => { root.render(<QuizTaking />); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { oldSave.resolve({}); await oldSave.promise; await Promise.resolve(); });

    expect(submitAttempt).not.toHaveBeenCalledWith("attempt-1");
    expect(navigate).not.toHaveBeenCalledWith("/app/study/result/attempt-1", { replace: true });
    expect(container.querySelectorAll('input[type="radio"]')[0].disabled).toBe(false);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    await chooseFirstAnswer();
    await openAndConfirmSubmit();

    expect(saveAnswers).toHaveBeenLastCalledWith("attempt-2", { "q-1": "A" });
    expect(submitAttempt).toHaveBeenCalledTimes(1);
    expect(submitAttempt).toHaveBeenCalledWith("attempt-2");
    expect(navigate).toHaveBeenCalledWith("/app/study/result/attempt-2", { replace: true });
  });
});
