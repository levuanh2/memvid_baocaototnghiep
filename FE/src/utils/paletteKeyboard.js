// Điều hướng bàn phím của Command Palette — THUẦN, đọc sự kiện, trả Ý ĐỊNH,
// không đụng DOM/state. Cùng dáng với `chonNhieu.js::phimDanhSach` (roving
// index) đã dùng cho lưới Thư viện — giữ quy ước "trả {loai, chiSo}" thay vì
// tự setState ở đây để test được không cần dựng React.
//
// Lên/Xuống VÀ Tab/Shift+Tab làm CÙNG một việc (di chuyển một bước) — hầu hết
// command palette thật (VSCode, Linear, Notion) đều cho Tab đi tới như một
// phím tắt của mũi tên, không nhảy sang "nhóm kết quả kế tiếp": danh sách ở
// đây phẳng (đã gộp bốn nhóm thành một mảng trước khi tới đây), nên không có
// khái niệm "nhóm kế tiếp" để Tab nhảy tới — giữ đúng những gì đặc tả liệt kê,
// không bịa thêm một mô hình điều hướng phức tạp hơn.
export function phimBang(e, { chiSo, tongSo }) {
  if (tongSo <= 0) {
    if (e.key === "Escape") return { loai: "dong" };
    return null;
  }
  switch (e.key) {
    case "ArrowDown":
    case "Tab":
      if (e.key === "Tab" && e.shiftKey) return { loai: "focus", chiSo: (chiSo - 1 + tongSo) % tongSo };
      return { loai: "focus", chiSo: (chiSo + 1) % tongSo };
    case "ArrowUp":
      return { loai: "focus", chiSo: (chiSo - 1 + tongSo) % tongSo };
    case "Home":
      return { loai: "focus", chiSo: 0 };
    case "End":
      return { loai: "focus", chiSo: tongSo - 1 };
    case "Enter":
      return { loai: "kich_hoat", chiSo };
    case "Escape":
      return { loai: "dong" };
    default:
      return null;
  }
}
