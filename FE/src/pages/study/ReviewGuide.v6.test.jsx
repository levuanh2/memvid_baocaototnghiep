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

vi.mock("../../components/study/StudyShell", () => ({
  default: ({ loading, error, children, actions }) => (
    <div>{actions}{loading ? "Đang tải…" : error || children}</div>
  ),
  EmptyState: ({ title, hint, action }) => <div>{title}{hint}{action}</div>,
}));

const getReviewPlan = vi.fn();
vi.mock("../../utils/studyApi", async () => {
  const actual = await vi.importActual("../../utils/studyApi");
  return {
    ...actual,
    getReviewPlan: (...args) => getReviewPlan(...args),
    generateReviewPlan: vi.fn(),
    generatePractice: vi.fn(),
  };
});

const item = (id, chunkIds) => ({
  review_item_id: id,
  topic: `Chủ đề ${id}`,
  priority: Number(id),
  status: "review_needed",
  mastery_score: 0.4,
  reason: "Cần ôn lại",
  review_tasks: [],
  chunk_ids: chunkIds,
});

let container;
let root;

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  container = null;
  root = null;
  getReviewPlan.mockReset();
});

beforeEach(() => {
  getReviewPlan.mockResolvedValue({
    summary: "Các phần cần ôn",
    items: [item("1", ["c1", "c2"]), item("2", ["c2", "c3"]), item("3", [])],
  });
});

async function renderReady() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<ReviewGuide />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("ReviewGuide v6 hierarchy and overview", () => {
  it("renders one primary practice action and all remaining actions as secondary", async () => {
    await renderReady();
    const actions = [...container.querySelectorAll("button")]
      .filter((button) => button.textContent.includes("Luyện ngay (5 câu)"));

    expect(actions).toHaveLength(3);
    expect(actions[0].classList.contains("btn-seal")).toBe(true);
    expect(actions[0].dataset.emphasis).toBe("primary");
    for (const action of actions.slice(1)) {
      expect(action.classList.contains("btn-secondary")).toBe(true);
      expect(action.classList.contains("btn-seal")).toBe(false);
      expect(action.dataset.emphasis).toBe("secondary");
    }
  });

  it("counts duplicate chunk ids only once in the overview", async () => {
    await renderReady();
    expect(container.querySelector(".quiz-review-overview")?.textContent).toBe(
      "3 chủ đề cần ôn, chủ đề nắm yếu nhất đứng đầu. 3 đoạn tài liệu cần đọc lại.",
    );
  });

  it("omits the chunk sentence when no item has a chunk id", async () => {
    getReviewPlan.mockResolvedValue({ summary: "Các phần cần ôn", items: [item("1", []), item("2")] });
    await renderReady();
    expect(container.querySelector(".quiz-review-overview")?.textContent).toBe(
      "2 chủ đề cần ôn, chủ đề nắm yếu nhất đứng đầu.",
    );
  });

  it("does not render an overview when the plan has no items", async () => {
    getReviewPlan.mockResolvedValue({ summary: "Đã nắm vững", items: [] });
    await renderReady();
    expect(container.querySelector(".quiz-review-overview")).toBeNull();
  });
});
