import { describe, expect, it } from "vitest";

import { lienQuanCuaNode } from "./studyMapGraph";

const node = (id, parent) => ({ node_id: id, parent_node_id: parent, title: id });

//        r
//      /   \
//     a     b
//    / \     \
//   c   d     e
const NODES = [
  node("r", null), node("a", "r"), node("b", "r"),
  node("c", "a"), node("d", "a"), node("e", "b"),
];

describe("lienQuanCuaNode — MỘT truy vết duy nhất, dùng chung focus/tìm/breadcrumb", () => {
  it("nút giữa cây: tổ tiên đi từ gốc, hậu duệ gồm mọi tầng bên dưới", () => {
    const kq = lienQuanCuaNode("a", NODES);
    expect(kq.ancestors).toEqual(["r"]);
    expect([...kq.descendants].sort()).toEqual(["c", "d"]);
    expect([...kq.all].sort()).toEqual(["a", "c", "d", "r"]);
  });

  it("nút gốc: không tổ tiên, hậu duệ là cả cây còn lại", () => {
    const kq = lienQuanCuaNode("r", NODES);
    expect(kq.ancestors).toEqual([]);
    expect([...kq.descendants].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("nút lá: không hậu duệ, tổ tiên đúng thứ tự gốc→cha (dùng được làm breadcrumb)", () => {
    const kq = lienQuanCuaNode("c", NODES);
    expect(kq.ancestors).toEqual(["r", "a"]);
    expect([...kq.descendants]).toEqual([]);
    expect([...kq.all].sort()).toEqual(["a", "c", "r"]);
  });

  it("hai nhánh anh em không lẫn vào nhau", () => {
    const tuA = lienQuanCuaNode("a", NODES);
    const tuB = lienQuanCuaNode("b", NODES);
    expect(tuA.descendants.has("e")).toBe(false);
    expect(tuB.descendants.has("c")).toBe(false);
  });

  it("id rỗng hoặc không tồn tại trả tập rỗng, không ném", () => {
    expect(lienQuanCuaNode(null, NODES)).toEqual({ ancestors: [], descendants: new Set(), all: new Set() });
    expect(lienQuanCuaNode("khong-co", NODES)).toEqual({ ancestors: [], descendants: new Set(), all: new Set() });
    expect(lienQuanCuaNode("a", null).all instanceof Set).toBe(true);
  });

  it("vòng lặp cha-con hỏng không treo (dừng thay vì lặp vô hạn)", () => {
    const vong = [node("x", "y"), node("y", "x")];
    expect(() => lienQuanCuaNode("x", vong)).not.toThrow();
    expect(lienQuanCuaNode("x", vong).ancestors.length).toBeLessThan(10);
  });

  it("không sửa mảng node truyền vào", () => {
    const before = JSON.stringify(NODES);
    lienQuanCuaNode("a", NODES);
    expect(JSON.stringify(NODES)).toBe(before);
  });
});
