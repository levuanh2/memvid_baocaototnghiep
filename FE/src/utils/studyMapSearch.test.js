import { describe, expect, it } from "vitest";

import { diChuyenKetQua, phimTimKiemStudyMap, timStudyMap } from "./studyMapSearch";

const node = (id, title) => ({ node_id: id, title });
const NODES = [
  node("1", "Định thời CPU"), node("2", "Hàng đợi FIFO"),
  node("3", "định thời round robin"), node("4", "Bộ nhớ ảo"),
];

describe("timStudyMap — mô hình dùng chung cho bàn phím / thanh trạng thái / command palette", () => {
  it("khớp không phân biệt hoa/thường/dấu, trả đúng hình dạng {matches, activeIndex, total}", () => {
    const kq = timStudyMap(NODES, "dinh thoi");
    expect(kq.matches).toEqual(["1", "3"]);
    expect(kq.activeIndex).toBe(0);
    expect(kq.total).toBe(2);
  });

  it("không khớp gì thì activeIndex là -1, total 0, matches rỗng", () => {
    expect(timStudyMap(NODES, "khong-co-gi")).toEqual({ matches: [], activeIndex: -1, total: 0 });
  });

  it("truy vấn rỗng hoặc chỉ khoảng trắng KHÔNG khớp tất cả — coi như chưa tìm", () => {
    expect(timStudyMap(NODES, "")).toEqual({ matches: [], activeIndex: -1, total: 0 });
    expect(timStudyMap(NODES, "   ")).toEqual({ matches: [], activeIndex: -1, total: 0 });
  });

  it("tolerates dữ liệu node hỏng/thiếu title mà không ném", () => {
    expect(() => timStudyMap([null, {}, node("5", null)], "x")).not.toThrow();
    expect(timStudyMap(null, "x")).toEqual({ matches: [], activeIndex: -1, total: 0 });
  });
});

describe("diChuyenKetQua — điều hướng vòng, không văng ra ngoài mảng", () => {
  const KQ = { matches: ["a", "b", "c"], activeIndex: 0, total: 3 };

  it("tiến (+1) và lùi (-1) đúng chỉ số", () => {
    expect(diChuyenKetQua(KQ, 1).activeIndex).toBe(1);
    expect(diChuyenKetQua(KQ, -1).activeIndex).toBe(2);   // lùi từ 0 vòng về cuối
  });

  it("vòng qua đầu/cuối danh sách", () => {
    expect(diChuyenKetQua({ ...KQ, activeIndex: 2 }, 1).activeIndex).toBe(0);
  });

  it("không có kết quả nào thì giữ nguyên, không ném", () => {
    const rong = { matches: [], activeIndex: -1, total: 0 };
    expect(diChuyenKetQua(rong, 1)).toEqual(rong);
  });
});

describe("phimTimKiemStudyMap — dịch phím thành hành động, không tự chạy hành động", () => {
  it("mũi tên/Enter/Escape đúng ý nghĩa", () => {
    expect(phimTimKiemStudyMap({ key: "ArrowDown" })).toEqual({ loai: "tiep" });
    expect(phimTimKiemStudyMap({ key: "ArrowUp" })).toEqual({ loai: "truoc" });
    expect(phimTimKiemStudyMap({ key: "Enter" })).toEqual({ loai: "nhay" });
    expect(phimTimKiemStudyMap({ key: "Escape" })).toEqual({ loai: "xoa" });
  });

  it("phím khác hoặc tổ hợp Ctrl/Cmd không sinh hành động", () => {
    expect(phimTimKiemStudyMap({ key: "a" })).toBeNull();
    expect(phimTimKiemStudyMap({ key: "Enter", ctrlKey: true })).toBeNull();
    expect(phimTimKiemStudyMap(null)).toBeNull();
  });
});
