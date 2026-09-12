import { describe, expect, it } from "vitest";
import { docLichSu, ghiLichSu, themTimKiem, themLenh, TRANG_THAI_RONG } from "./commandHistory";

function boNhoGia() {
  const kho = new Map();
  return {
    getItem: (k) => (kho.has(k) ? kho.get(k) : null),
    setItem: (k, v) => kho.set(k, v),
  };
}

describe("docLichSu", () => {
  it("chưa có gì -> trạng thái rỗng", () => {
    expect(docLichSu(boNhoGia())).toEqual(TRANG_THAI_RONG);
  });
  it("storage null/undefined -> rỗng, không throw", () => {
    expect(docLichSu(null)).toEqual(TRANG_THAI_RONG);
    expect(docLichSu(undefined)).toEqual(TRANG_THAI_RONG);
  });
  it("JSON hỏng -> rỗng, không throw", () => {
    const s = boNhoGia();
    s.setItem("memvidx.palette.history.v1", "{khong hop le");
    expect(docLichSu(s)).toEqual(TRANG_THAI_RONG);
  });
  it("đọc lại đúng cái vừa ghi", () => {
    const s = boNhoGia();
    ghiLichSu(s, { timKiem: ["cpu"], lenh: [{ id: "x", label: "X", luc: 1 }] });
    expect(docLichSu(s)).toEqual({ timKiem: ["cpu"], lenh: [{ id: "x", label: "X", luc: 1 }] });
  });
});

describe("ghiLichSu", () => {
  it("storage ném lỗi (đầy/bị chặn) -> không throw", () => {
    const s = { setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(() => ghiLichSu(s, TRANG_THAI_RONG)).not.toThrow();
  });
});

describe("themTimKiem", () => {
  it("đẩy lên đầu, gộp trùng, cắt còn 10", () => {
    let s = TRANG_THAI_RONG;
    for (let i = 0; i < 12; i++) s = themTimKiem(s, `q${i}`);
    expect(s.timKiem).toHaveLength(10);
    expect(s.timKiem[0]).toBe("q11");
  });
  it("chuỗi rỗng -> no-op", () => {
    expect(themTimKiem(TRANG_THAI_RONG, "  ")).toBe(TRANG_THAI_RONG);
  });
  it("tìm lại đúng chuỗi cũ chỉ đẩy lên đầu, không nhân đôi", () => {
    let s = themTimKiem(TRANG_THAI_RONG, "a");
    s = themTimKiem(s, "b");
    s = themTimKiem(s, "a");
    expect(s.timKiem).toEqual(["a", "b"]);
  });
});

describe("themLenh", () => {
  it("gộp trùng theo id, không theo nhãn", () => {
    let s = themLenh(TRANG_THAI_RONG, "mo-tai-lieu", "Mở tài liệu");
    s = themLenh(s, "mo-tai-lieu", "Mở tài liệu (đổi nhãn)");
    expect(s.lenh).toHaveLength(1);
    expect(s.lenh[0].label).toBe("Mở tài liệu (đổi nhãn)");
  });
  it("thiếu id -> no-op", () => {
    expect(themLenh(TRANG_THAI_RONG, null, "X")).toBe(TRANG_THAI_RONG);
  });
});
