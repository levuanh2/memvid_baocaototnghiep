import { describe, it, expect } from "vitest";
import { buildGraphIndex, relationsFor, headingPath, findNodeByChunk, allNodeSummaries, classifyByProvenance } from "./mindmapGraph";

const REC = {
  schema_version: 2, title: "T",
  nodes: [
    { id: "n0", parent: null, kind: "root", title: "T", order: 0 },
    { id: "n1", parent: "n0", kind: "section", title: "1. Mở đầu", number: "1", order: 0 },
    { id: "n2", parent: "n0", kind: "section", title: "2. Phương pháp", number: "2", order: 1 },
    { id: "n3", parent: "n1", kind: "idea", title: "Bối cảnh", order: 0, chunk_refs: ["c1", "c2"] },
    { id: "n4", parent: "n1", kind: "idea", title: "Mục tiêu", order: 1, chunk_refs: ["c2", "c3"] },
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

  // Feature Pack B (Cross Navigation) — Chat -> MindMap node.
  describe("findNodeByChunk", () => {
    it("finds the one node citing a chunk", () => {
      const idx = buildGraphIndex(REC);
      expect(findNodeByChunk(idx, "c1")).toBe("n3");
    });

    it("two nodes citing the same chunk: deterministic first match, not either-or", () => {
      const idx = buildGraphIndex(REC);
      // c2 is on both n3 and n4 — n3 comes first in `norm.nodes` order.
      expect(findNodeByChunk(idx, "c2")).toBe("n3");
    });

    it("no node cites this chunk → null, not a guess", () => {
      const idx = buildGraphIndex(REC);
      expect(findNodeByChunk(idx, "not-a-real-chunk")).toBeNull();
    });

    it("numeric vs string chunk id still matches (compares as strings)", () => {
      const idx = buildGraphIndex(REC);
      expect(findNodeByChunk(idx, 1)).toBeNull();   // "1" was never a chunk id here
      expect(findNodeByChunk(idx, "c1")).toBe("n3");
    });

    it("empty/missing chunkId never matches anything", () => {
      const idx = buildGraphIndex(REC);
      expect(findNodeByChunk(idx, "")).toBeNull();
      expect(findNodeByChunk(idx, null)).toBeNull();
      expect(findNodeByChunk(idx, undefined)).toBeNull();
    });
  });

  // Feature Pack D (Personal Knowledge Graph) — every node except root.
  describe("allNodeSummaries", () => {
    it("returns every non-root node, summarized", () => {
      const idx = buildGraphIndex(REC);
      const ids = allNodeSummaries(idx).map((n) => n.id).sort();
      expect(ids).toEqual(["n1", "n2", "n3", "n4"]);
    });

    it("root is excluded", () => {
      const idx = buildGraphIndex(REC);
      expect(allNodeSummaries(idx).some((n) => n.id === "n0")).toBe(false);
    });

    it("garbage/empty record → empty array, never throws", () => {
      expect(allNodeSummaries(buildGraphIndex(null))).toEqual([]);
    });

    // M2.5 — sourceStems passthrough into summarized nodes.
    it("includes sourceStems when the node has it, omits the key otherwise", () => {
      const rec = {
        ...REC,
        nodes: REC.nodes.map((n) => n.id === "n3" ? { ...n, source_stems: ["paper-a", "paper-b"] } : n),
      };
      const idx = buildGraphIndex(rec);
      const summaries = allNodeSummaries(idx);
      expect(summaries.find((n) => n.id === "n3").sourceStems).toEqual(["paper-a", "paper-b"]);
      expect(summaries.find((n) => n.id === "n4")).not.toHaveProperty("sourceStems");
    });
  });

  // M2.5 (Provenance Adoption, mục 3) — deterministic classification, source_stems only.
  describe("classifyByProvenance", () => {
    it("unresolved: no sourceStems at all", () => {
      expect(classifyByProvenance({ id: "n1" })).toBe("unresolved");
      expect(classifyByProvenance(null)).toBe("unresolved");
    });

    it("single-source: exactly one stem", () => {
      expect(classifyByProvenance({ sourceStems: ["paper-a"] })).toBe("single-source");
    });

    it("shared: two or more stems — never fewer, never inferred from anything but the count", () => {
      expect(classifyByProvenance({ sourceStems: ["paper-a", "paper-b"] })).toBe("shared");
      expect(classifyByProvenance({ sourceStems: ["a", "b", "c"] })).toBe("shared");
    });
  });
});
