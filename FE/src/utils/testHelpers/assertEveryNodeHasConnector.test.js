import { describe, expect, it } from "vitest";
import { assertEveryNodeHasConnector } from "./assertEveryNodeHasConnector";

const box = (x, y, width, height) => ({ x, y, width, height });
function fixture() {
  return {
    nodes: [
      { id: "root", ...box(100, 50, 40, 30) },
      { id: "a", ...box(180, 10, 40, 30) },
      { id: "b", ...box(180, 100, 40, 30) },
    ],
    connectors: [box(140, 25, 40, 40), box(140, 65, 40, 50)],
  };
}
const options = { presentationRootId: "root", parentById: { a: "root", b: "root" } };

describe("assertEveryNodeHasConnector", () => {
  it("matches every child to a distinct path approaching its parent", () => {
    expect(assertEveryNodeHasConnector(fixture(), options)).toEqual({
      nodeCount: 3, pathCount: 2, matchedEdgeCount: 2,
    });
  });
  it("allows a promoted root with no incoming path", () => {
    expect(assertEveryNodeHasConnector(
      { nodes: [fixture().nodes[1]], connectors: [] },
      { presentationRootId: "a", parentById: {} },
    ).matchedEdgeCount).toBe(0);
  });
  it("supports a suppressed-context forest with multiple presentation roots", () => {
    expect(assertEveryNodeHasConnector(fixture(), {
      presentationRootIds: ["root", "b"],
      parentById: { a: "root" },
    })).toEqual({ nodeCount: 3, pathCount: 2, matchedEdgeCount: 1 });
  });
  it("accepts a straight horizontal path with zero height", () => {
    const manifest = fixture();
    manifest.nodes[1].y = 50;
    manifest.connectors[0] = box(140, 65, 40, 0);
    expect(() => assertEveryNodeHasConnector(manifest, options)).not.toThrow();
  });
  it.each([
    ["missing", (m) => m.connectors.pop()],
    ["stale", (m) => { m.connectors[1].y += 100; }],
    ["wrong parent", (m) => { m.nodes[0].x = 0; }],
    ["enclosing", (m) => { m.connectors[1] = box(0, 0, 300, 200); }],
    ["shared", (m) => { m.nodes[2].y = 12; m.connectors.pop(); }],
    ["point", (m) => { m.connectors[1] = box(140, 65, 0, 0); }],
    ["NaN", (m) => { m.connectors[1].x = NaN; }],
    ["infinite", (m) => { m.connectors[1].width = Infinity; }],
    ["negative", (m) => { m.connectors[1].width = -1; }],
  ])("rejects %s geometry even when a path exists", (_label, mutate) => {
    const manifest = fixture();
    mutate(manifest);
    expect(() => assertEveryNodeHasConnector(manifest, options)).toThrow();
  });
  it("requires explicit topology", () => {
    expect(() => assertEveryNodeHasConnector(fixture())).toThrow("Supply parentById");
    expect(() => assertEveryNodeHasConnector(
      fixture(), { ...options, parentById: { a: "root" } },
    )).toThrow("Missing rendered parent for b");
  });
  it("reports the failing edge and measurements", () => {
    const manifest = fixture();
    manifest.connectors[1].y += 100;
    expect(() => assertEveryNodeHasConnector(manifest, options)).toThrow(
      /"nodeId":"b","parentId":"root".*"childGap":35.*"parentGap":0.*"nodeCount":3,"pathCount":2/,
    );
  });
});
