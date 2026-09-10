import { describe, expect, it } from "vitest";
import { TRANG_THAI_RONG, ghiCauHoi, ghiChuDe, ghiNode, ghiThucThe } from "./tutorMemory";

describe("tutorMemory — nhật ký phiên, thuần, không React", () => {
  it("trạng thái rỗng có đủ bốn danh sách, đều rỗng", () => {
    expect(TRANG_THAI_RONG).toEqual({
      recentQuestions: [], openedTopics: [], visitedNodes: [], selectedEntities: [],
    });
  });

  it("ghi một mục đẩy nó lên đầu, không sửa state gốc", () => {
    const s0 = TRANG_THAI_RONG;
    const s1 = ghiChuDe(s0, "Định thời", 100);
    expect(s1).not.toBe(s0);
    expect(s0.openedTopics).toEqual([]);
    expect(s1.openedTopics).toEqual([{ value: "Định thời", at: 100 }]);
  });

  it("ghi trùng giá trị thì gộp lại (đưa lên đầu, không nhân đôi)", () => {
    let s = ghiChuDe(TRANG_THAI_RONG, "A", 1);
    s = ghiChuDe(s, "B", 2);
    s = ghiChuDe(s, "A", 3);
    expect(s.openedTopics).toEqual([{ value: "A", at: 3 }, { value: "B", at: 2 }]);
  });

  it("quá 8 mục thì cắt bớt, giữ 8 mục MỚI NHẤT", () => {
    let s = TRANG_THAI_RONG;
    for (let i = 0; i < 10; i++) s = ghiNode(s, `n${i}`, i);
    expect(s.visitedNodes).toHaveLength(8);
    expect(s.visitedNodes[0]).toEqual({ value: "n9", at: 9 });
    expect(s.visitedNodes.at(-1)).toEqual({ value: "n2", at: 2 });
  });

  it("giá trị rỗng/null là no-op", () => {
    expect(ghiChuDe(TRANG_THAI_RONG, null)).toBe(TRANG_THAI_RONG);
    expect(ghiThucThe(TRANG_THAI_RONG, "")).toBe(TRANG_THAI_RONG);
  });

  it("ghiCauHoi thiếu text thì dùng lại id làm nhãn", () => {
    const s = ghiCauHoi(TRANG_THAI_RONG, "explain-cpu", undefined, 5);
    expect(s.recentQuestions).toEqual([{ id: "explain-cpu", text: "explain-cpu", at: 5 }]);
  });

  it("bốn danh sách độc lập nhau — ghi cái này không đụng cái khác", () => {
    let s = ghiChuDe(TRANG_THAI_RONG, "X", 1);
    s = ghiThucThe(s, "Y", 2);
    expect(s.openedTopics).toEqual([{ value: "X", at: 1 }]);
    expect(s.selectedEntities).toEqual([{ value: "Y", at: 2 }]);
    expect(s.recentQuestions).toEqual([]);
    expect(s.visitedNodes).toEqual([]);
  });
});
