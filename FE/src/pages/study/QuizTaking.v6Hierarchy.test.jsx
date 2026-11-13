// @vitest-environment jsdom
// V6 quiz-taking screen: one way to hand in, one primary action at a time, no blank page for a
// quiz without questions, no third column repeating the progress count.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuizTaking from "./QuizTaking";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigate = vi.fn();   // one stable function: `load` depends on it
vi.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useLocation: () => ({ state: null }),
  useNavigate: () => navigate,
  useParams: () => ({ quizId: "quiz-1" }),
}));
vi.mock("../../components/study/StudyShell", () => ({ default: ({ loading, children, actions }) => <div>{actions}{loading ? "loading" : children}</div> }));
vi.mock("../../components/ui/Modal", () => ({ default: ({ open, children, footer, title }) => (open ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null) }));

const openAttempt = vi.fn();
vi.mock("../../utils/studyApi", async () => ({
  QUESTION_TYPE_LABEL: { multiple_choice: "Trắc nghiệm" },
  optionLabel: (value) => value,
  moTaLoi: (error, fallback) => error?.message || fallback,
  openAttempt: (...args) => openAttempt(...args),
  saveAnswers: vi.fn(async () => ({})),
  submitAttempt: vi.fn(async () => ({})),
}));

const question = (n) => ({
  question_id: `q-${n}`, question_type: "multiple_choice", question_text: `Câu hỏi ${n}`,
  options: ["A", "B"], concept_tags: [n === 1 ? "Tiến trình" : "Bộ nhớ"],
});
const quizWith = (count) => ({
  quiz: { title: "Hệ điều hành", questions: Array.from({ length: count }, (_, i) => question(i + 1)) },
  attempt_id: "attempt-1", answers: [], status: "in_progress",
});

let host, root;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  act(() => root?.unmount());
  host?.remove(); host = null; root = null;
  vi.clearAllMocks(); vi.useRealTimers();
});

async function render(body) {
  openAttempt.mockResolvedValue(body);
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<QuizTaking />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
const buttons = (text) => [...host.querySelectorAll("button")].filter((b) => b.textContent.trim().startsWith(text));
const nav = (text) => [...host.querySelectorAll(".quiz-question-nav button")].find((b) => b.textContent.includes(text));

describe("QuizTaking (V6): action hierarchy", () => {
  it("has exactly one control that hands the quiz in", async () => {
    await render(quizWith(3));
    expect(buttons("Nộp bài")).toHaveLength(1);
    expect(host.textContent).not.toContain("Nộp bài sớm");
  });

  it("'Câu sau' is the primary action while a later question is unanswered; 'Nộp bài' is not", async () => {
    await render(quizWith(3));
    expect(nav("Câu sau").className).toContain("btn-primary");
    expect(nav("Nộp bài").className).toContain("btn-secondary");
    expect(nav("Nộp bài").className).not.toContain("btn-seal");
  });

  it("on the last question 'Nộp bài' becomes the primary action", async () => {
    await render(quizWith(2));
    await act(async () => nav("Câu sau").click());
    expect(nav("Nộp bài").className).toContain("btn-seal");
    expect(nav("Câu sau").className).toContain("btn-secondary");
    expect(nav("Câu sau").disabled).toBe(true);
  });

  it("once every question is answered 'Nộp bài' is primary even on an earlier question", async () => {
    await render(quizWith(2));
    await act(async () => host.querySelector('input[type="radio"]').click());
    await act(async () => nav("Câu sau").click());
    await act(async () => host.querySelector('input[type="radio"]').click());
    await act(async () => nav("Câu trước").click());
    expect(nav("Nộp bài").className).toContain("btn-seal");
  });

  it("puts the topics in the question rail and has no separate progress column", async () => {
    await render(quizWith(2));
    expect(host.querySelector(".quiz-context-panel")).toBeNull();
    const rail = host.querySelector(".quiz-question-rail");
    expect(rail.textContent).toContain("Tiến trình");
    expect(rail.textContent).toContain("Bộ nhớ");
    // Topic names are shown as words, not as "#tag".
    expect(host.querySelector(".quiz-question-card").textContent).not.toContain("#");
  });

  it("a quiz without questions says so and offers the way back, instead of a blank page", async () => {
    await render(quizWith(0));
    expect(host.textContent).toContain("Quiz này không có câu hỏi nào.");
    expect(host.querySelector('a[href="/app/study"]')).toBeTruthy();
  });
});
