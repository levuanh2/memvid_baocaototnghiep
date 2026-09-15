import { describe, it, expect } from "vitest";
import {
  dedupeHistory, classifyEntry, evolutionGroups, reviewSuggestions,
  sessionSummary, partitionNodesByVisit, nodeHeatmap,
} from "./knowledgeEvolution";

const e = (kind, id, at, label) => ({ kind, id, label: label ?? id, source: "chat", at });

describe("dedupeHistory", () => {
  it("merges repeated (kind,id) into one entry with a real count", () => {
    const h = [e("node", "n1", 1000), e("node", "n1", 2000), e("topic", "t1", 3000)];
    const out = dedupeHistory(h);
    expect(out).toHaveLength(2);
    const n1 = out.find((x) => x.id === "n1");
    expect(n1.count).toBe(2);
    expect(n1.firstAt).toBe(1000);
    expect(n1.lastAt).toBe(2000);
  });

  it("empty/undefined history returns an empty array, never throws", () => {
    expect(dedupeHistory([])).toEqual([]);
    expect(dedupeHistory(undefined)).toEqual([]);
  });
});

describe("classifyEntry", () => {
  const NOW = 100 * 60 * 1000; // t=100min
  it("count >= 2 is frequent regardless of age", () => {
    expect(classifyEntry({ firstAt: 0, lastAt: 0, count: 2 }, NOW)).toBe("frequent");
  });
  it("single visit within the discovered window is discovered", () => {
    expect(classifyEntry({ firstAt: NOW - 60000, lastAt: NOW - 60000, count: 1 }, NOW)).toBe("discovered");
  });
  it("single visit, old and not revisited, is needs-review", () => {
    expect(classifyEntry({ firstAt: NOW - 20 * 60000, lastAt: NOW - 20 * 60000, count: 1 }, NOW)).toBe("needs-review");
  });
  it("single visit in the middle band (not new, not stale) classifies as null — no fabricated label", () => {
    expect(classifyEntry({ firstAt: NOW - 7 * 60000, lastAt: NOW - 7 * 60000, count: 1 }, NOW)).toBeNull();
  });

  it("boundary: exactly at the 5-minute discovered window is still discovered (<=, not <)", () => {
    const at = NOW - 5 * 60000;
    expect(classifyEntry({ firstAt: at, lastAt: at, count: 1 }, NOW)).toBe("discovered");
  });
  it("boundary: one ms past the 5-minute window is no longer discovered", () => {
    const at = NOW - 5 * 60000 - 1;
    expect(classifyEntry({ firstAt: at, lastAt: at, count: 1 }, NOW)).toBeNull();
  });
  it("boundary: exactly at the 10-minute needs-review age is already needs-review (>=, not >)", () => {
    const at = NOW - 10 * 60000;
    expect(classifyEntry({ firstAt: at, lastAt: at, count: 1 }, NOW)).toBe("needs-review");
  });
  it("boundary: one ms short of the 10-minute needs-review age is not yet needs-review", () => {
    const at = NOW - 10 * 60000 + 1;
    expect(classifyEntry({ firstAt: at, lastAt: at, count: 1 }, NOW)).toBeNull();
  });
});

describe("dedupeHistory — first-visit vs revisit, node id type coercion", () => {
  it("a first visit (count 1) keeps firstAt === lastAt", () => {
    const out = dedupeHistory([e("topic", "t1", 500)]);
    expect(out[0]).toMatchObject({ count: 1, firstAt: 500, lastAt: 500 });
  });

  it("a numeric node id and its string form merge into one entry (normalized at one place)", () => {
    const h = [e("node", 5, 1000), e("node", "5", 2000)];
    const out = dedupeHistory(h);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(2);
  });

  it("non-node kinds are never id-coerced (a real behavior difference from node — not a bug)", () => {
    // Distinct string ids for a non-node kind stay distinct even if they'd
    // coerce equal as numbers — dedupeHistory must not blanket-coerce every kind.
    const h = [e("topic", "1", 1000), e("topic", "01", 2000)];
    expect(dedupeHistory(h)).toHaveLength(2);
  });

  it("malformed entries (missing label) never throw", () => {
    expect(() => dedupeHistory([{ kind: "node", id: "n1", at: 1 }])).not.toThrow();
  });

  it("a full document reset (history back to []) yields no groups, no leftover state", () => {
    expect(evolutionGroups([], 999999)).toEqual({ discovered: [], frequent: [], needsReview: [] });
  });
});

