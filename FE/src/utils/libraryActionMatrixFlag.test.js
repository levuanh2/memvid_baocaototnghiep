import { describe, expect, it } from "vitest";
import { isLibraryActionMatrixEnabled } from "./libraryActionMatrixFlag";

describe("Library Action Matrix rollout flag", () => {
  it("is deterministically OFF when unset or malformed", () => {
    expect(isLibraryActionMatrixEnabled({})).toBe(false);
    expect(isLibraryActionMatrixEnabled({ VITE_LIBRARY_ACTION_MATRIX: "1" })).toBe(false);
  });

  it("enables only for an explicit true value", () => {
    expect(isLibraryActionMatrixEnabled({ VITE_LIBRARY_ACTION_MATRIX: "true" })).toBe(true);
    expect(isLibraryActionMatrixEnabled({ VITE_LIBRARY_ACTION_MATRIX: "TRUE" })).toBe(true);
  });
});
