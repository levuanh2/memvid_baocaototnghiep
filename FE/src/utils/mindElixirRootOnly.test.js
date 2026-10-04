// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import MindElixir from "mind-elixir";
import { setRootOnly, reapplyRootOnly, isRootOnly, hiddenBranchCount, clearRootOnly } from "./mindElixirRootOnly";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
});

function data() {
  return {
    nodeData: {
      id: "root", topic: "Root", expanded: true,
      children: [
        { id: "a", topic: "A", children: [
          { id: "a1", topic: "A1", children: [{ id: "a1x", topic: "A1x", children: [] }] },
          { id: "a2", topic: "A2", children: [] },
        ] },
        { id: "b", topic: "B", children: [{ id: "b1", topic: "B1", children: [] }] },
        { id: "c", topic: "C", children: [] },
        { id: "d", topic: "D", children: [{ id: "d1", topic: "D1", children: [] }] },
      ],
    },
    arrows: [], summaries: [],
  };
}

let container, mind;
function mount() {
  container = document.createElement("div");
  container.style.width = "1200px";
  container.style.height = "800px";
  document.body.appendChild(container);
  mind = new MindElixir({ el: container, direction: MindElixir.SIDE, editable: true, keypress: false, toolBar: false, contextMenu: false });
  mind.init(data());
  return mind;
}

afterEach(() => {
  container?.remove();
  container = null;
  mind = null;
  vi.restoreAllMocks();
});

const visibleTopicIds = () => [...container.querySelectorAll("me-tpc")].map((t) => t.nodeObj.id).sort();
const connectorCount = () => mind.lines?.querySelectorAll("path").length ?? 0;

describe("mindElixirRootOnly — real Mind Elixir 5.13 DOM", () => {
  it("documents the defect: expandNodeAll(root, false) leaves every first-level branch visible", () => {
    mount();
    const rootTopic = mind.findEle("root");
    mind.expandNodeAll(rootTopic, false);
    const ids = visibleTopicIds();
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids.length).toBeGreaterThan(1);
  });

  it("collapse-to-root leaves exactly one visible topic and zero connectors", () => {
    mount();
    const before = visibleTopicIds();
    expect(before.length).toBeGreaterThan(1);
    expect(connectorCount()).toBeGreaterThan(0);

    expect(setRootOnly(mind, true)).toBe(true);

    expect(visibleTopicIds()).toEqual(["root"]);
    expect(connectorCount()).toBe(0);
    expect(hiddenBranchCount(mind)).toBe(4);
    expect(isRootOnly(mind)).toBe(true);
  });

  it("does not mutate the persisted tree: getData and nodeData keep all branches and ids", () => {
    mount();
    const nodeDataRef = mind.nodeData;
    const beforeIds = mind.getData().nodeData.children.map((c) => c.id);
    setRootOnly(mind, true);
    expect(mind.nodeData).toBe(nodeDataRef);
    expect(mind.getData().nodeData.children.map((c) => c.id)).toEqual(beforeIds);
    expect(mind.nodeData.children.length).toBe(4);
  });

  it("expand restores the exact original visible topics and connector count", () => {
    mount();
    const beforeIds = visibleTopicIds();
    const beforeConnectors = connectorCount();
    setRootOnly(mind, true);
    expect(setRootOnly(mind, false)).toBe(true);
    expect(visibleTopicIds()).toEqual(beforeIds);
    expect(connectorCount()).toBe(beforeConnectors);
    expect(isRootOnly(mind)).toBe(false);
  });

  it("preserves a per-node collapse across root-only and expand", () => {
    mount();
    mind.expandNode(mind.findEle("a"), false);
    const beforeIds = visibleTopicIds();
    expect(beforeIds).not.toContain("a1");

    setRootOnly(mind, true);
    setRootOnly(mind, false);

    expect(visibleTopicIds()).toEqual(beforeIds);
    expect(mind.nodeData.children[0].expanded).toBe(false);
    expect(visibleTopicIds()).not.toContain("a1");
  });

  it("three collapse/expand cycles do not duplicate DOM topics or connectors", () => {
    mount();
    const baseline = visibleTopicIds();
    const baseConnectors = connectorCount();
    for (let i = 0; i < 3; i++) {
      setRootOnly(mind, true);
      expect(visibleTopicIds()).toEqual(["root"]);
      setRootOnly(mind, false);
      expect(visibleTopicIds()).toEqual(baseline);
      expect(connectorCount()).toBe(baseConnectors);
    }
  });

  it("never calls toCenter, scaleFit or move, and keeps the same instance and container", () => {
    mount();
    const toCenter = vi.spyOn(mind, "toCenter");
    const scaleFit = vi.spyOn(mind, "scaleFit");
    const move = vi.spyOn(mind, "move");
    const el = mind.container;
    setRootOnly(mind, true);
    setRootOnly(mind, false);
    expect(toCenter).not.toHaveBeenCalled();
    expect(scaleFit).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(mind.container).toBe(el);
  });

  it("clears the active selection when entering root-only", () => {
    mount();
    mind.selectNode(mind.findEle("a"));
    const clear = vi.spyOn(mind, "clearSelection");
    setRootOnly(mind, true);
    expect(clear).toHaveBeenCalled();
  });

  it("reapplyRootOnly restores root-only after an external full refresh (e.g. theme change)", () => {
    mount();
    setRootOnly(mind, true);
    mind.refresh();
    expect(visibleTopicIds().length).toBeGreaterThan(1);
    expect(reapplyRootOnly(mind)).toBe(true);
    expect(visibleTopicIds()).toEqual(["root"]);
    expect(mind.nodeData.children.length).toBe(4);
  });

  it("is idempotent and a no-op on a leaf root", () => {
    mount();
    expect(setRootOnly(mind, true)).toBe(true);
    expect(setRootOnly(mind, true)).toBe(false);
    expect(setRootOnly(mind, false)).toBe(true);
    expect(setRootOnly(mind, false)).toBe(false);

    mind.destroy?.();
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    const leaf = new MindElixir({ el: container, direction: MindElixir.SIDE, keypress: false, toolBar: false, contextMenu: false });
    leaf.init({ nodeData: { id: "solo", topic: "Solo", children: [] }, arrows: [], summaries: [] });
    expect(setRootOnly(leaf, true)).toBe(false);
  });
});

