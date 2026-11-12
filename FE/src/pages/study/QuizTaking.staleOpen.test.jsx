// @vitest-environment jsdom
// /quiz/A -> /quiz/B while A's open is slow (V6 bug hunt #14). A used to answer last and put
// its questions and attempt under B's URL, so autosave and submit went to A's attempt.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import QuizTaking from "./QuizTaking";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigate = vi.fn();
let currentQuizId = "quiz-A";
vi.mock("react-router-dom", () => ({
  useLocation: () => ({ state: null }),
  useNavigate: () => navigate,
  useParams: () => ({ quizId: currentQuizId }),
}));
vi.mock("../../components/study/StudyShell", () => ({ default: ({ loading, error, children }) => <div>{loading ? "loading" : error || children}</div> }));
vi.mock("../../components/ui/Modal", () => ({ default: () => null }));

const pending = {};
vi.mock("../../utils/studyApi", async () => ({
  QUESTION_TYPE_LABEL: { multiple_choice: "Trắc nghiệm" },
  optionLabel: (value) => value,
  moTaLoi: (error, fallback) => error?.message || fallback,
  openAttempt: (quizId) => new Promise((resolve, reject) => { pending[quizId] = { resolve, reject }; }),
  saveAnswers: vi.fn(async () => ({})),
  submitAttempt: vi.fn(async () => ({})),
}));

const body = (name) => ({
  quiz: { title: `Quiz ${name}`, questions: [{ question_id: `q-${name}`, question_type: "multiple_choice", question_text: `Câu của ${name}`, options: ["A", "B"], concept_tags: [] }] },
  attempt_id: `attempt-${name}`, answers: [], status: "in_progress",
});

let container, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove(); container = null; root = null;
  currentQuizId = "quiz-A";
  for (const k of Object.keys(pending)) delete pending[k];
  vi.clearAllMocks();
});
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

async function goFromAToB() {
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<QuizTaking />));
  currentQuizId = "quiz-B";
  await act(async () => root.render(<QuizTaking />));
  expect(pending["quiz-A"] && pending["quiz-B"]).toBeTruthy();
}

describe("QuizTaking: a slow open for the previous quiz cannot land on the new one", () => {
  it("A answering after B leaves B's questions on screen", async () => {
    await goFromAToB();
    await act(async () => { pending["quiz-B"].resolve(body("B")); });
    await flush();
    await act(async () => { pending["quiz-A"].resolve(body("A")); });
    await flush();
    expect(container.textContent).toContain("Câu của B");
    expect(container.textContent).not.toContain("Câu của A");
  });

  it("A failing late shows no error and does not end B's loading", async () => {
    await goFromAToB();
    await act(async () => { pending["quiz-A"].reject(new Error("A hỏng muộn")); });
    await flush();
    expect(container.textContent).toBe("loading");
  });

  it("B failing after A had loaded shows B's error, not A's questions", async () => {
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<QuizTaking />));
    await act(async () => { pending["quiz-A"].resolve(body("A")); });
    await flush();
    expect(container.textContent).toContain("Câu của A");

    currentQuizId = "quiz-B";
    await act(async () => root.render(<QuizTaking />));
    await act(async () => { pending["quiz-B"].reject(new Error("B không mở được")); });
    await flush();
    expect(container.textContent).not.toContain("Câu của A");
    expect(container.textContent).toContain("B không mở được");
  });

  it("A, already finished, does not redirect B to A's result", async () => {
    await goFromAToB();
    await act(async () => { pending["quiz-A"].resolve({ ...body("A"), status: "submitted" }); });
    await flush();
    expect(navigate).not.toHaveBeenCalled();
  });
});
