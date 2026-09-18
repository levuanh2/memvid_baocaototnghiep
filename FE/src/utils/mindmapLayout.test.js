import { describe, expect, it } from "vitest";
import { assignBranchDirections, compactTopic, LEFT, RIGHT } from "./mindmapLayout";

const N = (id, parent, order, children = 0) => ({ id, parent, order, kind: id === "root" ? "root" : "idea", children });

describe("mindmap layout contract", () => {
  it("computes subtree weights and greedily balances by weight", () => {
    const nodes = [
      N("root", null, 0), N("a", "root", 0), N("a1", "a", 0), N("a2", "a", 1), N("a3", "a", 2),
      N("b", "root", 1), N("b1", "b", 0), N("c", "root", 2), N("d", "root", 3),
    ];
    const result = assignBranchDirections(nodes);
    expect(result.weights.get("a")).toBe(4);
    expect(result.weights.get("b")).toBe(2);
    expect(result.weights.get("c")).toBe(1);
    expect(result.directions.get("a")).toBe(LEFT);
    expect(result.directions.get("b")).toBe(RIGHT);
    expect(result.directions.get("c")).toBe(RIGHT);
    expect(result.directions.get("d")).toBe(RIGHT);
  });

  it("keeps semantic order inside each side and stable colors", () => {
    const nodes = [N("root", null, 0), N("first", "root", 0), N("second", "root", 1), N("third", "root", 2)];
    const result = assignBranchDirections(nodes);
    expect(result.branches.map((node) => node.id)).toEqual(["first", "second", "third"]);
    expect(result.colors.get("first")).toBe("#126CF2");
    expect(result.colors.get("second")).toBe("#1F4033");
    expect([...result.directions.values()]).toEqual([LEFT, RIGHT, LEFT]);
  });

  it("compacts long paragraph-like topics without exceeding the contract", () => {
    const topic = compactTopic("Một đoạn giải thích rất dài ".repeat(12));
    expect(topic.length).toBeLessThanOrEqual(100);
    expect(topic.endsWith("…")).toBe(true);
    expect(compactTopic("  Một ý ngắn  ")).toBe("Một ý ngắn");
  });
});
