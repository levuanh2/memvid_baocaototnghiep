import { describe, it, expect } from "vitest";
import { normalizeSourceStems } from "./evidence";

// M2.5 (Provenance Adoption) — direct unit tests for the shared helper both
// mindmapNormalize.js and summaryJob.js normalize BE's `source_stems`
// through. See mindmapNormalize.test.js's "v2: source_stems" block for the
// same behavior exercised end-to-end through a full node.
describe("normalizeSourceStems", () => {
  it("passes through a clean single-element array", () => {
    expect(normalizeSourceStems(["paper-a"])).toEqual(["paper-a"]);
  });

  it("preserves BE's own ordering — never re-sorts", () => {
    expect(normalizeSourceStems(["paper-c", "paper-a", "paper-b"])).toEqual(["paper-c", "paper-a", "paper-b"]);
  });

  it("non-array input returns undefined, never []", () => {
    expect(normalizeSourceStems("paper-a")).toBeUndefined();
    expect(normalizeSourceStems(null)).toBeUndefined();
    expect(normalizeSourceStems(undefined)).toBeUndefined();
    expect(normalizeSourceStems({ 0: "paper-a" })).toBeUndefined();
  });

  it("an empty array (BE contract says this should never happen) still returns undefined, not []", () => {
    expect(normalizeSourceStems([])).toBeUndefined();
  });

  it("drops non-string entries and blank/whitespace-only strings", () => {
    expect(normalizeSourceStems([null, undefined, 42, true, {}, []])).toBeUndefined();
    expect(normalizeSourceStems(["", "   "])).toBeUndefined();
    expect(normalizeSourceStems(["paper-a", "  ", 5])).toEqual(["paper-a"]);
  });

  it("trims surrounding whitespace on otherwise-valid entries", () => {
    expect(normalizeSourceStems(["  paper-a  "])).toEqual(["paper-a"]);
  });

  it("dedupes exact-string duplicates, keeping first-occurrence position", () => {
    expect(normalizeSourceStems(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });
});
