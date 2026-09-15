import { describe, it, expect } from "vitest";
import { citeKey } from "./evidence";

// Feature Pack B (Cross Navigation) — `citeKey` already existed (used
// internally by `processCitations`) but had no direct test and no other
// caller; ChatArea's citation click and SidebarRight's evidence-frame click
// both now call it for the SAME `selectEvidence` contract instead of each
// hand-rolling their own `${normStem(stem)}::${chunkId}` formula. Locking
// the contract down directly, since two real callers now depend on it
// producing the identical string for the identical citation.
describe("citeKey", () => {
  it("builds stem::chunkId, normalizing the stem", () => {
    expect(citeKey("Bai_1", 3)).toBe("bai_1::3");
  });

  it("two different casings/timestamps of the same source normalize to the same key", () => {
    expect(citeKey("Bai_1_20260101_120000", 3)).toBe(citeKey("bai_1", 3));
  });

  it("missing chunkId becomes an empty segment, never \"undefined\"/\"null\" text", () => {
    expect(citeKey("bai_1", undefined)).toBe("bai_1::");
    expect(citeKey("bai_1", null)).toBe("bai_1::");
  });

  it("missing stem still produces a usable key, never throws", () => {
    expect(citeKey(undefined, 3)).toBe("::3");
    expect(citeKey(null, 3)).toBe("::3");
  });
});
