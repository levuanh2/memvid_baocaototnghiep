// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReviewGuide from "./ReviewGuide";

vi.mock("react-router-dom", () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
  useParams: () => ({ attemptId: "attempt-1" }),
}));

// StudyShell pulls in StudyBreadcrumb -> useStudyContext, which throws
// outside <StudyContextProvider>; not under test here, same stub pattern as
// QuizSetup.test.jsx.
vi.mock("../../components/study/StudyShell", () => ({
  default: ({ loading, error, children, actions }) => (
    <div>{actions}{loading ? "Đang tải…" : error || children}</div>
  ),
  EmptyState: ({ title, hint, action }) => <div>{title}{hint}{action}</div>,
}));

const getReviewPlan = vi.fn();
const generatePractice = vi.fn();
const generateReviewPlan = vi.fn();
vi.mock("../../utils/studyApi", async () => {
  const actual = await vi.importActual("../../utils/studyApi");
  return {
    ...actual,
    getReviewPlan: (...a) => getReviewPlan(...a),
    generateReviewPlan: (...a) => generateReviewPlan(...a),
    generatePractice: (...a) => generatePractice(...a),
  };
});

const PLAN = {
  summary: "2 chủ đề cần ôn",
  items: [
    { review_item_id: "ri-1", topic: "Đạo hàm", priority: 1, status: "review_needed",
      mastery_score: 0.4, reason: "Sai 3/5 câu", review_tasks: [], chunk_ids: ["c1", "c2"] },
  ],
};

let container, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  if (container) container.remove();
  container = null; root = null;
  getReviewPlan.mockReset(); generatePractice.mockReset(); generateReviewPlan.mockReset();
});

beforeEach(() => { getReviewPlan.mockResolvedValue(PLAN); });

