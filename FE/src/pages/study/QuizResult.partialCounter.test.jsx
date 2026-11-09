// @vitest-environment jsdom
// Owner decision after PR #137: the result page counts "Đúng / Đúng một phần / Sai"
// separately. The backend counts a partial answer inside `incorrect_count`
// (BE/app/domains/attempts/grading.py totals), so showing `incorrect_count` as "Sai"
// next to "75% điểm" told a learner with 1 correct + 1 partial answer "Sai 1". The
// split comes from the per-question verdicts the result already carries; when those
// cannot be trusted, the page must not misclassify, so it falls back to a combined
// "Chưa đúng" counter instead of a wrong "Sai".
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
  MASTERY_LABEL: { review_needed: "Cần ôn lại" }, VERDICT_LABEL: { correct: "Đúng", incorrect: "Sai", partial: "Đúng một phần" },
  formatDuration: (value) => `${value} giây`, formatScore: (score, max) => score == null ? "—" : `${score} / ${max}`,
  masteryPercent: (score) => Math.round(Number(score || 0) * 100),
  optionLabel: (value) => value, moTaLoi: (error, fallback) => error?.message || fallback,
  getResult: (...args) => getResult(...args), getConceptMasteries: (...args) => getConceptMasteries(...args),
}));

let container, root;
afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  vi.clearAllMocks();
});

