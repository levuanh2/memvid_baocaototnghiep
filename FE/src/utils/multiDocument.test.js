import { describe, it, expect } from "vitest";
import { extractConcepts, compareConcepts, matchDocumentsToStems, evidenceCoverage } from "./multiDocument";
import { citeKey } from "./evidence";

describe("extractConcepts", () => {
  it("reads topics (objects with name) and entities (plain strings)", () => {
    const doc = { knowledge: { topics: [{ name: "CPU" }, { name: "RAM" }], entities: ["Intel", "AMD"] } };
    expect(extractConcepts(doc)).toEqual([
      { kind: "topic", name: "CPU" }, { kind: "topic", name: "RAM" },
      { kind: "entity", name: "Intel" }, { kind: "entity", name: "AMD" },
    ]);
  });

  it("missing/malformed knowledge never throws, returns []", () => {
    expect(extractConcepts(null)).toEqual([]);
    expect(extractConcepts({})).toEqual([]);
    expect(extractConcepts({ knowledge: {} })).toEqual([]);
  });

  it("a topic with no name, or a falsy entity entry, is skipped", () => {
    const doc = { knowledge: { topics: [{ name: "" }, { }], entities: ["", null, "Real"] } };
    expect(extractConcepts(doc)).toEqual([{ kind: "entity", name: "Real" }]);
  });
});

describe("compareConcepts", () => {
  const docs = (extra = []) => ([
    { id: "d1", concepts: [{ kind: "topic", name: "CPU" }, { kind: "topic", name: "Bộ nhớ" }] },
    { id: "d2", concepts: [{ kind: "topic", name: "cpu" }, { kind: "entity", name: "Intel" }] }, // "cpu" == "CPU" after boDau
    { id: "d3", concepts: [{ kind: "entity", name: "AMD" }] },
    ...extra,
  ]);

  it("groups an exact (case/diacritic-insensitive) name match across docs as shared, with full docId provenance", () => {
    const { shared } = compareConcepts(docs());
    const cpu = shared.find((s) => s.name.toLowerCase() === "cpu");
    expect(cpu.docIds.sort()).toEqual(["d1", "d2"]);
  });

  it("a concept in only one doc goes to that doc's uniquePerDoc, never to shared", () => {
    const { shared, uniquePerDoc } = compareConcepts(docs());
    expect(shared.some((s) => s.name === "Bộ nhớ")).toBe(false);
    expect(uniquePerDoc.get("d1")).toEqual([{ kind: "topic", name: "Bộ nhớ" }]);
    expect(uniquePerDoc.get("d3")).toEqual([{ kind: "entity", name: "AMD" }]);
  });

  it("different kinds with the same name do NOT merge — a topic and an entity are distinct concepts", () => {
    const { shared, uniquePerDoc } = compareConcepts([
      { id: "a", concepts: [{ kind: "topic", name: "Java" }] },
      { id: "b", concepts: [{ kind: "entity", name: "Java" }] },
    ]);
    expect(shared).toEqual([]);
    expect(uniquePerDoc.get("a")).toEqual([{ kind: "topic", name: "Java" }]);
    expect(uniquePerDoc.get("b")).toEqual([{ kind: "entity", name: "Java" }]);
  });

  it("a concept repeated twice inside the SAME document counts once (presence, not frequency)", () => {
    const { shared, uniquePerDoc } = compareConcepts([
      { id: "a", concepts: [{ kind: "topic", name: "X" }, { kind: "topic", name: "X" }] },
      { id: "b", concepts: [] },
    ]);
    expect(shared).toEqual([]);
    expect(uniquePerDoc.get("a")).toEqual([{ kind: "topic", name: "X" }]);
  });

  it("every given doc id appears in uniquePerDoc even with zero unique concepts", () => {
    const { uniquePerDoc } = compareConcepts([{ id: "empty", concepts: [] }]);
    expect(uniquePerDoc.get("empty")).toEqual([]);
  });

  it("empty/malformed input never throws", () => {
    expect(compareConcepts([])).toEqual({ shared: [], uniquePerDoc: new Map() });
    expect(compareConcepts(undefined)).toEqual({ shared: [], uniquePerDoc: new Map() });
    expect(compareConcepts([{ concepts: [{ kind: "topic", name: "orphan" }] }]).shared).toEqual([]); // no id -> skipped
  });

  it("no semantic merging — near-synonyms with different literal names never merge", () => {
    const { shared } = compareConcepts([
      { id: "a", concepts: [{ kind: "topic", name: "Bộ nhớ" }] },
      { id: "b", concepts: [{ kind: "topic", name: "RAM" }] }, // a human synonym, NOT the same string
    ]);
    expect(shared).toEqual([]);
  });
});

describe("matchDocumentsToStems", () => {
  const documents = [
    { document_id: "1", source_stem: "bai_1_20260101_120000" },
    { document_id: "2", source_stem: "bai_2" },
  ];

  it("matches via normStem — a timestamp-suffixed source_stem still matches a bare selected stem", () => {
    expect(matchDocumentsToStems(documents, ["bai_1"]).map((d) => d.document_id)).toEqual(["1"]);
  });

  it("returns only the documents whose stem was selected, in library order", () => {
    expect(matchDocumentsToStems(documents, ["bai_2", "bai_1"]).map((d) => d.document_id)).toEqual(["1", "2"]);
  });

  it("unmatched/empty stems never throw", () => {
    expect(matchDocumentsToStems(documents, [])).toEqual([]);
    expect(matchDocumentsToStems(documents, ["ghost"])).toEqual([]);
    expect(matchDocumentsToStems(null, ["bai_1"])).toEqual([]);
  });
});

describe("evidenceCoverage", () => {
  it("a source with at least one opened citation is covered, others are uncovered", () => {
    const history = [{ kind: "evidence", id: citeKey("bai_1", 3), at: 1 }];
    const { covered, uncovered } = evidenceCoverage(history, ["bai_1", "bai_2"]);
    expect(covered).toEqual(["bai_1"]);
    expect(uncovered).toEqual(["bai_2"]);
  });

  it("matches via normStem — a timestamp-suffixed stem in history still covers a bare selected stem", () => {
    const history = [{ kind: "evidence", id: citeKey("bai_1_20260101_120000", 1), at: 1 }];
    expect(evidenceCoverage(history, ["bai_1"]).covered).toEqual(["bai_1"]);
  });

  it("non-evidence history entries never count toward coverage", () => {
    const history = [{ kind: "node", id: "bai_1", at: 1 }];
    expect(evidenceCoverage(history, ["bai_1"]).covered).toEqual([]);
  });

  it("empty history/stems never throw", () => {
    expect(evidenceCoverage([], [])).toEqual({ covered: [], uncovered: [] });
    expect(evidenceCoverage(undefined, ["a"])).toEqual({ covered: [], uncovered: ["a"] });
  });
});