async function renderReady() {
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<ReviewGuide />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const byText = (txt) => [...document.body.querySelectorAll("button")].find((b) => b.textContent.includes(txt));

describe("ReviewGuide provisional plan", () => {
  it("says the plan covers only the graded answers when some could not be graded", async () => {
    getReviewPlan.mockResolvedValue({ ...PLAN, ungraded_count: 2 });
    await renderReady();
    expect(container.textContent).toContain(
      "Kế hoạch này chỉ dựa trên các câu đã chấm. 2 câu tự luận chưa chấm được nên không nằm trong kế hoạch.");
  });

  // It must not steer the learner to "Tạo lại kế hoạch" (#190): the note is about the
  // grading, not an instruction.
  it("says the plan is older than the latest grading, without pushing a regenerate", async () => {
    getReviewPlan.mockResolvedValue({ ...PLAN, ungraded_count: 0, outdated: true });
    await renderReady();
    expect(container.textContent).toContain(
      "Bài làm đã được chấm lại sau khi tạo kế hoạch này, nên các chủ đề bên dưới có thể chưa khớp với kết quả mới.");
    expect(container.querySelector('[role="status"]')?.textContent).not.toContain("Tạo lại");
  });

  it("adds no note to a plan from a complete result", async () => {
    getReviewPlan.mockResolvedValue({ ...PLAN, ungraded_count: 0, outdated: false });
    await renderReady();
    expect(container.textContent).not.toContain("chỉ dựa trên các câu đã chấm");
    expect(container.textContent).not.toContain("đã được chấm lại");
  });
});

describe("Tạo lại kế hoạch", () => {
  // Regenerating archives the old topics (issue #18, owner option B): nothing is deleted.
  // It still asks first, and says exactly that (owner decision 2026-11-17, PR #190).
  it("asks first, says the old topics are kept with their practice, and sends nothing before it", async () => {
    await renderReady();
    await act(async () => byText("Tạo lại kế hoạch").click());
    expect(generateReviewPlan).not.toHaveBeenCalled();
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Bài luyện tập đã tạo và kết quả làm bài của chúng vẫn được giữ nguyên.");
    expect(dialog?.textContent).not.toMatch(/xoá|Không thể hoàn tác/i);
  });

  it("regenerates with force after the learner confirms, once even on a double click", async () => {
    let release;
    generateReviewPlan.mockReturnValue(new Promise((r) => { release = r; }));
    await renderReady();
    await act(async () => byText("Tạo lại kế hoạch").click());
    const dialog = document.body.querySelector('[role="dialog"]');
    const confirm = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tạo lại kế hoạch");
    await act(async () => { confirm.click(); confirm.click(); });
    expect(generateReviewPlan).toHaveBeenCalledTimes(1);
    expect(generateReviewPlan).toHaveBeenCalledWith("attempt-1", { force: true });
    await act(async () => { release({ ...PLAN, summary: "Kế hoạch mới" }); await Promise.resolve(); });
    expect(container.textContent).toContain("Kế hoạch mới");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the dialog open with the error when regeneration fails", async () => {
    generateReviewPlan.mockRejectedValue(Object.assign(new Error("Máy chủ bận"), { status: 503 }));
    await renderReady();
    await act(async () => byText("Tạo lại kế hoạch").click());
    const dialog = document.body.querySelector('[role="dialog"]');
    const confirm = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Tạo lại kế hoạch");
    await act(async () => { confirm.click(); await Promise.resolve(); });
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("Máy chủ bận");
  });

  it("lists the previous plan's topics read-only, with links to their practice quizzes", async () => {
    getReviewPlan.mockResolvedValue({ ...PLAN, archived_items: [{
      review_item_id: "old-1", topic: "Chủ đề cũ", priority: 1, status: "review_needed",
      mastery_score: 0.5, archived_at: "2026-11-18T08:00:00+00:00", practice_quiz_ids: ["pq-1"] }] });
    await renderReady();
    const section = document.body.querySelector('[aria-labelledby="ke-hoach-truoc"]');
    expect(section?.textContent).toContain("Chủ đề cũ");
    expect(section.querySelector('a[href="/app/study/practice/pq-1"]')).not.toBeNull();
    expect([...section.querySelectorAll("button")].map((b) => b.textContent), "no new practice").toEqual([]);
  });
});

describe("ReviewGuide practice actions", () => {
  it("Luyện ngay sends the exact prior smart-default body (count 5, difficulty easy, no question_types)", async () => {
    generatePractice.mockResolvedValue({ job_id: "job-1" });
    await renderReady();
    await act(async () => byText("Luyện ngay").click());
    expect(generatePractice).toHaveBeenCalledWith({
      review_item_id: "ri-1", question_count: 5, difficulty: "easy",
    });
  });

  it("Tùy chỉnh opens the builder dialog pre-filled with the review item's topic and chunk count, read-only", async () => {
    await renderReady();
    await act(async () => byText("Tùy chỉnh").click());
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("Đạo hàm");
    expect(dialog.textContent).toContain("2 đoạn");
    expect(generatePractice).not.toHaveBeenCalled();
  });

  it("custom count, difficulty, and question types all reach the API", async () => {
    generatePractice.mockResolvedValue({ job_id: "job-1" });
    await renderReady();
    await act(async () => byText("Tùy chỉnh").click());
    const dialog = document.body.querySelector('[role="dialog"]');

    const preset20 = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "20 câu");
    await act(async () => preset20.click());
    const hard = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Khó");
    await act(async () => hard.click());
    const shortAnswer = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Trả lời ngắn");
    await act(async () => shortAnswer.click()); // deselect, leaving multiple_choice + true_false

    const submit = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo câu luyện tập"));
    await act(async () => submit.click());

    expect(generatePractice).toHaveBeenCalledWith({
      review_item_id: "ri-1", question_count: 20, difficulty: "hard",
      question_types: ["multiple_choice", "true_false"],
    });
  });

  it("Huỷ closes the dialog without calling generatePractice", async () => {
    await renderReady();
    await act(async () => byText("Tùy chỉnh").click());
    const dialog = document.body.querySelector('[role="dialog"]');
    const cancel = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Huỷ");
    await act(async () => cancel.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeFalsy();
    expect(generatePractice).not.toHaveBeenCalled();
  });

  it("blocks submit and shows an error when every type is deselected in Customize", async () => {
    await renderReady();
    await act(async () => byText("Tùy chỉnh").click());
    const dialog = document.body.querySelector('[role="dialog"]');
    for (const label of ["Trắc nghiệm", "Đúng / Sai", "Trả lời ngắn"]) {
      const btn = [...dialog.querySelectorAll("button")].find((b) => b.textContent === label);
      await act(async () => btn.click());
    }
    const submit = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo câu luyện tập"));
    await act(async () => submit.click());
    expect(generatePractice).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain("Chọn ít nhất một dạng câu hỏi.");
  });

  it("generation progress still renders after a Customize submit", async () => {
    let resolveGen;
    generatePractice.mockReturnValue(new Promise((res) => { resolveGen = res; }));
    await renderReady();
    await act(async () => byText("Tùy chỉnh").click());
    const dialog = document.body.querySelector('[role="dialog"]');
    const submit = [...dialog.querySelectorAll("button")].find((b) => b.textContent.includes("Tạo câu luyện tập"));
    await act(async () => submit.click());
    resolveGen({ job_id: "job-1" });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("Đang soạn câu luyện tập");
  });
});
