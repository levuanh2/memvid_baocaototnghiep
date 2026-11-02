import { describe, expect, it } from "vitest";
import { attemptScoreLabel } from "./studyApi";

// R85 P2 review: the Library history must call an attempt "tạm thời" ONLY when it
// was graded but AI grading left answers ungraded — never for in-progress or
// submitted (pending) attempts, which have their own normal text.
describe("attemptScoreLabel", () => {
  it("shows the plain score for a fully graded attempt", () => {
    expect(attemptScoreLabel({ status: "graded", score: 3, max_score: 4, ungraded_count: 0, grading_complete: true })).toBe("3 / 4");
  });

  it("marks a graded attempt with ungraded answers as provisional", () => {
    expect(attemptScoreLabel({ status: "graded", score: 1, max_score: 1, ungraded_count: 1, grading_complete: false })).toBe("tạm thời · 1 / 1");
  });

  it("says 'chưa chấm được' instead of 0 when nothing could be graded", () => {
    expect(attemptScoreLabel({ status: "graded", score: 0, max_score: 0, ungraded_count: 2, grading_complete: false })).toBe("chưa chấm được");
  });

  it("never labels an in-progress or submitted attempt as provisional", () => {
    expect(attemptScoreLabel({ status: "in_progress", score: null, max_score: null, ungraded_count: 0, grading_complete: false })).toBe("—");
    expect(attemptScoreLabel({ status: "submitted", score: null, max_score: null, grading_complete: false })).toBe("—");
  });

  it("treats rows from before the field existed as complete", () => {
    expect(attemptScoreLabel({ status: "graded", score: 2, max_score: 2 })).toBe("2 / 2");
  });
});
