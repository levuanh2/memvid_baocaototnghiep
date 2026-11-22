// @vitest-environment jsdom
// A practice job that finishes without a quiz id used to leave `practiceFor` set: no navigation,
// no error, and every practice button disabled until a reload (review of the double-submit guards).
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReviewGuide from "./ReviewGuide";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => navigate,
  useParams: () => ({ attemptId: "attempt-1" }),
}));
// Stub: renders the error AND the content, so the test can see that the buttons are unlocked.
// (The real StudyShell shows the error block in place of the content.)
vi.mock("../../components/study/StudyShell", () => ({
  default: ({ loading, error, children, actions }) => <div>{actions}{error}{loading ? "Đang tải…" : children}</div>,
  EmptyState: ({ title, hint, action }) => <div>{title}{hint}{action}</div>,
}));
let finishJob;
vi.mock("../../hooks/useStudyJob", () => ({
  useStudyJob: ({ onDone }) => { finishJob = onDone; return { running: false, error: null, start: vi.fn() }; },
}));
const generatePractice = vi.fn();
vi.mock("../../utils/studyApi", async () => ({
  ...(await vi.importActual("../../utils/studyApi")),
  getReviewPlan: async () => ({
    summary: "1 chủ đề cần ôn",
    items: [{ review_item_id: "ri-1", topic: "Đạo hàm", priority: 1, status: "review_needed", mastery_score: 0.4, reason: "Sai 3/5 câu", review_tasks: [], chunk_ids: ["c1"] }],
  }),
  generatePractice: (...a) => generatePractice(...a),
}));

let container, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  container = null; root = null;
  vi.clearAllMocks();
});

const practiceButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Luyện ngay"));

describe("ReviewGuide: practice job finishing without a quiz", () => {
  it("shows an error and unlocks the practice buttons", async () => {
    generatePractice.mockResolvedValue({ job_id: "job-1" });
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<ReviewGuide />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => practiceButton().click());
    await act(async () => { await Promise.resolve(); });
    // While the job runs the row is locked (the button shows its busy label or is disabled).
    expect(practiceButton()?.disabled ?? true).toBe(true);

    await act(async () => finishJob({}));
    expect(navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("máy chủ không trả về mã bài");
    expect(practiceButton().disabled).toBe(false);

    await act(async () => practiceButton().click());
    expect(generatePractice).toHaveBeenCalledTimes(2);
  });

  it("with a quiz id it navigates to the practice", async () => {
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<ReviewGuide />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => finishJob({ quiz_id: "quiz-9" }));
    expect(navigate).toHaveBeenCalledWith("/app/study/practice/quiz-9");
  });
});
