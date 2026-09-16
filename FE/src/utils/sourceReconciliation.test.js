import { describe, it, expect } from "vitest";
import { mergeSources, reconcileSelectedSources, keyOfSource } from "./sourceReconciliation";

const noExtFallback = (stem) => stem;

describe("keyOfSource", () => {
  it("prefers video_stem over video", () => {
    expect(keyOfSource({ video_stem: "a", video: "b" })).toBe("a");
  });
  it("falls back to video when video_stem is absent", () => {
    expect(keyOfSource({ video: "b" })).toBe("b");
  });
});

describe("mergeSources", () => {
  it("keeps processing/index_ready local entries and appends new ready backend entries", () => {
    const prev = [{ source_id: "s1", video_stem: null, status: "processing", filename: "a.txt" }];
    const backend = [{ video_stem: "a__1__txt", filename: "a.txt", num_chunks: 3 }];
    const merged = mergeSources(prev, backend, noExtFallback);
    expect(merged).toHaveLength(2);
    expect(merged[0].status).toBe("processing");
    expect(merged[1].video_stem).toBe("a__1__txt");
    expect(merged[1].can_query).toBe(true);
  });

  it("does not duplicate a source already represented by video_stem", () => {
    const prev = [{ video_stem: "a__1__txt", status: "index_ready", filename: "a.txt" }];
    const backend = [{ video_stem: "a__1__txt", filename: "a.txt" }];
    expect(mergeSources(prev, backend, noExtFallback)).toHaveLength(1);
  });

  it("drops a locally-known 'ready' entry not present in backend (replaced, not duplicated)", () => {
    const prev = [{ video_stem: "old_stem", status: "ready", can_query: true, filename: "a.txt" }];
    const backend = [{ video_stem: "new_stem", filename: "a.txt" }];
    const merged = mergeSources(prev, backend, noExtFallback);
    // "ready" isn't in activeSources (only processing/index_ready are kept),
    // so the old entry is gone and only the backend's version remains.
    expect(merged).toEqual([expect.objectContaining({ video_stem: "new_stem" })]);
  });
});

describe("reconcileSelectedSources — the race this hardening guards against", () => {
  it("keeps a selection whose stem still matches the backend list (the common case)", () => {
    const prev = [{ video_stem: "a__1__txt", filename: "a.txt" }];
    const backend = [{ video_stem: "a__1__txt", filename: "a.txt" }];
    expect(reconcileSelectedSources(prev, backend, ["a__1__txt"])).toEqual(["a__1__txt"]);
  });

  it("migrates a selection to the new stem when the backend renamed the same filename", () => {
    // The exact race the coordinator described: a source the FE selected
    // under one computed stem shows up in a later /list-indexed call under
    // a different stem for the same underlying document (filename unchanged).
    const prev = [{ video_stem: "mota_sanpham__2__txt", filename: "MoTa_SanPham (2).txt" }];
    const backend = [{ video_stem: "mota_sanpham__4__txt", filename: "MoTa_SanPham (2).txt" }];
    expect(reconcileSelectedSources(prev, backend, ["mota_sanpham__2__txt"])).toEqual(["mota_sanpham__4__txt"]);
  });

  it("drops a selection for a source genuinely no longer in the backend (real delete, not a rename)", () => {
    const prev = [{ video_stem: "gone__1__txt", filename: "gone.txt" }];
    const backend = [];
    expect(reconcileSelectedSources(prev, backend, ["gone__1__txt"])).toEqual([]);
  });

  it("handles multiple selected sources, migrating only the one that actually renamed", () => {
    const prev = [
      { video_stem: "a__1__txt", filename: "a.txt" },
      { video_stem: "b__1__txt", filename: "b.txt" },
    ];
    const backend = [
      { video_stem: "a__1__txt", filename: "a.txt" },   // unchanged
      { video_stem: "b__3__txt", filename: "b.txt" },   // renamed
    ];
    const result = reconcileSelectedSources(prev, backend, ["a__1__txt", "b__1__txt"]);
    expect(new Set(result)).toEqual(new Set(["a__1__txt", "b__3__txt"]));
  });

  it("de-dupes if two old stems would migrate onto the same new entry", () => {
    const prev = [
      { video_stem: "dupe_old_1", filename: "same.txt" },
      { video_stem: "dupe_old_2", filename: "same.txt" },
    ];
    const backend = [{ video_stem: "dupe_new", filename: "same.txt" }];
    expect(reconcileSelectedSources(prev, backend, ["dupe_old_1", "dupe_old_2"])).toEqual(["dupe_new"]);
  });

  it("does not migrate when filename also differs (a genuinely different document, not a rename)", () => {
    const prev = [{ video_stem: "a__1__txt", filename: "a.txt" }];
    const backend = [{ video_stem: "b__1__txt", filename: "b.txt" }];
    expect(reconcileSelectedSources(prev, backend, ["a__1__txt"])).toEqual([]);
  });

  it("tolerates missing prevSources entry for a selected stem (no match, no crash)", () => {
    const backend = [{ video_stem: "x", filename: "x.txt" }];
    expect(reconcileSelectedSources([], backend, ["a"])).toEqual([]);
  });

  it("tolerates empty/undefined inputs", () => {
    expect(reconcileSelectedSources(undefined, undefined, undefined)).toEqual([]);
    expect(reconcileSelectedSources([], [], [])).toEqual([]);
  });
});
