import { describe, expect, it } from "vitest";
import { DEFAULT_LIBRARY_STATE, libraryStateStorageKey, parseLibraryState, serializeLibraryState } from "./libraryActionMatrixState";

describe("Library Action Matrix return state", () => {
  it("round-trips task view, query, sort, collection, filters and scroll", () => {
    const state = {
      view: "needs_summary", query: "hệ điều hành", sort: "az",
      collectionId: "course-a", tags: ["Exam"], filterKeys: ["favorite"],
      includeArchived: true, scrollY: 731,
    };
    expect(parseLibraryState(serializeLibraryState(state))).toEqual(state);
  });

  it("fails closed to deterministic defaults for corrupt or unsupported state", () => {
    expect(parseLibraryState("not-json")).toEqual(DEFAULT_LIBRARY_STATE);
    expect(parseLibraryState(JSON.stringify({ view: "invented", scrollY: -9 })))
      .toEqual(DEFAULT_LIBRARY_STATE);
  });

  it("scopes restoration by authenticated account and refuses an anonymous global key", () => {
    expect(libraryStateStorageKey("user-a")).not.toBe(libraryStateStorageKey("user-b"));
    expect(libraryStateStorageKey(null)).toBeNull();
  });

  it("never serializes selection or destructive targets", () => {
    const parsed = JSON.parse(serializeLibraryState({
      ...DEFAULT_LIBRARY_STATE,
      selectedIds: ["doc-1"],
      deleteTarget: "course-a",
    }));
    expect(parsed).not.toHaveProperty("selectedIds");
    expect(parsed).not.toHaveProperty("deleteTarget");
  });
});
