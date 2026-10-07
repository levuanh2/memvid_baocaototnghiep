// Fail-before for "Lưu sơ đồ cắt tiêu đề dài" — mindElixirToRecord must persist the
// canonical full title for an untouched node, never the canvas-compacted display
// string. Fake data only.
import { describe, it, expect } from "vitest";
import { recordToMindElixir, mindElixirToRecord } from "./mindElixirAdapter";

const LONG_TITLE = "Tiêu đề nhánh dài vượt quá giới hạn một trăm ký tự, có dấu tiếng Việt đầy đủ, dùng để kiểm tra việc lưu không làm mất chữ của node chưa bị người dùng đụng tới trong phiên này";

function baseRecord(extra = {}) {
  return {
    id: "m1", title: "Bản đồ", schema_version: 2, relations: [], sources: [],
    nodes: [
      { id: "root", kind: "root", title: "Gốc", parent: null, order: 0 },
      { id: "n1", kind: "section", title: LONG_TITLE, parent: "root", order: 0 },
    ],
    ...extra,
  };
}

describe("mindElixirToRecord preserves the full title across a real save round trip", () => {
  it("an untouched long-titled node keeps its full canonical title on save, not the canvas-compacted topic", () => {
    const record = baseRecord();
    const { mindData, sidecar } = recordToMindElixir(record); // what the canvas actually loads and renders
    // Sanity: the canvas topic IS compacted — this is the string "Lưu sơ đồ" used to send today.
    const n1Topic = mindData.nodeData.children[0].topic;
    expect(n1Topic.length).toBeLessThanOrEqual(100);
    expect(n1Topic.endsWith("…")).toBe(true);

    const saved = mindElixirToRecord(mindData, sidecar, record);
    const n1 = saved.nodes.find((n) => n.id === "n1");
    expect(n1.title).toBe(LONG_TITLE); // fails today: n1.title is the compacted topic instead
  });

  it("a node the user actually renamed saves the new live text, not the old canonical title", () => {
    const record = baseRecord();
    const { mindData, sidecar } = recordToMindElixir(record);
    mindData.nodeData.children[0].topic = "Tên mới do người dùng tự gõ";
    const saved = mindElixirToRecord(mindData, sidecar, record);
    const n1 = saved.nodes.find((n) => n.id === "n1");
    expect(n1.title).toBe("Tên mới do người dùng tự gõ");
  });

  it("a deliberately short rename is kept as-is, never 'restored' to the old long title", () => {
    const record = baseRecord();
    const { mindData, sidecar } = recordToMindElixir(record);
    mindData.nodeData.children[0].topic = "Ngắn";
    const saved = mindElixirToRecord(mindData, sidecar, record);
    const n1 = saved.nodes.find((n) => n.id === "n1");
    expect(n1.title).toBe("Ngắn");
  });

  it("a brand-new node (not in baseRecord) saves its own live title", () => {
    const record = baseRecord();
    const { mindData, sidecar } = recordToMindElixir(record);
    mindData.nodeData.children.push({ id: "n2", topic: "Node mới thêm trong phiên này", children: [] });
    const saved = mindElixirToRecord(mindData, sidecar, record);
    const n2 = saved.nodes.find((n) => n.id === "n2");
    expect(n2.title).toBe("Node mới thêm trong phiên này");
  });
});
