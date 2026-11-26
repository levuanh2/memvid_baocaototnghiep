// @vitest-environment jsdom
// V9.3 P3b (docs/StudyMap-V9.3/01: "Trang tổng quan đưa người học về việc tiếp theo; thư
// viện là nơi tổ chức"): the Library no longer carries the resume block, the practice
// numbers, weak concepts or recent attempts — those moved to /app/study/dashboard — so it
// stops fetching /api/progress/* and links to the dashboard instead.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudyContextProvider } from "../../study/StudyContextProvider";
import {
  getLibrary, getProgressAttempts, getProgressConcepts, getProgressOverview,
} from "../../utils/studyApi";
import DocumentList from "./DocumentList";

vi.mock("../../auth/useAuth", () => ({ useAuth: () => ({ user: { id: "user-a" } }) }));
vi.mock("../../utils/studyApi", async (original) => ({
  ...(await original()),
  getLibrary: vi.fn(), getProgressOverview: vi.fn(), getProgressConcepts: vi.fn(),
  getProgressAttempts: vi.fn(), markOpened: vi.fn(() => Promise.resolve()),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host;
const flush = async () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });

const DOC = { document_id: "d1", source_stem: "a", title: "A.pdf", display_name: "Tài liệu A", status: "completed",
  ingest_status: "index_ready", last_opened_at: new Date().toISOString(), last_workspace: "quiz",
  ai: { index: "ready", summary: { state: "ready" }, quiz: { ready: true }, review: { ready: false } } };

beforeEach(async () => {
  vi.clearAllMocks();
  sessionStorage.clear();
  getLibrary.mockResolvedValue({ documents: [DOC], collections: [] });
  getProgressOverview.mockResolvedValue({ document_count: 1, quiz_count: 1, attempt_count: 2, average_percentage: 75 });
  getProgressConcepts.mockResolvedValue([{ concept_name: "Cung cầu", status: "review_needed", mastery_score: 0.4 }]);
  getProgressAttempts.mockResolvedValue([{ attempt_id: "a1", quiz_id: "q1", quiz_title: "Quiz", status: "graded" }]);
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.scrollTo = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><StudyContextProvider><DocumentList /></StudyContextProvider></MemoryRouter>));
  await flush();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Library after the V9.3 dashboard split", () => {
  it("does not fetch or show the dashboard's blocks", () => {
    expect(getProgressOverview).not.toHaveBeenCalled();
    expect(getProgressConcepts).not.toHaveBeenCalled();
    expect(getProgressAttempts).not.toHaveBeenCalled();
    expect(host.querySelector(".learning-home")).toBeNull();
    expect(host.textContent).not.toMatch(/Đang yếu ở|Bài đã làm gần đây|Xem mức nắm từng khái niệm/);
    expect(host.textContent).not.toContain("75% điểm");
  });

  it("links to the dashboard", () => {
    const link = host.querySelector("a[href='/app/study/dashboard']");
    expect(link).not.toBeNull();
    expect(link.textContent).toMatch(/Tổng quan/);
  });

  // Until the five-item navigation reaches the dashboard, the Library keeps ONE compact way
  // back into the document in progress, so continuing costs no extra step.
  it("keeps one compact 'Tiếp tục' for the document in progress, as the page's filled action", () => {
    const resume = host.querySelector(".library-resume");
    expect(resume.textContent).toContain("Tài liệu A");
    expect(resume.querySelectorAll(".btn-seal")).toHaveLength(1);
    expect(host.querySelectorAll(".btn-seal")).toHaveLength(1);
    const upload = [...host.querySelectorAll("button")].find((b) => /Tải tài liệu lên/.test(b.textContent));
    expect(upload.getAttribute("data-emphasis")).toBe("secondary");
  });
});

describe("Library with nothing to continue", () => {
  it("makes upload the filled action and shows no resume line", async () => {
    act(() => root.unmount());
    getLibrary.mockResolvedValue({ documents: [{ ...DOC, last_opened_at: null }], collections: [] });
    root = createRoot(host);
    await act(async () => root.render(<MemoryRouter><StudyContextProvider><DocumentList /></StudyContextProvider></MemoryRouter>));
    await flush();
    expect(host.querySelector(".library-resume")).toBeNull();
    const upload = [...host.querySelectorAll("button")].find((b) => /Tải tài liệu lên/.test(b.textContent));
    expect(upload.getAttribute("data-emphasis")).toBe("primary");
  });
});
