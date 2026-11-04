// @vitest-environment jsdom
// Owner decision A3 (R2-121): weak-topic count for "Kế hoạch ôn tập (N chủ
// đề)" must count ONLY mastery statuses light_review/review_needed/
// critical_gap -- the exact same WEAK_STATUSES BE/app/domains/
// gap_analysis/service.py already uses. Excludes mastered AND any other
// status (pending/ungraded/unknown/missing) by construction (allow-list,
// not a "not mastered" denylist). Dedups by the normalized (trimmed,
// lower-cased) concept name FIRST, falling back to `concept_mastery_id`
// only when a row has no name; a row with neither is not counted at all.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import QuizResult from "./QuizResult";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-router-dom", () => ({ Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>, useParams: () => ({ attemptId: "attempt-1" }) }));
vi.mock("../../components/study/StudyShell", () => ({ default: ({ loading, children, actions }) => <div>{actions}{loading ? "loading" : children}</div> }));
const getResult = vi.fn();
const getConceptMasteries = vi.fn();
vi.mock("../../utils/studyApi", () => ({
  MASTERY_LABEL: { mastered: "Đã nắm tốt", light_review: "Cần ôn nhẹ", review_needed: "Cần ôn lại", critical_gap: "Hổng nghiêm trọng" },
  VERDICT_LABEL: { correct: "Đúng", incorrect: "Sai", partial: "Đúng một phần" },
  formatDuration: (value) => `${value} giây`, formatScore: (score, max) => score == null ? "—" : `${score} / ${max}`,
  masteryPercent: (score) => Math.round(Number(score || 0) * 100),
  optionLabel: (value) => value, moTaLoi: (error, fallback) => error?.message || fallback,
  getResult: (...args) => getResult(...args), getConceptMasteries: (...args) => getConceptMasteries(...args),
}));

const question = (i, verdict) => ({
  question_id: `q-${i}`, question_type: "multiple_choice", question_text: `Câu hỏi ${i}`,
  options: ["A", "B"], user_answer: verdict === "correct" ? "A" : "B", correct_answer: "A", verdict,
});
const RESULT_WITH_WRONG = {
  status: "graded", quiz_title: "Quiz", score: 8, max_score: 10, percentage: 80,
  correct_count: 8, incorrect_count: 2, total_questions: 10, duration_seconds: 60,
  questions: [question(1, "incorrect"), question(2, "incorrect"), ...Array.from({ length: 8 }, (_, i) => question(i + 3, "correct"))],
};
const mastery = (over) => ({ concept_mastery_id: over.id ?? "m1", concept_name: "Concept", status: "review_needed", mastery_score: 0.4, correct_count: 1, total_count: 2, ...over });

let container, root;
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); container = null; root = null; vi.clearAllMocks(); });
async function renderWith(masteries) {
  getResult.mockResolvedValue(RESULT_WITH_WRONG);
  getConceptMasteries.mockResolvedValue(masteries);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(<QuizResult />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}
const primaryLink = () => container.querySelector('a[href="/app/study/review/attempt-1"]');

describe("QuizResult weak-topic count (owner decision A3)", () => {
  it.each(["light_review", "review_needed", "critical_gap"])("counts a '%s' status as weak", async (status) => {
    await renderWith([mastery({ id: "m1", status })]);
    expect(primaryLink()?.textContent).toContain("Kế hoạch ôn tập (1 chủ đề)");
  });

  it("excludes 'mastered'", async () => {
    await renderWith([mastery({ id: "m1", status: "mastered" }), mastery({ id: "m2", status: "review_needed" })]);
    expect(primaryLink()?.textContent).toContain("Kế hoạch ôn tập (1 chủ đề)");
  });

  it("excludes pending/ungraded/unknown/missing statuses", async () => {
    await renderWith([
      mastery({ id: "m1", status: "pending" }),
      mastery({ id: "m2", status: "ungraded" }),
      mastery({ id: "m3", status: "some_unexpected_future_status" }),
      mastery({ id: "m4", status: null }),
      mastery({ id: "m5", status: undefined }),
      mastery({ id: "m6", status: "review_needed" }), // the one real weak row among the noise
    ]);
    expect(primaryLink()?.textContent).toContain("Kế hoạch ôn tập (1 chủ đề)");
  });

  it("empty concept-masteries data -> plain label, no number", async () => {
    await renderWith([]);
    expect(primaryLink()?.textContent).toContain("Kế hoạch ôn tập");
    expect(primaryLink()?.textContent).not.toMatch(/\(\d+ chủ đề\)/);
  });

  it("deduplicates by concept_mastery_id (same id counted once)", async () => {
    await renderWith([
      mastery({ id: "m1", concept_name: "Concept A", status: "review_needed" }),
      mastery({ id: "m1", concept_name: "Concept A", status: "review_needed" }), // exact duplicate row
    ]);
    expect(primaryLink()?.textContent).toContain("Kế hoạch ôn tập (1 chủ đề)");
  });

  it("deduplicates by normalized concept name when concept_mastery_id is missing", async () => {
    await renderWith([
      mastery({ id: undefined, concept_name: "  Điều Phối Tiến Trình  ", status: "critical_gap" }),
      mastery({ id: undefined, concept_name: "điều phối tiến trình", status: "review_needed" }), // same concept, different case/whitespace, no id
      mastery({ id: "m3", concept_name: "Phân trang", status: "light_review" }), // genuinely different concept
    ]);
    expect(primaryLink()?.textContent).toContain("Kế hoạch ôn tập (2 chủ đề)");
  });

  it("same concept, different case, different ids -- name wins over id, counted once", async () => {
    await renderWith([
      mastery({ id: "m1", concept_name: "Điều Phối Tiến Trình", status: "review_needed" }),
      mastery({ id: "m2", concept_name: "điều phối tiến trình", status: "critical_gap" }), // different id, same concept by name
    ]);
    expect(primaryLink()?.textContent).toContain("Kế hoạch ôn tập (1 chủ đề)");
  });

  it("row with neither concept_name nor concept_mastery_id is not counted", async () => {
    await renderWith([
      mastery({ concept_mastery_id: null, concept_name: "", status: "review_needed" }),
      mastery({ id: "m2", concept_name: "Phân trang", status: "light_review" }), // the one real, identifiable weak row
    ]);
    expect(primaryLink()?.textContent).toContain("Kế hoạch ôn tập (1 chủ đề)");
  });

  it("all correct (no wrong answers): the count is never shown at all (primary goes to Library instead)", async () => {
    getResult.mockResolvedValue({
      status: "graded", quiz_title: "Quiz", score: 10, max_score: 10, percentage: 100,
      correct_count: 10, incorrect_count: 0, total_questions: 10, duration_seconds: 60,
      questions: Array.from({ length: 10 }, (_, i) => question(i + 1, "correct")),
    });
    getConceptMasteries.mockResolvedValue([mastery({ id: "m1", status: "review_needed" })]);
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(<QuizResult />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('a[href="/app/study"]')?.textContent).toContain("Về Thư viện");
    expect(primaryLink()).toBeNull();
  });
});
