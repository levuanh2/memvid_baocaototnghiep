// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuizTaking from "./QuizTaking";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useLocation: () => ({ state: null }),
  useNavigate: () => navigate,
  useParams: () => ({ quizId: "quiz-1" }),
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
  openAttempt.mockResolvedValue({ quiz: { title: "Hệ điều hành", questions: QUESTIONS }, attempt_id: "attempt-1", answers: [], status: "in_progress" });
  saveAnswers.mockResolvedValue({});
  submitAttempt.mockResolvedValue({});
});
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove(); container = null; root = null;
  vi.clearAllMocks(); vi.useRealTimers();
});

async function renderReady() {
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<QuizTaking />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("Round 7 populated quiz taking", () => {
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
});
