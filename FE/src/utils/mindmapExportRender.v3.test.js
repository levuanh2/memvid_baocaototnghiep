// @vitest-environment jsdom
// PR A red tests (fail-before on origin/main). Fake data only.
import { describe, it, expect, vi } from "vitest";
import { exportMindmapImage, captureMapImageBase64 } from "./mindmapImageExport";

function makeMind() {
  const map = document.createElement("div");
  const container = document.createElement("div");
  container.appendChild(map);
  document.body.appendChild(container);
  const nodeData = {
    id: "root", topic: "Root", expanded: true,
    children: [{ id: "a", topic: "A", expanded: false, children: [{ id: "a1", topic: "A1", children: [] }] }],
  };
  return {
    map, container, nodeData,
    layout: vi.fn(), linkDiv: vi.fn(), scaleFit: vi.fn(), toCenter: vi.fn(), refresh: vi.fn(),
    findEle: (id) => (id === "root" ? map : null),
  };
}

function fakeSnapdom(targets, { blobSize = 1 } = {}) {
  return vi.fn(async (target) => {
    targets.push(target);
    return {
      download: vi.fn(async () => {}),
      toBlob: async () => new Blob([new Uint8Array(blobSize)], { type: "image/png" }),
    };
  });
}

const RECORD = {
  id: "m1", title: "Bản đồ", schema_version: 2, relations: [], sources: [],
  nodes: [
    { id: "root", kind: "root", title: "Root", parent: null },
    { id: "a", kind: "section", title: "A", parent: "root" },
    { id: "a1", kind: "idea", title: "A1", parent: "a" },
  ],
};

// jsdom has no layout engine, so the offscreen instance is a fake that reports one measurable topic.
class FakeOffscreenMind {
  static SIDE = 2;
  constructor({ el }) {
    this.map = document.createElement("div");
    const tpc = document.createElement("me-tpc");
    tpc.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40 });
    this.map.appendChild(tpc);
    el.appendChild(this.map);
    this.layout = vi.fn(); this.linkDiv = vi.fn(); this.scaleFit = vi.fn(); this.destroy = vi.fn();
    FakeOffscreenMind.instances.push(this);
  }
  init() {}
}
FakeOffscreenMind.instances = [];

describe("full-map export does not touch the live canvas", () => {
  it("does not call layout/linkDiv on the live instance", async () => {
    const mind = makeMind();
    const targets = [];
    await exportMindmapImage({ mind, record: RECORD, scopeType: "full", format: "png", backgroundColor: "#fff", snapdom: fakeSnapdom(targets), settleMs: 0, MindElixirCtor: FakeOffscreenMind });
    expect(mind.layout).not.toHaveBeenCalled();
    expect(mind.linkDiv).not.toHaveBeenCalled();
  });

  it("restores collapse state and never mutates the live expanded flags", async () => {
    const mind = makeMind();
    const targets = [];
    await exportMindmapImage({ mind, record: RECORD, scopeType: "full", format: "png", backgroundColor: "#fff", snapdom: fakeSnapdom(targets), settleMs: 0, MindElixirCtor: FakeOffscreenMind });
    expect(mind.nodeData.children[0].expanded).toBe(false);
  });

  it("behaviour contract: no direct capture of the live element, live instance/root/transform/expanded/selection unchanged, no fit/centre/refresh", async () => {
    const mind = makeMind();
    mind.map.style.transform = "translate3d(40px, 20px, 0px) scale(0.5)";
    const liveRoot = mind.map;
    const transformBefore = mind.map.style.transform;
    const expandedBefore = JSON.stringify(mind.nodeData);
    const targets = [];
    await exportMindmapImage({ mind, record: RECORD, scopeType: "full", format: "png", backgroundColor: "#fff", snapdom: fakeSnapdom(targets), settleMs: 0, MindElixirCtor: FakeOffscreenMind });
    expect(targets.some((t) => t === liveRoot)).toBe(false);
    expect(mind.map).toBe(liveRoot);
    expect(mind.map.style.transform).toBe(transformBefore);
    expect(JSON.stringify(mind.nodeData)).toBe(expandedBefore);
    expect(mind.scaleFit).not.toHaveBeenCalled();
    expect(mind.toCenter).not.toHaveBeenCalled();
    expect(mind.refresh).not.toHaveBeenCalled();
  });
});

describe("current-branch export does not touch the live canvas", () => {
  it("exports the branch from the record without layout/linkDiv/expansion on the live instance", async () => {
    const mind = makeMind();
    const expandedBefore = JSON.stringify(mind.nodeData);
    const targets = [];
    await exportMindmapImage({ mind, record: RECORD, scopeType: "current_branch", targetNodeId: "a", format: "png", backgroundColor: "#fff", snapdom: fakeSnapdom(targets), settleMs: 0, MindElixirCtor: FakeOffscreenMind });
    expect(mind.layout).not.toHaveBeenCalled();
    expect(mind.linkDiv).not.toHaveBeenCalled();
    expect(JSON.stringify(mind.nodeData)).toBe(expandedBefore);
    expect(targets.some((t) => t === mind.map)).toBe(false);
  });
});

describe("capture must fail loudly when the image is empty", () => {
  it("rejects an empty capture instead of returning a base64 string", async () => {
    const mind = makeMind();
    await expect(
      captureMapImageBase64({ mind, record: RECORD, scopeType: "full", format: "png", backgroundColor: "#fff", snapdom: fakeSnapdom([], { blobSize: 0 }), settleMs: 0, MindElixirCtor: FakeOffscreenMind }),
    ).rejects.toThrow();
  });
});