describe("evolutionGroups", () => {
  it("sorts discovered newest-first, frequent by count, needs-review oldest-first", () => {
    const NOW = 100 * 60000;
    const h = [
      e("topic", "old", NOW - 30 * 60000),                 // needs-review
      e("topic", "new", NOW - 60000),                        // discovered
      e("node", "hot", NOW - 50 * 60000), e("node", "hot", NOW - 60000), // frequent
    ];
    const g = evolutionGroups(h, NOW);
    expect(g.discovered.map((x) => x.id)).toEqual(["new"]);
    expect(g.frequent.map((x) => x.id)).toEqual(["hot"]);
    expect(g.needsReview.map((x) => x.id)).toEqual(["old"]);
  });
});

describe("reviewSuggestions", () => {
  it("returns at most `limit`, oldest-stale first", () => {
    const NOW = 100 * 60000;
    const h = [1, 2, 3].map((i) => e("topic", `t${i}`, NOW - (20 + i) * 60000));
    const out = reviewSuggestions(h, NOW, 2);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("t3"); // oldest lastAt first
  });
});

describe("sessionSummary", () => {
  it("counts distinct (kind,id) per kind honestly, unions topic+entity as concepts", () => {
    const h = [
      e("question", "q1", 1), e("question", "q1", 2), // same question asked twice -> 1 distinct
      e("evidence", "ev1", 3),
      e("topic", "t1", 4), e("entity", "en1", 5),
      e("node", "n1", 6), e("node", "n2", 7),
    ];
    const s = sessionSummary(h);
    expect(s.questions).toBe(1);
    expect(s.evidence).toBe(1);
    expect(s.concepts).toBe(2);
    expect(s.nodes).toBe(2);
    expect(s.totalActions).toBe(7); // raw log length, not deduped
  });

  it("empty history is all zeros, never fabricated", () => {
    expect(sessionSummary([])).toEqual({ questions: 0, evidence: 0, concepts: 0, nodes: 0, summaries: 0, totalActions: 0 });
  });
});

describe("partitionNodesByVisit", () => {
  const allNodes = [{ id: "n1", title: "A" }, { id: "n2", title: "B" }, { id: "n3", title: "C" }];
  it("splits by whether a node kind entry exists in history", () => {
    const h = [e("node", "n1", 1), e("node", "n2", 2)];
    const { visited, unvisited } = partitionNodesByVisit(allNodes, h);
    expect(visited.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
    expect(unvisited.map((n) => n.id)).toEqual(["n3"]);
  });

  it("a stale history id for a node no longer in allNodes does not appear anywhere", () => {
    const h = [e("node", "ghost", 1)];
    const { visited, unvisited } = partitionNodesByVisit(allNodes, h);
    expect(visited).toEqual([]);
    expect(unvisited).toHaveLength(3);
  });

  it("a numeric node id in allNodes still matches its string form in history", () => {
    const nodesNumeric = [{ id: 1, title: "A" }, { id: 2, title: "B" }];
    const h = [e("node", "1", 10)];
    const { visited, unvisited } = partitionNodesByVisit(nodesNumeric, h);
    expect(visited.map((n) => n.id)).toEqual([1]);
    expect(unvisited.map((n) => n.id)).toEqual([2]);
  });
});

describe("nodeHeatmap", () => {
  it("buckets by real visit count: frequent >=2, rare ==1, never ==0", () => {
    const allNodes = [{ id: "n1" }, { id: "n2" }, { id: "n3" }];
    const h = [e("node", "n1", 1), e("node", "n1", 2), e("node", "n2", 3)];
    const { frequent, rare, never } = nodeHeatmap(allNodes, h);
    expect(frequent.map((n) => n.id)).toEqual(["n1"]);
    expect(frequent[0].visitCount).toBe(2);
    expect(rare.map((n) => n.id)).toEqual(["n2"]);
    expect(never.map((n) => n.id)).toEqual(["n3"]);
  });
});
