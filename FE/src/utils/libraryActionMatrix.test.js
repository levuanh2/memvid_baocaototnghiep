import { describe, expect, it } from "vitest";
import {
  ARTIFACT_STATE,
  TASK_VIEW,
  deriveLearningState,
  projectLibrary,
  primaryActionFor,
  pruneSelection,
  effectiveBulkRequest,
  resolveRovingDocumentId,
  moveRovingDocumentId,
} from "./libraryActionMatrix";

const doc = (index, overrides = {}) => ({
  document_id: `doc-${index}`,
  title: `Tài liệu ${String(index).padStart(2, "0")}`,
  collection_id: index % 2 ? "course-a" : "course-b",
  tags: [],
  created_at: `2026-01-${String(Math.min(index, 28)).padStart(2, "0")}T00:00:00Z`,
  last_opened_at: index === 2 ? "2026-10-01T00:00:00Z" : null,
  last_workspace: index === 2 ? "review" : null,
  favorite: false,
  pinned: false,
  archived_at: null,
  ai: {
    index: "ready",
    summary: { state: index % 7 === 1 ? "ready" : "not_generated" },
    quiz: { ready: index % 6 === 1, latest_quiz_id: index % 6 === 1 ? `quiz-${index}` : null },
    review: { latest_attempt_id: index === 2 ? "attempt-2" : null },
  },
  ...overrides,
});

const fixture42 = Array.from({ length: 42 }, (_, i) => doc(i + 1));

