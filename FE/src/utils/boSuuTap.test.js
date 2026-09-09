import { describe, it, expect } from "vitest";
import {
  chiMucBoSuuTap, boSuuTapCua, boSuuTapChoThanhBen, theChoThanhBen,
  kiemTraTenBoSuuTap, hexMau, MAU, TEN_TOI_DA, KHONG_PHAN_LOAI,
} from "./boSuuTap";

const bst = (id, name, over = {}) => ({
  collection_id: id, name, color: null, icon: null, sort_order: 0,
  archived_at: null, created_at: "2026-09-01T00:00:00Z", document_count: 0, ...over,
});

const doc = (over = {}) => ({
  document_id: "d1", collection_id: null, tags: [], archived_at: null, ...over,
});

describe("chiMucBoSuuTap / boSuuTapCua", () => {
  it("tra được bộ sưu tập của tài liệu", () => {
    const idx = chiMucBoSuuTap([bst("c1", "Hệ điều hành")]);
    expect(boSuuTapCua(doc({ collection_id: "c1" }), idx).name).toBe("Hệ điều hành");
  });

  it("tài liệu chưa phân loại trả null", () => {
    const idx = chiMucBoSuuTap([bst("c1", "A")]);
    expect(boSuuTapCua(doc(), idx)).toBeNull();
  });

  it("id trỏ tới bộ sưu tập đã xoá trả null, không nổ", () => {
    const idx = chiMucBoSuuTap([]);
    expect(boSuuTapCua(doc({ collection_id: "da-xoa" }), idx)).toBeNull();
    expect(boSuuTapCua(null, idx)).toBeNull();
    expect(boSuuTapCua(doc({ collection_id: "c1" }), null)).toBeNull();
  });

  it("bỏ qua bản ghi hỏng", () => {
    expect(chiMucBoSuuTap([null, {}, "x", bst("c1", "A")]).size).toBe(1);
  });
});

describe("boSuuTapChoThanhBen", () => {
  const cs = [bst("c2", "B", { sort_order: 1 }), bst("c1", "A", { sort_order: 0 })];
  const ds = [
    doc({ document_id: "d1", collection_id: "c1" }),
    doc({ document_id: "d2", collection_id: "c1" }),
    doc({ document_id: "d3" }),
  ];

  it("đếm theo số tài liệu ĐANG HIỂN THỊ, không phải số của máy chủ", () => {
    // Bấm vào một bộ sưu tập ghi "5" rồi ra danh sách rỗng là lỗi khó chịu nhất
    // của thanh bên — số phải khớp thứ người dùng nhìn thấy.
    const { boSuuTap } = boSuuTapChoThanhBen(cs, ds);
    expect(boSuuTap.find((c) => c.collection_id === "c1").hien_thi_count).toBe(2);
    expect(boSuuTap.find((c) => c.collection_id === "c2").hien_thi_count).toBe(0);
  });

  it("đếm cả mục chưa phân loại", () => {
    expect(boSuuTapChoThanhBen(cs, ds).chuaPhanLoai).toBe(1);
  });

  it("sắp theo sort_order", () => {
    expect(boSuuTapChoThanhBen(cs, ds).boSuuTap.map((c) => c.name)).toEqual(["A", "B"]);
  });

  it("bộ sưu tập RỖNG vẫn hiện — tạo xong mà biến mất là lỗi", () => {
    const { boSuuTap } = boSuuTapChoThanhBen([bst("c9", "Rỗng")], []);
    expect(boSuuTap).toHaveLength(1);
    expect(boSuuTap[0].hien_thi_count).toBe(0);
  });

  it("bộ sưu tập đã lưu trữ bị giấu mặc định, hiện khi bật", () => {
    const luu = [bst("c1", "Cũ", { archived_at: "2026-09-01T00:00:00Z" })];
    expect(boSuuTapChoThanhBen(luu, []).boSuuTap).toHaveLength(0);
    expect(boSuuTapChoThanhBen(luu, [], { hienLuuTru: true }).boSuuTap).toHaveLength(1);
  });

  it("tài liệu đã lưu trữ không được tính vào số đếm mặc định", () => {
    const d = [doc({ collection_id: "c1", archived_at: "2026-09-01T00:00:00Z" })];
    expect(boSuuTapChoThanhBen(cs, d).boSuuTap[0].hien_thi_count).toBe(0);
    expect(boSuuTapChoThanhBen(cs, d, { hienLuuTru: true })
      .boSuuTap[0].hien_thi_count).toBe(1);
  });

  it("đầu vào rỗng/null không nổ", () => {
    expect(boSuuTapChoThanhBen(null, null).boSuuTap).toEqual([]);
    expect(boSuuTapChoThanhBen(null, null).chuaPhanLoai).toBe(0);
  });
});

