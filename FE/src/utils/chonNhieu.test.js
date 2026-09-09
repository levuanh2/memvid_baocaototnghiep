import { describe, it, expect } from "vitest";
import {
  batTat, chonTatCa, xoaChon, daChonHet, daChonMotPhan, locTheoHienThi,
  thanRequest, thayDoiLacQuan, phimDanhSach, nhanOChon, thongBaoDaChon,
  HANH_DONG, CAN_XAC_NHAN,
} from "./chonNhieu";

const d = (id) => ({ document_id: id });
const ds = [d("a"), d("b"), d("c")];

describe("chọn / bỏ chọn", () => {
  it("bật tắt một id", () => {
    let s = batTat(new Set(), "a");
    expect([...s]).toEqual(["a"]);
    s = batTat(s, "a");
    expect(s.size).toBe(0);
  });

  it("luôn trả Set MỚI — sửa tại chỗ là một lần render bị bỏ qua", () => {
    const goc = new Set(["a"]);
    const moi = batTat(goc, "b");
    expect(moi).not.toBe(goc);
    expect([...goc]).toEqual(["a"]);
  });

  it("chọn tất cả chỉ lấy phạm vi ĐANG HIỂN THỊ", () => {
    // Lọc còn 5 rồi bấm "Chọn tất cả" phải được 5. Chọn cả 300 tài liệu đang ẩn
    // rồi bấm Xoá là mất dữ liệu sau một cú bấm.
    expect([...chonTatCa(ds)]).toEqual(["a", "b", "c"]);
    expect([...chonTatCa([d("a")])]).toEqual(["a"]);
  });

  it("xoá chọn trả Set rỗng", () => {
    expect(xoaChon().size).toBe(0);
  });

  it("bỏ qua bản ghi thiếu id", () => {
    expect([...chonTatCa([{}, null, d("a")])]).toEqual(["a"]);
  });
});

describe("trạng thái ô chọn tất cả", () => {
  it("đã chọn hết", () => {
    expect(daChonHet(new Set(["a", "b", "c"]), ds)).toBe(true);
    expect(daChonHet(new Set(["a"]), ds)).toBe(false);
  });

  it("danh sách rỗng KHÔNG phải 'đã chọn hết'", () => {
    // `[].every()` là true — nếu không chặn, ô "chọn tất cả" tự tick khi màn hình
    // trống, và bấm vào nó thao tác trên không có gì.
    expect(daChonHet(new Set(), [])).toBe(false);
    expect(daChonHet(new Set(["a"]), [])).toBe(false);
  });

  it("chọn một phần", () => {
    expect(daChonMotPhan(new Set(["a"]), ds)).toBe(true);
    expect(daChonMotPhan(new Set(["a", "b", "c"]), ds)).toBe(false);
    expect(daChonMotPhan(new Set(), ds)).toBe(false);
  });
});

describe("locTheoHienThi", () => {
  it("bỏ id không còn hiển thị", () => {
    // Không có bước này thì một tài liệu đã lọc đi vẫn nằm trong lựa chọn, và
    // "Xoá 3 tài liệu" xoá một thứ người dùng không nhìn thấy.
    expect([...locTheoHienThi(new Set(["a", "z"]), ds)]).toEqual(["a"]);
  });

  it("danh sách hiển thị rỗng thì xoá sạch lựa chọn", () => {
    expect(locTheoHienThi(new Set(["a"]), []).size).toBe(0);
  });

  it("đầu vào null không nổ", () => {
    expect(locTheoHienThi(null, ds).size).toBe(0);
    expect(locTheoHienThi(new Set(["a"]), null).size).toBe(0);
  });
});

describe("thanRequest", () => {
  it("dựng thân cho hành động cờ", () => {
    expect(thanRequest("pin", ["a", "b"]))
      .toEqual({ document_ids: ["a", "b"], action: "pin" });
  });

  it("chuyển bộ sưu tập kèm null hợp lệ", () => {
    expect(thanRequest("move_collection", ["a"], { collectionId: "c1" }))
      .toEqual({ document_ids: ["a"], action: "move_collection", collection_id: "c1" });
    expect(thanRequest("move_collection", ["a"]).collection_id).toBeNull();
  });

  it("gắn/bỏ thẻ: cắt trắng, bỏ rỗng", () => {
    expect(thanRequest("add_tags", ["a"], { tags: ["  AI  ", "", "Exam"] }).tags)
      .toEqual(["AI", "Exam"]);
  });

  it("thẻ rỗng trả null thay vì gửi request chắc chắn 400", () => {
    // Máy chủ sẽ trả 400 và người dùng đọc một lỗi cho thao tác mà giao diện lẽ ra
    // phải chặn từ đầu.
    expect(thanRequest("add_tags", ["a"], { tags: [] })).toBeNull();
    expect(thanRequest("add_tags", ["a"], { tags: ["   "] })).toBeNull();
    expect(thanRequest("remove_tags", ["a"])).toBeNull();
  });

  it("không có id hoặc hành động lạ trả null", () => {
    expect(thanRequest("pin", [])).toBeNull();
    expect(thanRequest("pin", null)).toBeNull();
    expect(thanRequest("khong-co", ["a"])).toBeNull();
  });

  it("mọi hành động trong HANH_DONG dựng được thân hợp lệ", () => {
    for (const h of HANH_DONG) {
      const than = thanRequest(h.khoa, ["a"], { collectionId: "c1", tags: ["AI"] });
      expect(than, h.khoa).not.toBeNull();
      expect(than.action).toBe(h.khoa);
    }
  });
});