describe("Library Action Matrix model", () => {
  it("maps production summary/quiz payloads to explicit ready, missing and unknown states", () => {
    expect(deriveLearningState(doc(1))).toMatchObject({
      summaryState: ARTIFACT_STATE.READY,
      quizState: ARTIFACT_STATE.READY,
    });
    expect(deriveLearningState(doc(2))).toMatchObject({
      summaryState: ARTIFACT_STATE.MISSING,
      quizState: ARTIFACT_STATE.MISSING,
      continuing: true,
    });
    expect(deriveLearningState(doc(3, { ai: { index: "processing" } }))).toMatchObject({
      summaryState: ARTIFACT_STATE.UNKNOWN,
      quizState: ARTIFACT_STATE.UNKNOWN,
    });
  });

  it.each([
    ["summary processing", { ai: { index: "ready", summary: { state: "processing" }, quiz: { ready: false } } }, "unknown", "missing"],
    ["summary error", { ai: { index: "ready", summary: { state: "error" }, quiz: { ready: false } } }, "unknown", "missing"],
    ["unspecified AI", { ai: { index: "ready" } }, "unknown", "unknown"],
    ["index processing", { ai: { index: "processing", summary: { state: "not_generated" }, quiz: { ready: false } } }, "unknown", "unknown"],
    ["quiz addressable", { ai: { index: "ready", summary: { state: "not_generated" }, quiz: { ready: true, latest_quiz_id: "quiz-1" } } }, "missing", "ready"],
    ["quiz flag without destination", { ai: { index: "ready", summary: { state: "not_generated" }, quiz: { ready: true, latest_quiz_id: null } } }, "missing", "unknown"],
  ])("keeps explicit vocabulary for %s", (_name, overrides, expectedSummary, expectedQuiz) => {
    const state = deriveLearningState(doc(4, overrides));
    expect(state.summaryState).toBe(expectedSummary);
    expect(state.quizState).toBe(expectedQuiz);
  });

  it("projects exactly one stable row per UUID and keeps four task counts equal to membership", () => {
    const all = projectLibrary(fixture42, { view: TASK_VIEW.ALL, sort: "az" });
    expect(all.rows).toHaveLength(42);
    expect(new Set(all.rows.map((item) => item.document_id)).size).toBe(42);
    expect(all.counts).toEqual({ all: 42, continue: 1, needs_quiz: 35, needs_summary: 36 });

    const summaries = projectLibrary(fixture42, { view: TASK_VIEW.NEEDS_SUMMARY, sort: "az" });
    expect(summaries.rows).toHaveLength(36);
    expect(summaries.rows.map((item) => item.document_id)).not.toContain("doc-1");
    expect(summaries.rows.map((item) => item.document_id)).toContain("doc-2");

    const quizzes = projectLibrary(fixture42, { view: TASK_VIEW.NEEDS_QUIZ, sort: "az" });
    expect(quizzes.rows).toHaveLength(35);
    expect(quizzes.rows.map((item) => item.document_id)).not.toContain("doc-1");
    expect(quizzes.rows.map((item) => item.document_id)).toContain("doc-2");

    const summaryIds = Array.from({ length: 42 }, (_, index) => `doc-${index + 1}`)
      .filter((id) => !["doc-1", "doc-8", "doc-15", "doc-22", "doc-29", "doc-36"].includes(id));
    const quizIds = Array.from({ length: 42 }, (_, index) => `doc-${index + 1}`)
      .filter((id) => !["doc-1", "doc-7", "doc-13", "doc-19", "doc-25", "doc-31", "doc-37"].includes(id));
    expect(summaries.rows.map((item) => item.document_id)).toEqual(summaryIds);
    expect(quizzes.rows.map((item) => item.document_id)).toEqual(quizIds);
  });

  it("composes search, collection, task predicate and stable sort deterministically", () => {
    const docs = fixture42.map((item) => ({ ...item, title: `sample-doc ${item.title}` }));
    const result = projectLibrary(docs, {
      query: "sample-doc",
      collectionId: "course-a",
      view: TASK_VIEW.NEEDS_SUMMARY,
      sort: "az",
    });
    expect(result.rows.every((item) => item.collection_id === "course-a")).toBe(true);
    expect(result.rows.every((item) => item.summaryState === ARTIFACT_STATE.MISSING)).toBe(true);
    expect(result.counts.needs_summary).toBe(result.rows.length);
  });

  it("matches the approved compound projection exactly as [doc-9, doc-2]", () => {
    const candidates = [
      doc(2, { title: "sample-doc Zeta", pinned: true, collection_id: "course-a" }),
      doc(9, { title: "sample-doc Alpha", pinned: true, collection_id: "course-a" }),
      doc(5, { title: "sample-doc Hidden", pinned: false, collection_id: "course-a" }),
      doc(7, { title: "other", pinned: true, collection_id: "course-a" }),
    ];
    const result = projectLibrary(candidates, {
      query: "sample-doc", collectionId: "course-a", filterKeys: ["pinned"],
      view: TASK_VIEW.NEEDS_SUMMARY, sort: "az",
    });
    expect(result.rows.map((item) => item.document_id)).toEqual(["doc-9", "doc-2"]);
  });

  it("preserves pinned then favorite precedence and UUID tie stability", () => {
    const timestamp = "2026-01-01T00:00:00Z";
    const result = projectLibrary([
      doc(4, { created_at: timestamp }),
      doc(3, { created_at: timestamp, favorite: true }),
      doc(2, { created_at: timestamp, pinned: true }),
      doc(1, { created_at: timestamp, pinned: true }),
    ], { sort: "newest" });
    expect(result.rows.map((item) => item.document_id)).toEqual(["doc-1", "doc-2", "doc-3", "doc-4"]);
  });

  it("does not mutate the input and returns count-parity zero states", () => {
    const input = fixture42.map((item) => ({ ...item, ai: structuredClone(item.ai) }));
    const before = structuredClone(input);
    const result = projectLibrary(input, { query: "does-not-exist", view: TASK_VIEW.NEEDS_QUIZ });
    expect(result.rows).toEqual([]);
    expect(result.counts).toEqual({ all: 0, continue: 0, needs_quiz: 0, needs_summary: 0 });
    expect(input).toEqual(before);
  });

  it.each([
    ["search", { query: "Tài liệu 02" }],
    ["collection", { collectionId: "course-a" }],
    ["tags", { tags: ["Exam"] }],
    ["task", { view: TASK_VIEW.NEEDS_SUMMARY }],
    ["archive", { includeArchived: false }],
  ])("constructs bulk requests only from immediate visible membership after %s changes", (_name, options) => {
    const source = fixture42.map((item, index) => ({
      ...item,
      tags: index % 2 ? ["Exam"] : [],
      archived_at: index === 1 ? "2026-01-01T00:00:00Z" : null,
    }));
    const projection = projectLibrary(source, options);
    const selected = new Set(source.map((item) => item.document_id));
    const request = effectiveBulkRequest("pin", selected, projection.rows);
    expect(request?.document_ids || []).toEqual(projection.rows.map((item) => item.document_id));
    expect(projection.counts[options.view || TASK_VIEW.ALL]).toBe(projection.rows.length);
  });

  it("resolves the primary action from both task intent and actual document state", () => {
    expect(primaryActionFor(TASK_VIEW.NEEDS_SUMMARY, deriveLearningState(doc(2))))
      .toMatchObject({ label: "Tạo tóm tắt", surface: "summary" });
    expect(primaryActionFor(TASK_VIEW.NEEDS_QUIZ, deriveLearningState(doc(2))))
      .toMatchObject({ label: "Tạo quiz", surface: "quiz" });
    expect(primaryActionFor(TASK_VIEW.NEEDS_SUMMARY, deriveLearningState(doc(1)))).toBeNull();
    expect(primaryActionFor(TASK_VIEW.ALL, deriveLearningState(doc(2))))
      .toMatchObject({ label: "Tiếp tục · Hướng dẫn ôn tập", surface: "review" });
  });

  it("synchronously removes hidden UUIDs before a bulk action can consume selection", () => {
    const visible = projectLibrary(fixture42, { view: TASK_VIEW.NEEDS_SUMMARY }).rows;
    expect([...pruneSelection(new Set(["doc-1", "doc-2"]), visible)]).toEqual(["doc-2"]);
  });

  it("keeps roving focus on the same UUID through reorder, then falls back or clears", () => {
    const original = [doc(1), doc(2), doc(3)];
    expect(resolveRovingDocumentId(original, "doc-2")).toBe("doc-2");
    expect(resolveRovingDocumentId([doc(3), doc(2), doc(1)], "doc-2")).toBe("doc-2");
    expect(resolveRovingDocumentId([doc(3), doc(1)], "doc-2")).toBe("doc-3");
    expect(resolveRovingDocumentId([], "doc-2")).toBeNull();
    expect(moveRovingDocumentId(original, "doc-2", "ArrowDown")).toBe("doc-3");
    expect(moveRovingDocumentId(original, "doc-2", "Home")).toBe("doc-1");
  });
});
