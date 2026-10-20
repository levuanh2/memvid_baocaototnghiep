// @vitest-environment jsdom
// PR A red tests (fail-before on origin/main). Fake data only.
import { describe, it, expect, vi } from "vitest";
import { exportMindmapImage, captureMapImageBase64 } from "./mindmapImageExport";
import { compactTopic } from "./mindmapLayout";

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
    el.appendChild(this.map);
    this.layout = vi.fn(); this.linkDiv = vi.fn(); this.scaleFit = vi.fn(); this.destroy = vi.fn();
    FakeOffscreenMind.instances.push(this);
  }
  init(data) {
    this.initNodeData = data?.nodeData;
    this.nodeData = data?.nodeData;
    this.map.replaceChildren();
    const addTopics = (node) => {
      if (!node?.id) return;
      const topic = document.createElement("me-tpc");
      topic.nodeObj = { id: node.id };
      topic.dataset.nodeid = `me${node.id}`;
      topic.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40 });
      this.map.appendChild(topic);
      (node.children || []).forEach(addTopics);
    };
    addTopics(this.nodeData);
  }
}
FakeOffscreenMind.instances = [];

class MissingDomIdentityMind extends FakeOffscreenMind {
  init(data) {
    super.init(data);
    this.map.querySelectorAll("me-tpc").forEach((topic) => {
      delete topic.nodeObj;
      topic.removeAttribute("data-nodeid");
    });
  }
}

class MismatchedDomIdentityMind extends FakeOffscreenMind {
  init(data) {
    super.init(data);
    const topic = this.map.querySelector("me-tpc");
    topic.nodeObj = { id: "outside-scope" };
  }
}

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


describe("selected_branches image export preserves full titles (same bug PR #60 fixed for save)", () => {
  it("defaults omitted selected_branches descendant policy to exact membership", async () => {
    const mind = makeMind();
    mind.nodeData = {
      id: "root", topic: "Root", expanded: true,
      children: [{
        id: "p", topic: "P", expanded: true,
        children: [
          { id: "a", topic: "A", children: [] },
          { id: "b", topic: "B", children: [] },
          { id: "c", topic: "C", children: [] },
          { id: "d", topic: "D", children: [] },
        ],
      }],
    };
    const record = {
      id: "m1", title: "Map", schema_version: 2, relations: [], sources: [],
      nodes: [
        { id: "root", kind: "root", title: "Root", parent: null },
        { id: "p", kind: "section", title: "P", parent: "root" },
        { id: "a", kind: "idea", title: "A", parent: "p" },
        { id: "b", kind: "idea", title: "B", parent: "p" },
        { id: "c", kind: "idea", title: "C", parent: "p" },
        { id: "d", kind: "idea", title: "D", parent: "p" },
      ],
    };
    await exportMindmapImage({
      mind, record, scopeType: "selected_branches", branchRootIds: ["b", "c"],
      format: "svg", backgroundColor: "#fff", snapdom: fakeSnapdom([]), settleMs: 0,
      MindElixirCtor: FakeOffscreenMind,
    });
    const exported = FakeOffscreenMind.instances.at(-1).initNodeData;
    const ids = [];
    (function walk(node) { ids.push(node.id); (node.children || []).forEach(walk); })(exported);
    expect(ids).toEqual(["p", "b", "c"]);
  });

  it.each(["png", "svg"])("%s keeps P as context, excludes sibling C, and crops to scoped content", async (format) => {
    const mind = makeMind();
    mind.nodeData = {
      id: "root", topic: "Root", expanded: true,
      children: [{
        id: "p", topic: "P", expanded: true,
        children: [
          { id: "a", topic: "A", expanded: true, children: [] },
          { id: "b", topic: "B", expanded: true, children: [] },
          { id: "c", topic: "C", expanded: true, children: [] },
        ],
      }],
    };
    const record = {
      id: "m1", title: "Map", schema_version: 2, relations: [], sources: [],
      nodes: [
        { id: "root", kind: "root", title: "Root", parent: null },
        { id: "p", kind: "section", title: "P", parent: "root" },
        { id: "a", kind: "idea", title: "A", parent: "p" },
        { id: "b", kind: "idea", title: "B", parent: "p" },
        { id: "c", kind: "idea", title: "C", parent: "p" },
      ],
    };
    const targets = [];

    await exportMindmapImage({
      mind, record, scopeType: "selected_branches", branchRootIds: ["a", "b"],
      format, backgroundColor: "#fff", snapdom: fakeSnapdom(targets), settleMs: 0,
      MindElixirCtor: FakeOffscreenMind,
    });

    const exported = FakeOffscreenMind.instances.at(-1).initNodeData;
    const ids = [];
    (function walk(node) { ids.push(node.id); (node.children || []).forEach(walk); })(exported);
    expect(ids).toEqual(["p", "a", "b"]);
    expect(ids).not.toContain("c");
    expect(targets[0].style.width).toBe("264px");
    expect(targets[0].style.height).toBe("104px");
  });

  it("does not read the canvas-compacted topic for an untouched node's title with 2+ selected branches", async () => {
    const longTitleA = "Tiêu đề nhánh A rất dài vượt quá giới hạn một trăm ký tự, dùng để kiểm tra xuất nhiều nhánh không bị cắt chữ của node chưa chỉnh sửa";
    const longTitleB = "Tiêu đề nhánh B cũng rất dài tương tự, viết bằng tiếng Việt có dấu, cho một nhánh khác được chọn cùng lúc trong Export Studio";
    const mind = makeMind();
    mind.nodeData = {
      id: "root", topic: "Root", expanded: true,
      children: [
        { id: "a", topic: compactTopic(longTitleA), expanded: true, children: [] },
        { id: "b", topic: compactTopic(longTitleB), expanded: true, children: [] },
      ],
    };
    const record = {
      id: "m1", title: "Bản đồ", schema_version: 2, relations: [], sources: [],
      nodes: [
        { id: "root", kind: "root", title: "Root", parent: null },
        { id: "a", kind: "section", title: longTitleA, parent: "root" },
        { id: "b", kind: "section", title: longTitleB, parent: "root" },
      ],
    };
    const targets = [];
    await exportMindmapImage({
      mind, record, scopeType: "selected_branches", branchRootIds: ["a", "b"],
      format: "png", backgroundColor: "#fff", snapdom: fakeSnapdom(targets), settleMs: 0, MindElixirCtor: FakeOffscreenMind,
    });
    const exported = FakeOffscreenMind.instances.at(-1).initNodeData;
    const byId = new Map();
    (function walk(n) { byId.set(n.id, n.topic); (n.children || []).forEach(walk); })(exported);
    expect(byId.get("a")).toBe(longTitleA);
    expect(byId.get("b")).toBe(longTitleB);
  });
});

