import { describe, it, expect } from "vitest";
import { buildGraphIndex, relationsFor, headingPath } from "./mindmapGraph";

const REC = {
  schema_version: 2, title: "T",
  nodes: [
    { id: "n0", parent: null, kind: "root", title: "T", order: 0 },
    { id: "n1", parent: "n0", kind: "section", title: "1. Mở đầu", number: "1", order: 0 },
    { id: "n2", parent: "n0", kind: "section", title: "2. Phương pháp", number: "2", order: 1 },
    { id: "n3", parent: "n1", kind: "idea", title: "Bối cảnh", order: 0 },
    { id: "n4", parent: "n1", kind: "idea", title: "Mục tiêu", order: 1 },
  ],
  relations: [], generator: {},
};

describe("mindmapGraph", () => {
  it("relationsFor: middle sibling gets parent + prev + next", () => {
    const idx = buildGraphIndex(REC);
    const r = relationsFor(idx, "n1");
    expect(r.parent.id).toBe("n0");
    expect(r.children.map((c) => c.id)).toEqual(["n3", "n4"]);
    expect(r.siblings.map((s) => s.id)).toEqual(["n2"]);
    expect(r.prev).toBeNull();
    expect(r.next.id).toBe("n2");
  });

  it("relationsFor: last sibling has prev, no next", () => {
    const idx = buildGraphIndex(REC);
    const r = relationsFor(idx, "n2");
    expect(r.prev.id).toBe("n1");
    expect(r.next).toBeNull();
    expect(r.children).toEqual([]);
  });

  it("relationsFor: unknown node id degrades to empty shape, never throws", () => {
    const idx = buildGraphIndex(REC);
    expect(relationsFor(idx, "ghost")).toEqual({ parent: null, children: [], siblings: [], prev: null, next: null });
  });

  it("headingPath: root excluded, chain in root→leaf order", () => {
    const idx = buildGraphIndex(REC);
    expect(headingPath(idx, "n3").map((h) => h.id)).toEqual(["n1"]);
    expect(headingPath(idx, "n1")).toEqual([]);
  });

  it("buildGraphIndex tolerates garbage records (reuses normalizeMindmapRecord's own contract)", () => {
    const idx = buildGraphIndex(null);
    expect(relationsFor(idx, "anything")).toEqual({ parent: null, children: [], siblings: [], prev: null, next: null });
  });
});