describe("mindElixirRootOnly — atomic failure handling", () => {
  const failOnce = (mind) => vi.spyOn(mind, "refresh").mockImplementationOnce(() => { throw new Error("refresh failed"); });

  it("collapse: a failed root-only render restores children, keeps state false, and the next collapse succeeds", () => {
    mount();
    const base = visibleTopicIds();
    const branches = mind.nodeData.children;
    failOnce(mind);

    expect(setRootOnly(mind, true)).toBe(false);
    expect(mind.nodeData.children).toBe(branches);
    expect(mind.nodeData.children.length).toBe(4);
    expect(isRootOnly(mind)).toBe(false);
    expect(hiddenBranchCount(mind)).toBe(0);
    expect(visibleTopicIds()).toEqual(base);

    expect(setRootOnly(mind, true)).toBe(true);
    expect(isRootOnly(mind)).toBe(true);
    expect(visibleTopicIds()).toEqual(["root"]);
  });

  it("expand: a failed restore keeps root-only state so the UI never reports expanded over a collapsed DOM", () => {
    mount();
    const base = visibleTopicIds();
    expect(setRootOnly(mind, true)).toBe(true);
    failOnce(mind);

    expect(setRootOnly(mind, false)).toBe(false);
    expect(isRootOnly(mind)).toBe(true);
    expect(mind.nodeData.children.length).toBe(4);
    expect(visibleTopicIds()).toEqual(["root"]);

    expect(setRootOnly(mind, false)).toBe(true);
    expect(isRootOnly(mind)).toBe(false);
    expect(visibleTopicIds()).toEqual(base);
  });

  it("a failed expand does not lose a per-node collapse", () => {
    mount();
    mind.expandNode(mind.findEle("a"), false);
    expect(setRootOnly(mind, true)).toBe(true);
    failOnce(mind);
    expect(setRootOnly(mind, false)).toBe(false);
    expect(setRootOnly(mind, false)).toBe(true);
    expect(mind.nodeData.children[0].expanded).toBe(false);
    expect(visibleTopicIds()).not.toContain("a1");
  });

  it("map switch after a failed expand does not carry root-only state into the new map", () => {
    mount();
    expect(setRootOnly(mind, true)).toBe(true);
    failOnce(mind);
    expect(setRootOnly(mind, false)).toBe(false);

    clearRootOnly(mind);
    mind.refresh({
      nodeData: { id: "rootB", topic: "B", children: [{ id: "x", topic: "X", children: [] }] },
      arrows: [], summaries: [],
    });

    expect(isRootOnly(mind)).toBe(false);
    expect(hiddenBranchCount(mind)).toBe(0);
    expect(reapplyRootOnly(mind)).toBe(false);
    expect(visibleTopicIds()).toEqual(["rootB", "x"]);
  });
});
