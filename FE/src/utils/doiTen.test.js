import { describe, it, expect } from "vitest";
import { kiemTraTen, apDungLacQuan, DAI_TOI_DA } from "./doiTen";

describe("kiemTraTen", () => {
  it("cắt khoảng trắng hai đầu", () => {
    const r = kiemTraTen("  Hệ điều hành  ", null);
    expect(r).toMatchObject({ hopLe: true, giaTri: "Hệ điều hành", loi: null });
  });

  it("ô trống KHI ĐANG có tên đặt = xoá tên, hợp lệ", () => {
    const r = kiemTraTen("   ", "Tên cũ");
    expect(r.hopLe).toBe(true);
    expect(r.giaTri).toBeNull();      // null → máy chủ lùi về `title`
  });

  it("ô trống khi chưa từng đặt tên = không có gì để làm", () => {
    const r = kiemTraTen("", null);
    expect(r.hopLe).toBe(false);
    expect(r.khongDoi).toBe(true);
    expect(r.loi).toBeNull();          // không phải lỗi, chỉ là không đổi
  });

  it("đúng 200 ký tự được chấp nhận, 201 thì không", () => {
    expect(kiemTraTen("x".repeat(DAI_TOI_DA), null).hopLe).toBe(true);
    const qua = kiemTraTen("x".repeat(DAI_TOI_DA + 1), null);
    expect(qua.hopLe).toBe(false);
    expect(qua.loi).toContain("200");
  });

  it("không đổi gì thì không gọi mạng", () => {
    // Một request không đổi gì vẫn có thể hỏng, và lúc đó màn hình báo lỗi cho một
    // thao tác người dùng không hề thực hiện.
    const r = kiemTraTen("Giữ nguyên", "Giữ nguyên");
    expect(r.hopLe).toBe(false);
    expect(r.khongDoi).toBe(true);
  });

  it("chỉ khác khoảng trắng cũng là không đổi", () => {
    expect(kiemTraTen("  Giữ nguyên  ", "Giữ nguyên").khongDoi).toBe(true);
  });

  it("tên trùng tài liệu khác vẫn hợp lệ — không ép duy nhất", () => {
    expect(kiemTraTen("Trùng tên", "Khác").hopLe).toBe(true);
  });

  it("chịu được null/undefined/số", () => {
    expect(kiemTraTen(null, null).khongDoi).toBe(true);
    expect(kiemTraTen(undefined, null).khongDoi).toBe(true);
    expect(kiemTraTen(42, null)).toMatchObject({ hopLe: true, giaTri: "42" });
  });
});

describe("apDungLacQuan", () => {
  const ds = [
    { document_id: "a", display_name: "A cũ", favorite: false },
    { document_id: "b", display_name: "B", favorite: false },
  ];

  it("áp thay đổi cho đúng một tài liệu", () => {
    const { danhSachMoi } = apDungLacQuan(ds, "a", { display_name: "A mới" });
    expect(danhSachMoi[0].display_name).toBe("A mới");
    expect(danhSachMoi[1].display_name).toBe("B");
  });

  it("không sửa mảng gốc", () => {
    const ban = JSON.parse(JSON.stringify(ds));
    apDungLacQuan(ds, "a", { display_name: "A mới" });
    expect(ds).toEqual(ban);
  });

  it("hoàn tác khôi phục ĐÚNG giá trị cũ", () => {
    // PATCH hỏng thường vì mất mạng — lúc đó không tải lại được gì từ máy chủ, nên
    // đường lùi phải mang sẵn giá trị cũ.
    const { danhSachMoi, hoanTac } = apDungLacQuan(ds, "a", { display_name: "A mới" });
    expect(hoanTac(danhSachMoi)[0].display_name).toBe("A cũ");
  });

  it("hoàn tác chỉ chạm tài liệu đã đổi", () => {
    const { danhSachMoi, hoanTac } = apDungLacQuan(ds, "a", { favorite: true });
    const lui = hoanTac(danhSachMoi);
    expect(lui[0].favorite).toBe(false);
    expect(lui[1]).toBe(ds[1]);
  });

  it("id không có trong danh sách thì không đổi gì và hoàn tác vô hại", () => {
    const { danhSachMoi, hoanTac } = apDungLacQuan(ds, "khong-co", { favorite: true });
    expect(danhSachMoi).toEqual(ds);
    expect(hoanTac(danhSachMoi)).toEqual(ds);
  });

  it("danh sách rỗng/null không nổ", () => {
    expect(apDungLacQuan([], "a", {}).danhSachMoi).toEqual([]);
    expect(apDungLacQuan(null, "a", {}).danhSachMoi).toEqual([]);
  });

  it("áp được nhiều trường một lúc", () => {
    const { danhSachMoi } = apDungLacQuan(ds, "a", { favorite: true, pinned: true });
    expect(danhSachMoi[0]).toMatchObject({ favorite: true, pinned: true });
  });
});