describe("thayDoiLacQuan", () => {
  it("cờ đơn giản áp được ngay", () => {
    expect(thayDoiLacQuan("pin")).toEqual({ pinned: true });
    expect(thayDoiLacQuan("unfavorite")).toEqual({ favorite: false });
    expect(thayDoiLacQuan("unarchive")).toEqual({ archived_at: null });
    expect(thayDoiLacQuan("archive").archived_at).toBeTruthy();
  });

  it("chuyển bộ sưu tập áp được", () => {
    expect(thayDoiLacQuan("move_collection", { collectionId: "c1" }))
      .toEqual({ collection_id: "c1" });
  });

  it("thẻ và xoá trả null — phải tải lại, không đoán", () => {
    // Thẻ hợp nhất theo TẬP ở máy chủ; đoán ở client là đoán sai.
    expect(thayDoiLacQuan("add_tags")).toBeNull();
    expect(thayDoiLacQuan("remove_tags")).toBeNull();
    expect(thayDoiLacQuan("delete")).toBeNull();
  });
});

describe("hành động hàng loạt", () => {
  it("không có hành động AI nào", () => {
    // Sinh tóm tắt cho 200 tài liệu một lúc là quyết định về chi phí và hàng đợi,
    // không phải một mục trong thanh công cụ.
    const txt = JSON.stringify(HANH_DONG).toLowerCase();
    for (const cam of ["summary", "mindmap", "quiz", "review", "tóm tắt", "ai"]) {
      expect(txt).not.toContain(cam);
    }
  });

  it("chỉ xoá mới cần xác nhận", () => {
    expect([...CAN_XAC_NHAN]).toEqual(["delete"]);
  });

  it("hành động nguy hiểm được đánh dấu", () => {
    expect(HANH_DONG.find((h) => h.khoa === "delete").nguyHiem).toBe(true);
  });

  it("khoá là duy nhất", () => {
    expect(new Set(HANH_DONG.map((h) => h.khoa)).size).toBe(HANH_DONG.length);
  });
});

describe("điều hướng bàn phím", () => {
  const k = (key, over = {}) => ({ key, altKey: false, ctrlKey: false, metaKey: false, ...over });

  it("mũi tên di chuyển focus và kẹp ở hai đầu", () => {
    expect(phimDanhSach(k("ArrowDown"), { chiSo: 0, tong: 3 }))
      .toEqual({ loai: "focus", chiSo: 1 });
    expect(phimDanhSach(k("ArrowDown"), { chiSo: 2, tong: 3 }).chiSo).toBe(2);
    expect(phimDanhSach(k("ArrowUp"), { chiSo: 0, tong: 3 }).chiSo).toBe(0);
  });

  it("Home/End nhảy hai đầu", () => {
    expect(phimDanhSach(k("Home"), { chiSo: 2, tong: 3 }).chiSo).toBe(0);
    expect(phimDanhSach(k("End"), { chiSo: 0, tong: 3 }).chiSo).toBe(2);
  });

  it("Space chọn, Enter mở — KHÔNG đảo ngược", () => {
    // Đảo hai phím này là cách chắc chắn nhất để ai đó xoá nhầm.
    expect(phimDanhSach(k(" "), { chiSo: 1, tong: 3 }).loai).toBe("chon");
    expect(phimDanhSach(k("Enter"), { chiSo: 1, tong: 3 }).loai).toBe("mo");
  });

  it("Escape xoá lựa chọn", () => {
    expect(phimDanhSach(k("Escape"), { chiSo: 0, tong: 3 }).loai).toBe("xoa_chon");
  });

  it("phím kèm modifier hoặc phím lạ trả null — trả quyền cho trình duyệt", () => {
    expect(phimDanhSach(k("ArrowDown", { ctrlKey: true }), { chiSo: 0, tong: 3 })).toBeNull();
    expect(phimDanhSach(k("ArrowDown", { metaKey: true }), { chiSo: 0, tong: 3 })).toBeNull();
    expect(phimDanhSach(k("a"), { chiSo: 0, tong: 3 })).toBeNull();
    expect(phimDanhSach(k("Tab"), { chiSo: 0, tong: 3 })).toBeNull();
    expect(phimDanhSach(null, { chiSo: 0, tong: 3 })).toBeNull();
  });

  it("danh sách rỗng không sinh chỉ số âm", () => {
    expect(phimDanhSach(k("End"), { chiSo: 0, tong: 0 }).chiSo).toBe(0);
    expect(phimDanhSach(k("ArrowDown"), { chiSo: 0, tong: 0 }).chiSo).toBe(0);
  });

  it("chiSo chưa đặt vẫn di chuyển được", () => {
    expect(phimDanhSach(k("ArrowDown"), { chiSo: null, tong: 3 }).chiSo).toBe(0);
  });
});

describe("trợ năng", () => {
  it("nhãn ô chọn nói rõ CHỌN CÁI GÌ", () => {
    // "Chọn" trần thì trình đọc màn hình đọc mười ô giống hệt nhau.
    expect(nhanOChon("Hệ điều hành", false)).toBe("Chọn Hệ điều hành");
    expect(nhanOChon("Hệ điều hành", true)).toBe("Bỏ chọn Hệ điều hành");
  });

  it("thiếu tên vẫn có nhãn dùng được", () => {
    expect(nhanOChon("", false)).toBe("Chọn tài liệu");
    expect(nhanOChon(null, true)).toBe("Bỏ chọn tài liệu");
  });

  it("thông báo vùng live rỗng khi không chọn gì", () => {
    expect(thongBaoDaChon(0)).toBe("");
    expect(thongBaoDaChon(3)).toBe("Đã chọn 3 tài liệu");
  });
});
