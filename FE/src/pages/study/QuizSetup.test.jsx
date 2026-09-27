// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuizSetup from "./QuizSetup";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams({ document: "doc-1" })],
}));

// StudyShell pulls in StudyBreadcrumb -> useStudyContext, which throws
// outside <StudyContextProvider>. Stubbed here (not under test) so it just
// renders what QuizSetup gives it, same as MainLayout's tests stub sibling
// children that have their own dedicated test files.
vi.mock("../../components/study/StudyShell", () => ({
  default: ({ loading, error, children, actions }) => (
    <div>{actions}{loading ? "Đang tải…" : error || children}</div>
  ),
}));

const generateQuiz = vi.fn();
const getDocument = vi.fn();
const listDocuments = vi.fn();
const listSections = vi.fn();
vi.mock("../../utils/studyApi", async () => {
  const actual = await vi.importActual("../../utils/studyApi");
  return {
    ...actual,
    generateQuiz: (...a) => generateQuiz(...a),
    getDocument: (...a) => getDocument(...a),
    listDocuments: (...a) => listDocuments(...a),
    listSections: (...a) => listSections(...a),
  };
});

let container, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  if (container) container.remove();
  container = null; root = null;
  generateQuiz.mockReset(); getDocument.mockReset(); listDocuments.mockReset(); listSections.mockReset();
  navigate.mockReset();
});

beforeEach(() => {
  getDocument.mockResolvedValue({ document_id: "doc-1", title: "Tài liệu 1" });
  listSections.mockResolvedValue([]);
});

async function renderReady() {
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<QuizSetup />));
  // getDocument/listSections resolve on the next microtask tick after mount.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const submitButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo quiz"));
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
function typeInto(input, text) {
  nativeInputValueSetter.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("QuizSetup", () => {
  it("defaults to a 10-question mixed-difficulty payload", async () => {
    generateQuiz.mockResolvedValue({ job_id: "job-1" });
    await renderReady();
    await act(async () => submitButton().click());
    expect(generateQuiz).toHaveBeenCalledWith(expect.objectContaining({
      document_id: "doc-1", question_count: 10, difficulty: "mixed",
    }));
  });

  it("sends a custom question count above the old 5/10/15/20 ceiling", async () => {
    generateQuiz.mockResolvedValue({ job_id: "job-1" });
    await renderReady();
    const input = container.querySelector('input[type="number"]');
    await act(async () => typeInto(input, "35"));
    await act(async () => submitButton().click());
    expect(generateQuiz).toHaveBeenCalledWith(expect.objectContaining({ question_count: 35 }));
  });

  it("clamps a custom count above the backend max before submitting", async () => {
    generateQuiz.mockResolvedValue({ job_id: "job-1" });
    await renderReady();
    const input = container.querySelector('input[type="number"]');
    await act(async () => typeInto(input, "500"));
    await act(async () => submitButton().click());
    expect(generateQuiz).toHaveBeenCalledWith(expect.objectContaining({ question_count: 50 }));
  });

  it("sends the selected difficulty", async () => {
    generateQuiz.mockResolvedValue({ job_id: "job-1" });
    await renderReady();
    const hardBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Khó");
    await act(async () => hardBtn.click());
    await act(async () => submitButton().click());
    expect(generateQuiz).toHaveBeenCalledWith(expect.objectContaining({ difficulty: "hard" }));
  });

  it("sends multiple selected question types", async () => {
    generateQuiz.mockResolvedValue({ job_id: "job-1" });
    await renderReady();
    const shortAnswerBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Trả lời ngắn");
    await act(async () => shortAnswerBtn.click());
    await act(async () => submitButton().click());
    expect(generateQuiz).toHaveBeenCalledWith(expect.objectContaining({
      question_types: ["multiple_choice", "true_false", "short_answer"],
    }));
  });

  it("blocks submit and shows an error when every type is deselected", async () => {
    await renderReady();
    const mcBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Trắc nghiệm");
    const tfBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Đúng / Sai");
    await act(async () => mcBtn.click());
    await act(async () => tfBtn.click());
    await act(async () => submitButton().click());
    expect(generateQuiz).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Chọn ít nhất một dạng câu hỏi.");
  });

  it("sends selected section_ids as scope", async () => {
    listSections.mockResolvedValue([{ section_id: "s1", title: "Mục 1", level: 1 }]);
    generateQuiz.mockResolvedValue({ job_id: "job-1" });
    await renderReady();
    const sectionBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Mục 1");
    await act(async () => sectionBtn.click());
    await act(async () => submitButton().click());
    expect(generateQuiz).toHaveBeenCalledWith(expect.objectContaining({ scope: { section_ids: ["s1"] } }));
  });

  it("renders a preview summary matching the built payload", async () => {
    await renderReady();
    expect(container.textContent).toContain("10 câu · Toàn bộ tài liệu");
    expect(container.textContent).toContain("Độ khó: Trộn");
  });

  it("blocks a second submit while the first is still in flight", async () => {
    let resolveGen;
    generateQuiz.mockReturnValue(new Promise((res) => { resolveGen = res; }));
    await renderReady();
    const btn = submitButton();
    await act(async () => { btn.click(); btn.click(); });
    resolveGen({ job_id: "job-1" });
    await act(async () => { await Promise.resolve(); });
    expect(generateQuiz).toHaveBeenCalledTimes(1);
  });
});