const SCORE = { correct: 1, partial: 0.5, incorrect: 0 };
const q = (verdict, i) => ({
  question_id: `q${i}`, question_type: "short_answer", question_text: `Câu hỏi ${i}`,
  user_answer: "x", correct_answer: "y", verdict, score: verdict ? SCORE[verdict] : null, feedback: null,
});
// Builds a result exactly the way the backend does (grading.py totals + results()).
function resultFor(verdicts, over = {}) {
  const graded = verdicts.filter((v) => v in SCORE);
  const score = graded.reduce((sum, v) => sum + SCORE[v], 0);
  const ungraded = verdicts.length - graded.length;
  return {
    status: "graded", quiz_title: "Quiz", duration_seconds: 60,
    score, max_score: graded.length,
    percentage: graded.length ? Math.round((score / graded.length) * 10000) / 100 : null,
    correct_count: graded.filter((v) => v === "correct").length,
    incorrect_count: graded.filter((v) => v === "incorrect" || v === "partial").length,
    total_questions: verdicts.length,
    grading_complete: ungraded === 0, ungraded_count: ungraded,
    questions: verdicts.map(q),
    ...over,
  };
}
async function render(result) {
  getResult.mockResolvedValue(result);
  getConceptMasteries.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<QuizResult />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
// Visible counters of the score board: { label: value }.
function counters() {
  const hero = container.querySelector(".quiz-score-hero");
  return Object.fromEntries([...hero.querySelectorAll("[data-score-stat]")].map((el) => [
    el.querySelector("[data-score-stat-label]").textContent, el.querySelector("[data-score-stat-value]").textContent,
  ]));
}
const sumOf = (c, labels) => labels.reduce((s, l) => s + Number(c[l] ?? 0), 0);

describe("QuizResult — Đúng / Đúng một phần / Sai are counted separately", () => {
  it("1. all correct: no partial counter, Sai 0", async () => {
    await render(resultFor(["correct", "correct", "correct"]));
    const c = counters();
    expect(c["Đúng"]).toBe("3");
    expect(c["Sai"]).toBe("0");
    expect(c).not.toHaveProperty("Đúng một phần");
    expect(container.textContent).toContain("100% điểm");
  });

  it("2. all incorrect (genuine 0%): Đúng 0, Sai 3, still a score", async () => {
    await render(resultFor(["incorrect", "incorrect", "incorrect"]));
    const c = counters();
    expect(c["Đúng"]).toBe("0");
    expect(c["Sai"]).toBe("3");
    expect(c).not.toHaveProperty("Đúng một phần");
    expect(container.textContent).toContain("0% điểm");
  });

  it("3. correct + partial = 75% điểm: Đúng 1, Đúng một phần 1, Sai 0 — the partial answer is not also counted as Sai", async () => {
    const r = resultFor(["correct", "partial"]);
    expect(r.incorrect_count).toBe(1);   // the backend's own count still includes the partial
    await render(r);
    const c = counters();
    expect(c["Đúng"]).toBe("1");
    expect(c["Đúng một phần"]).toBe("1");
    expect(c["Sai"]).toBe("0");
    expect(sumOf(c, ["Đúng", "Đúng một phần", "Sai"])).toBe(2);   // never double-counted
    expect(container.textContent).toContain("75% điểm");
    // Owner decision: with "Sai 0" on screen the review action must not call the partial
    // answer "câu sai"; it still opens it (same membership as before).
    const buttons = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toContain("Xem lại câu chưa đúng");
    expect(buttons.some((t) => t.includes("câu sai"))).toBe(false);
    await act(async () => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Xem lại câu chưa đúng").click(); });
    expect(container.querySelector('aside[aria-label="Câu cần xem lại"]')?.textContent).toContain("Câu 2");
  });

  it("4. partial + incorrect: Đúng 0, Đúng một phần 1, Sai 1", async () => {
    await render(resultFor(["partial", "incorrect"]));
    const c = counters();
    expect([c["Đúng"], c["Đúng một phần"], c["Sai"]]).toEqual(["0", "1", "1"]);
    expect(container.textContent).toContain("25% điểm");
  });

  it("5. all partial: Đúng một phần 2, Sai 0", async () => {
    await render(resultFor(["partial", "partial"]));
    const c = counters();
    expect([c["Đúng"], c["Đúng một phần"], c["Sai"]]).toEqual(["0", "2", "0"]);
    expect(container.textContent).toContain("50% điểm");
  });

  it("6. provisional: ungraded answers stay in 'Chưa chấm', counters add up to the question count", async () => {
    await render(resultFor(["correct", "partial", null]));
    const c = counters();
    expect([c["Đúng"], c["Đúng một phần"], c["Sai"], c["Chưa chấm"]]).toEqual(["1", "1", "0", "1"]);
    expect(sumOf(c, ["Đúng", "Đúng một phần", "Sai", "Chưa chấm"])).toBe(3);
    expect(container.textContent).toContain("75% điểm tạm tính trên 2 câu đã chấm");
  });

  it("7. all ungraded: no invented counts beyond zeros, 'Chưa chấm' carries every question", async () => {
    await render(resultFor([null, null]));
    const c = counters();
    expect([c["Đúng"], c["Sai"], c["Chưa chấm"]]).toEqual(["0", "0", "2"]);
    expect(c).not.toHaveProperty("Đúng một phần");
    expect(container.textContent).toContain("Chưa chấm được");
  });

  describe("8. verdict data missing or inconsistent: truthful combined fallback, never a wrong 'Sai'", () => {
    const expectFallback = (c, correct, notCorrect) => {
      expect(c["Đúng"]).toBe(String(correct));
      expect(c["Chưa đúng"]).toBe(String(notCorrect));
      expect(c).not.toHaveProperty("Sai");
      expect(c).not.toHaveProperty("Đúng một phần");
    };
    it("questions[] absent", async () => {
      const r = resultFor(["correct", "partial"]); delete r.questions;
      await render(r);
      expectFallback(counters(), 1, 1);
    });
    it("questions[] shorter than total_questions", async () => {
      await render(resultFor(["correct", "partial"], { total_questions: 3, questions: [q("correct", 0)] }));
      expectFallback(counters(), 1, 1);
    });
    it("verdict counts disagree with the backend totals", async () => {
      await render(resultFor(["correct", "partial"], { correct_count: 2, incorrect_count: 0 }));
      expectFallback(counters(), 2, 0);
    });
    it("an unknown verdict value", async () => {
      await render(resultFor(["correct", "partial"], { questions: [q("correct", 0), { ...q("partial", 1), verdict: "half" }] }));
      expectFallback(counters(), 1, 1);
    });
    it("review: a null verdict the backend does not report as ungraded (stale ungraded_count) cannot vanish", async () => {
      await render(resultFor(["correct", null], { ungraded_count: 0, grading_complete: true }));
      const c = counters();
      expectFallback(c, 1, 0);
      expect(c["Chưa chấm"]).toBe("1");   // the null-verdict question is still on screen
      expect(sumOf(c, ["Đúng", "Chưa đúng", "Chưa chấm"])).toBe(Number(c["Số câu"]));
    });
    it("review: ungraded_count larger than the null verdicts also falls back", async () => {
      await render(resultFor(["correct", "partial"], { ungraded_count: 1 }));
      expectFallback(counters(), 1, 1);
    });
    it("an unknown verdict value even when the remaining verdicts happen to match the totals (it must not just vanish)", async () => {
      await render(resultFor(["correct"], {
        total_questions: 2, questions: [q("correct", 0), { ...q("partial", 1), verdict: "half" }],
      }));
      expectFallback(counters(), 1, 0);
    });
  });

  it("invariant: in every scenario each question is in exactly one visible counter (sum = Số câu)", async () => {
    const SHOWN = ["Đúng", "Đúng một phần", "Sai", "Chưa đúng", "Chưa chấm"];
    const scenarios = [
      resultFor(["correct", "correct", "correct"]), resultFor(["incorrect", "incorrect"]),
      resultFor(["correct", "partial"]), resultFor(["partial", "incorrect"]), resultFor(["partial", "partial"]),
      resultFor(["correct", "partial", null]), resultFor([null, null]),
      (() => { const r = resultFor(["correct", "partial"]); delete r.questions; return r; })(),
      resultFor(["correct", "partial"], { total_questions: 3, questions: [q("correct", 0)] }),
      resultFor(["correct", "partial"], { correct_count: 2, incorrect_count: 0 }),
      resultFor(["correct", null], { ungraded_count: 0, grading_complete: true }),
      resultFor(["correct", "partial"], { ungraded_count: 1 }),
    ];
    for (const r of scenarios) {
      await render(r);
      const c = counters();
      expect(sumOf(c, SHOWN), JSON.stringify(c)).toBe(Number(c["Số câu"]));
      act(() => root.unmount()); root = null; document.body.removeChild(container); container = null;
    }
  });

  it("9. while grading, every counter reads '—'", async () => {
    await render(resultFor(["correct", "partial"], { status: "submitted" }));
    const c = counters();
    expect(c["Đúng"]).toBe("—");
    expect(c["Sai"]).toBe("—");
  });

  it("9b. while grading with verdicts still null, the labels stay 'Đúng' / 'Sai' (no flip to the fallback)", async () => {
    await render(resultFor([null, null], { status: "submitted", ungraded_count: 0 }));
    const c = counters();
    expect(c["Đúng"]).toBe("—");
    expect(c["Sai"]).toBe("—");
    expect(c).not.toHaveProperty("Chưa đúng");
  });

  it("10. each counter is a visible text label + number (no colour-only cue), in a wrapping row for small screens", async () => {
    await render(resultFor(["correct", "partial", "incorrect"]));
    const stats = [...container.querySelectorAll(".quiz-score-hero [data-score-stat]")];
    expect(stats.length).toBeGreaterThanOrEqual(5);   // Đúng, Đúng một phần, Sai, Số câu, Thời gian
    for (const s of stats) {
      expect(s.querySelector("[data-score-stat-label]").textContent.trim()).not.toBe("");
      expect(s.querySelector("[data-score-stat-value]").textContent.trim()).not.toBe("");
    }
    expect(stats[0].parentElement.className).toContain("flex-wrap");
  });
});
