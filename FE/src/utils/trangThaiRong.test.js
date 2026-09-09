import { describe, it, expect } from "vitest";
import { trangThaiRong, nguCanhTuBoLoc, NGU_CANH } from "./trangThaiRong";

describe("trangThaiRong", () => {
  it("thư viện trống thật thì mời TẢI LÊN", () => {
    const t = trangThaiRong(NGU_CANH.THU_VIEN, { coTaiLieu: false });
    expect(t.tieuDe).toBe("Chưa có tài liệu nào");
    expect(t.khoaHanhDong).toBe("tai_len");
  });

  it("có tài liệu nhưng lọc hết thì mời NỚI BỘ LỌC, không mời tải lên", () => {
    // Người có đủ tài liệu mà đọc "Chưa có tài liệu nào" sẽ đi tải lên lại từ đầu.
    const t = trangThaiRong(NGU_CANH.THU_VIEN, { coTaiLieu: true });
    expect(t.tieuDe).toBe("Không có tài liệu nào khớp");
    expect(t.khoaHanhDong).toBe("xoa_loc");
  });

  it("mọi ngữ cảnh đều có icon, tiêu đề và gợi ý", () => {
    for (const nc of Object.values(NGU_CANH)) {
      const t = trangThaiRong(nc);
      expect(t.icon, nc).toBeTruthy();
      expect(t.tieuDe, nc).toBeTruthy();
      expect(t.goiY, nc).toBeTruthy();
    }
  });

  it("ngữ cảnh có lối ra thì kèm hành động cụ thể", () => {
    for (const nc of [NGU_CANH.BO_LOC, NGU_CANH.BO_SUU_TAP, NGU_CANH.YEU_THICH,
                      NGU_CANH.GHIM, NGU_CANH.GAN_DAY]) {
      const t = trangThaiRong(nc);
      expect(t.hanhDong, nc).toBeTruthy();
      expect(t.khoaHanhDong, nc).toBeTruthy();
    }
  });

  it("lưu trữ nói rõ nó KHÔNG phải xoá", () => {
    // Hiểu nhầm phổ biến nhất về nút này — và tài liệu đã lưu trữ vẫn được AI dùng.
    const t = trangThaiRong(NGU_CANH.LUU_TRU);
    expect(t.goiY).toContain("không xoá");
    expect(t.goiY).toContain("AI");
  });

  it("mục 'cần X' rỗng là TIN TỐT, không phải lỗi", () => {
    expect(trangThaiRong(NGU_CANH.CAN_TOM_TAT).tieuDe).toContain("đều đã có");
    expect(trangThaiRong(NGU_CANH.CAN_SO_DO).tieuDe).toContain("đều đã có");
  });

  it("ngữ cảnh lạ lùi về thư viện thay vì trả undefined", () => {
    expect(trangThaiRong("khong-ton-tai").tieuDe).toBeTruthy();
    expect(trangThaiRong(null).tieuDe).toBeTruthy();
  });

  it("trả bản sao — sửa kết quả không làm hỏng lần gọi sau", () => {
    const a = trangThaiRong(NGU_CANH.THU_VIEN);
    a.tieuDe = "đã sửa";
    expect(trangThaiRong(NGU_CANH.THU_VIEN).tieuDe).toBe("Chưa có tài liệu nào");
  });
});

describe("nguCanhTuBoLoc", () => {
  it("truy vấn thắng mọi bộ lọc khác", () => {
    expect(nguCanhTuBoLoc({ truyVan: "abc", collectionId: "c1" })).toBe(NGU_CANH.BO_LOC);
  });

  it("khoảng trắng không tính là truy vấn", () => {
    expect(nguCanhTuBoLoc({ truyVan: "   ", khoa: ["favorite"] })).toBe(NGU_CANH.YEU_THICH);
  });

  it("bộ sưu tập", () => {
    expect(nguCanhTuBoLoc({ collectionId: "c1" })).toBe(NGU_CANH.BO_SUU_TAP);
  });

  it.each([
    [["favorite"], NGU_CANH.YEU_THICH],
    [["pinned"], NGU_CANH.GHIM],
    [["archived"], NGU_CANH.LUU_TRU],
    [["recent"], NGU_CANH.GAN_DAY],
    [["pdf"], NGU_CANH.BO_LOC],
  ])("bộ lọc %j → %s", (khoa, mong) => {
    expect(nguCanhTuBoLoc({ khoa })).toBe(mong);
  });

  it("thẻ", () => {
    expect(nguCanhTuBoLoc({ tags: ["AI"] })).toBe(NGU_CANH.BO_LOC);
  });

  it("không lọc gì → thư viện", () => {
    expect(nguCanhTuBoLoc({})).toBe(NGU_CANH.THU_VIEN);
    expect(nguCanhTuBoLoc()).toBe(NGU_CANH.THU_VIEN);
  });
});