describe("theChoThanhBen", () => {
  it("gộp thẻ từ chính các tài liệu — không có mảng thẻ riêng để lệch", () => {
    const ds = [doc({ tags: ["AI", "Exam"] }), doc({ tags: ["AI"] })];
    expect(theChoThanhBen(ds)).toEqual([
      { ten: "AI", khoa: "ai", so: 2 },
      { ten: "Exam", khoa: "exam", so: 1 },
    ]);
  });

  it("khử trùng không phân biệt hoa thường, giữ cách viết ĐẦU TIÊN", () => {
    // Cùng luật với máy chủ. Khác luật thì thanh bên hiện hai mục còn database
    // chỉ có một.
    const ds = [doc({ tags: ["AI"] }), doc({ tags: ["ai"] }), doc({ tags: ["Ai"] })];
    expect(theChoThanhBen(ds)).toEqual([{ ten: "AI", khoa: "ai", so: 3 }]);
  });

  it("nhiều nhất trước, rồi theo bảng chữ cái không dấu", () => {
    const ds = [doc({ tags: ["Zebra", "Ôn tập", "Ôn tập"] }), doc({ tags: ["Ôn tập"] })];
    expect(theChoThanhBen(ds).map((t) => t.ten)).toEqual(["Ôn tập", "Zebra"]);
  });

  it("bỏ thẻ rỗng và không phải chuỗi", () => {
    expect(theChoThanhBen([doc({ tags: ["  ", "", null, 5, "thật"] })]))
      .toEqual([{ ten: "thật", khoa: "thật", so: 1 }]);
  });

  it("tài liệu đã lưu trữ không tính mặc định", () => {
    const ds = [doc({ tags: ["AI"], archived_at: "2026-09-01T00:00:00Z" })];
    expect(theChoThanhBen(ds)).toEqual([]);
    expect(theChoThanhBen(ds, { hienLuuTru: true })).toHaveLength(1);
  });

  it("đầu vào rỗng/hỏng không nổ", () => {
    expect(theChoThanhBen(null)).toEqual([]);
    expect(theChoThanhBen([{}, null, doc({ tags: "khong-phai-mang" })])).toEqual([]);
  });
});

describe("kiemTraTenBoSuuTap", () => {
  it("cắt trắng và chấp nhận", () => {
    expect(kiemTraTenBoSuuTap("  Giải tích  ")).toMatchObject({
      hopLe: true, giaTri: "Giải tích",
    });
  });

  it("tên rỗng bị từ chối", () => {
    expect(kiemTraTenBoSuuTap("").hopLe).toBe(false);
    expect(kiemTraTenBoSuuTap("   ").loi).toBeTruthy();
  });

  it("đúng 100 ký tự được, 101 thì không", () => {
    expect(kiemTraTenBoSuuTap("x".repeat(TEN_TOI_DA)).hopLe).toBe(true);
    expect(kiemTraTenBoSuuTap("x".repeat(TEN_TOI_DA + 1)).hopLe).toBe(false);
  });

  it("không đổi thì không gọi mạng", () => {
    expect(kiemTraTenBoSuuTap("A", "A")).toMatchObject({ hopLe: false, khongDoi: true });
    expect(kiemTraTenBoSuuTap("  A  ", "A").khongDoi).toBe(true);
  });
});

describe("màu", () => {
  it("mỗi màu có khoá, nhãn và hex hợp lệ", () => {
    for (const m of MAU) {
      expect(m.khoa).toBeTruthy();
      expect(m.nhan).toBeTruthy();
      expect(m.hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("khoá lạ hoặc thiếu lùi về xám, không bao giờ undefined", () => {
    // Một bộ sưu tập không có màu vẫn phải nhìn thấy được.
    expect(hexMau("khong-co")).toBe(MAU[0].hex);
    expect(hexMau(null)).toBe(MAU[0].hex);
    expect(hexMau(undefined)).toBe(MAU[0].hex);
  });

  it("khoá màu là duy nhất", () => {
    expect(new Set(MAU.map((m) => m.khoa)).size).toBe(MAU.length);
  });
});

describe("KHONG_PHAN_LOAI", () => {
  it("là hằng ổn định, không đụng id thật", () => {
    expect(KHONG_PHAN_LOAI).toBe("__khong_phan_loai__");
  });
});
