import { describe, it, expect } from "vitest";
import { computeReadyCount } from "./workspaceReadiness";

describe("computeReadyCount", () => {
  it("counts only selected sources that are also ready", () => {
    const sources = [
      { video_stem: "a", can_query: true },
      { video_stem: "b", can_query: false },
      { video_stem: "c", can_query: true },
    ];
    expect(computeReadyCount(sources, ["a", "b", "c"])).toBe(2);
  });

  it("ignores ready sources that are not selected", () => {
    const sources = [{ video_stem: "a", can_query: true }, { video_stem: "b", can_query: true }];
    expect(computeReadyCount(sources, ["a"])).toBe(1);
  });

  it("falls back to .video when .video_stem is absent (legacy shape)", () => {
    const sources = [{ video: "legacy-stem", can_query: true }];
    expect(computeReadyCount(sources, ["legacy-stem"])).toBe(1);
  });

  it("returns 0 for empty selection or empty sources, never throws", () => {
    expect(computeReadyCount([], [])).toBe(0);
    expect(computeReadyCount([{ video_stem: "a", can_query: true }], [])).toBe(0);
    expect(computeReadyCount([], ["a"])).toBe(0);
  });

  it("tolerates missing/undefined inputs (defensive, same as other util fns in this codebase)", () => {
    expect(computeReadyCount(undefined, undefined)).toBe(0);
    expect(computeReadyCount(null, null)).toBe(0);
  });

  it("does not count a selected source that exists but is not yet ready", () => {
    const sources = [{ video_stem: "a", can_query: false, status: "processing" }];
    expect(computeReadyCount(sources, ["a"])).toBe(0);
  });
});
