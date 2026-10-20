// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { estimateExportDimensions } from "./mindmapImageExport";

describe("estimateExportDimensions exact selected scope", () => {
  it("includes minimal context ancestors and excludes an unselected far-away sibling", () => {
    const map = document.createElement("div");
    map.getBoundingClientRect = () => ({ left: 0, top: 0, right: 3000, bottom: 400, width: 3000, height: 400 });
    const rects = {
      root: { left: 0, top: 100, right: 100, bottom: 140, width: 100, height: 40 },
      p: { left: 100, top: 100, right: 200, bottom: 140, width: 100, height: 40 },
      a: { left: 200, top: 50, right: 300, bottom: 90, width: 100, height: 40 },
      b: { left: 200, top: 150, right: 300, bottom: 190, width: 100, height: 40 },
      c: { left: 2000, top: 300, right: 3000, bottom: 400, width: 1000, height: 100 },
    };
    const topics = new Map(Object.entries(rects).map(([id, rect]) => {
      const wrapper = document.createElement("me-wrapper");
      const topic = document.createElement("me-tpc");
      wrapper.appendChild(topic);
      topic.getBoundingClientRect = () => rect;
      wrapper.getBoundingClientRect = () => rect;
      return [id, topic];
    }));
    const mind = {
      map,
      nodeData: {
        id: "root", topic: "Root", expanded: true,
        children: [{
          id: "p", topic: "P", expanded: true,
          children: [
            { id: "a", topic: "A", expanded: true, children: [] },
            { id: "b", topic: "B", expanded: true, children: [] },
            { id: "c", topic: "C", expanded: true, children: [] },
          ],
        }],
      },
      findEle: (id) => topics.get(id),
    };

    expect(estimateExportDimensions({
      mind,
      scopeType: "selected_branches",
      branchRootIds: ["a", "b"],
      scale: 2,
    })).toEqual({ width: 400, height: 280 });
  });
});
