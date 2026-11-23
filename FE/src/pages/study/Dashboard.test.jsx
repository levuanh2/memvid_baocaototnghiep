// @vitest-environment jsdom
// V9.3 P3b (owner brief; docs/StudyMap-V9.3/01, 05, 12): the dashboard says what to do next
// from real data only. Library + /api/progress/{overview,concepts,attempts}; no reading time,
// no mastery percentage, no weekly chart; zero, missing and loading are different states;
// every link goes to a real route.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudyContextProvider } from "../../study/StudyContextProvider";
import {
  getLibrary, getProgressAttempts, getProgressConcepts, getProgressOverview,
} from "../../utils/studyApi";
import Dashboard from "./Dashboard";

let currentUser = { id: "u1", display_name: "Lan" };
vi.mock("../../auth/useAuth", () => ({ useAuth: () => ({ user: currentUser }) }));
vi.mock("../../utils/studyApi", async (original) => ({
  ...(await original()),
  getLibrary: vi.fn(), getProgressOverview: vi.fn(), getProgressConcepts: vi.fn(),
  getProgressAttempts: vi.fn(), markOpened: vi.fn(() => Promise.resolve()),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host;

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const READY = { index: "ready", summary: { state: "ready" }, mindmap: { state: "ready" },
  studymap: { state: "not_generated" }, quiz: { ready: true, count: 2 }, review: { ready: false } };
const RESUME = { document_id: "d1", source_stem: "a", title: "Kinh tế vi mô.pdf", display_name: "Kinh tế vi mô",
  status: "completed", ingest_status: "index_ready", last_opened_at: hoursAgo(2), last_workspace: "quiz", ai: READY };
const OTHER = { ...RESUME, document_id: "d2", source_stem: "b", display_name: "Hệ điều hành", last_opened_at: hoursAgo(30) };
const OVERVIEW = { document_count: 2, quiz_count: 2, attempt_count: 3, average_percentage: 72.5,
  mastered_concept_count: 2, weak_concept_count: 1, completion_rate: 0.67 };
const WEAK = [{ concept_name: "Độ co giãn của cầu", status: "review_needed", mastery_score: 0.41, attempt_count: 2 }];
const ATTEMPTS = [
  { attempt_id: "a1", quiz_id: "q1", quiz_title: "Quiz chương 3", status: "graded", score: 3, max_score: 4, submitted_at: hoursAgo(5), quiz_type: "practice" },
  { attempt_id: "a2", quiz_id: "q2", quiz_title: "Quiz đang làm", status: "in_progress", submitted_at: null, quiz_type: "diagnostic" },
];

const flush = async () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><StudyContextProvider><Dashboard /></StudyContextProvider></MemoryRouter>));
  await flush();
}
const text = () => host.textContent;
const section = (name) => [...host.querySelectorAll("section")].find((s) => s.getAttribute("aria-label") === name
  || s.querySelector("h2")?.textContent === name);