describe("full-map export reflects unsaved live edits without truncating untouched titles", () => {
  it("includes a live-renamed node and a live-added node, and drops a node deleted live", async () => {
    const longTitle = "Tiêu đề rất dài vượt quá giới hạn rút gọn trên canvas để kiểm tra khôi phục đầy đủ khi xuất file ngay cả khi node đó chưa được chỉnh sửa trong phiên làm việc này";
    const record = {
      id: "m1", title: "Bản đồ", schema_version: 2, relations: [], sources: [],
      nodes: [
        { id: "root", kind: "root", title: "Root", parent: null },
        { id: "a", kind: "section", title: "Tên cũ", parent: "root" },
        { id: "a1", kind: "idea", title: longTitle, parent: "a" },
      ],
    };
    const mind = makeMind();
    mind.nodeData = {
      id: "root", topic: "Root", expanded: true,
      children: [
        // "a" renamed live (its saved title "Tên cũ" no longer matches); "a1" deleted live; "b-new" added live.
        { id: "a", topic: "Tên nhánh vừa đổi, chưa lưu", expanded: true, children: [] },
        { id: "b-new", topic: "Node mới thêm, chưa lưu", expanded: true, children: [] },
      ],
    };
    const targets = [];
    await exportMindmapImage({ mind, record, scopeType: "full", format: "png", backgroundColor: "#fff", snapdom: fakeSnapdom(targets), settleMs: 0, MindElixirCtor: FakeOffscreenMind });
    const exported = FakeOffscreenMind.instances.at(-1).initNodeData;
    const byId = new Map();
    (function walk(n) { byId.set(n.id, n.topic); (n.children || []).forEach(walk); })(exported);
    expect(byId.get("a")).toBe("Tên nhánh vừa đổi, chưa lưu");
    expect(byId.get("b-new")).toBe("Node mới thêm, chưa lưu");
    expect(byId.has("a1")).toBe(false); // deleted live; export must not resurrect it from the saved record
  });

  it("recovers the full saved title for a node whose live topic is still exactly its compacted form", async () => {
    const longTitle = "Một tiêu đề khác, cũng rất dài, dùng để xác nhận riêng việc khôi phục tiêu đề đầy đủ hoạt động đúng cho trường hợp node hoàn toàn chưa bị đụng tới";
    const record = {
      id: "m1", title: "Bản đồ", schema_version: 2, relations: [], sources: [],
      nodes: [
        { id: "root", kind: "root", title: "Root", parent: null },
        { id: "a", kind: "section", title: longTitle, parent: "root" },
      ],
    };
    const mind = makeMind();
    mind.nodeData = { id: "root", topic: "Root", expanded: true, children: [{ id: "a", topic: compactTopic(longTitle), expanded: true, children: [] }] };
    const targets = [];
    await exportMindmapImage({ mind, record, scopeType: "full", format: "png", backgroundColor: "#fff", snapdom: fakeSnapdom(targets), settleMs: 0, MindElixirCtor: FakeOffscreenMind });
    const exported = FakeOffscreenMind.instances.at(-1).initNodeData;
    expect(exported.children[0].topic).toBe(longTitle);
    expect(exported.children[0].topic.endsWith("…")).toBe(false);
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

describe("offscreen DOM membership is fail-closed", () => {
  it("rejects a renderer whose topic DOM exposes no node identity", async () => {
    const mind = makeMind();
    await expect(exportMindmapImage({
      mind, record: RECORD, scopeType: "full", format: "png", backgroundColor: "#fff",
      snapdom: fakeSnapdom([]), settleMs: 0, MindElixirCtor: MissingDomIdentityMind,
    })).rejects.toThrow(/identity|danh tính|node/i);
  });

  it("rejects a renderer whose DOM identity differs from the canonical record", async () => {
    const mind = makeMind();
    await expect(exportMindmapImage({
      mind, record: RECORD, scopeType: "full", format: "png", backgroundColor: "#fff",
      snapdom: fakeSnapdom([]), settleMs: 0, MindElixirCtor: MismatchedDomIdentityMind,
    })).rejects.toThrow(/ngoài phạm vi|node/i);
  });
});