const button = (name) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === name);

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = { id: "u1", display_name: "Lan" };
  getLibrary.mockResolvedValue({ documents: [RESUME, OTHER], collections: [] });
  getProgressOverview.mockResolvedValue(OVERVIEW);
  getProgressConcepts.mockResolvedValue(WEAK);
  getProgressAttempts.mockResolvedValue(ATTEMPTS);
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Dashboard V9.3", () => {
  it("greets the learner and puts the resume document first, with one filled action", async () => {
    await render();
    expect(host.querySelector("h1").textContent).toBe("Tổng quan");
    expect(text()).toContain("Lan");
    expect(host.querySelector(".learning-home__title").textContent).toBe("Kinh tế vi mô");
    expect(host.querySelectorAll(".btn-seal")).toHaveLength(1);
  });

  it("shows practice indicators with what each one counts", async () => {
    await render();
    const s = section("Kết quả luyện tập");
    expect(s.textContent).toContain("3");
    expect(s.textContent).toContain("72.5% điểm");
    expect(s.textContent).toMatch(/đã chấm xong/);
    expect(s.textContent).toMatch(/2.*đã nắm/);
    expect(s.textContent).toMatch(/1.*cần củng cố/);
  });

  it("invents no reading time, no mastery percentage and no weekly history", async () => {
    await render();
    expect(text()).not.toMatch(/phút|giờ đọc|thời lượng/i);
    expect(text()).not.toMatch(/tuần/i);
    expect(section("Cần củng cố").textContent).not.toMatch(/%/);
    expect(section("Cần củng cố").textContent).toContain("Cần ôn lại");
  });

  it("names the recent attempts as the latest few, linking each to its real page", async () => {
    await render();
    const s = section("Bài làm gần nhất");
    const hrefs = [...s.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/app/study/result/a1", "/app/study/quiz/q2"]);
  });

  it("tells zero apart from missing data", async () => {
    getProgressOverview.mockResolvedValue({ ...OVERVIEW, attempt_count: 0, average_percentage: null,
      mastered_concept_count: 0, weak_concept_count: 0 });
    getProgressConcepts.mockResolvedValue([]);
    getProgressAttempts.mockResolvedValue([]);
    await render();
    expect(section("Kết quả luyện tập").textContent).toMatch(/Chưa làm bài nào/);
    expect(section("Bài làm gần nhất")).toBeUndefined();
  });

  it("says when a graded average does not exist yet", async () => {
    getProgressOverview.mockResolvedValue({ ...OVERVIEW, average_percentage: null });
    await render();
    expect(section("Kết quả luyện tập").textContent).toMatch(/Chưa có bài chấm xong/);
  });

  it("keeps the library part when the progress data fails, and retries only that part", async () => {
    getProgressOverview.mockRejectedValueOnce(new Error("500"));
    await render();
    expect(host.querySelector(".learning-home")).not.toBeNull();
    const s = section("Kết quả luyện tập");
    expect(s.textContent).toMatch(/Chưa tải được/);
    expect(getLibrary).toHaveBeenCalledTimes(1);
    await act(async () => { [...s.querySelectorAll("button")].find((b) => b.textContent === "Thử lại").click(); });
    await flush();
    expect(getLibrary).toHaveBeenCalledTimes(1);
    expect(section("Kết quả luyện tập").textContent).toContain("72.5% điểm");
  });

  it("ignores a late response that belongs to the previous account", async () => {
    let lateOverview;
    getProgressOverview.mockImplementationOnce(() => new Promise((r) => { lateOverview = r; }));
    await render();
    currentUser = { id: "u2", display_name: "Minh" };
    getProgressOverview.mockResolvedValueOnce({ ...OVERVIEW, attempt_count: 9 });
    await act(async () => root.render(<MemoryRouter><StudyContextProvider><Dashboard /></StudyContextProvider></MemoryRouter>));
    await flush();
    await act(async () => { lateOverview({ ...OVERVIEW, attempt_count: 1 }); });
    await flush();
    const so = [...section("Kết quả luyện tập").querySelectorAll("dd")].map((d) => d.textContent);
    expect(so).toContain("9");
    expect(so).not.toContain("1");
  });

  it("sends an empty library to the Library to upload, with no resume block", async () => {
    getLibrary.mockResolvedValue({ documents: [], collections: [] });
    await render();
    expect(host.querySelector(".learning-home")).toBeNull();
    const link = [...host.querySelectorAll("a")].find((a) => /Tải tài liệu lên/.test(a.textContent));
    expect(link.getAttribute("href")).toBe("/app/study");
  });

  it("shows the page error with a retry when the library cannot load", async () => {
    getLibrary.mockRejectedValueOnce(new Error("500"));
    await render();
    expect(host.querySelector(".learning-home")).toBeNull();
    await act(async () => { button("Thử lại").click(); });
    await flush();
    expect(host.querySelector(".learning-home")).not.toBeNull();
  });

  it("links only to real routes", async () => {
    await render();
    const real = [/^\/app$/, /^\/app\/study$/, /^\/app\/study\/progress$/, /^\/app\/study\/quiz\/new$/,
      /^\/app\/study\/quiz\/[\w-]+$/, /^\/app\/study\/result\/[\w-]+$/];
    for (const a of host.querySelectorAll("a[href]:not([href^='#'])")) {
      expect(real.some((r) => r.test(a.getAttribute("href"))), a.getAttribute("href")).toBe(true);
    }
  });

  // Screenshot review: the resume block repeated the quiz average shown in "Kết quả luyện tập".
  it("shows the quiz average once", async () => {
    await render();
    expect(text().split("72.5%").length - 1).toBe(1);
  });

  // Screenshot review: missing concept counts rendered as "0 đã nắm, 0 cần củng cố".
  it("leaves out the concept line when the API does not report concepts", async () => {
    const { mastered_concept_count: _m, weak_concept_count: _w, ...withoutConcepts } = OVERVIEW;
    getProgressOverview.mockResolvedValue(withoutConcepts);
    await render();
    expect(section("Kết quả luyện tập").textContent).not.toMatch(/đã nắm/);
  });
});
