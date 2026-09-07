// Nhớ những tài liệu đang được xử lý, để chúng sống qua F5 và qua việc thu cột trái.
//
// `/list-indexed` chỉ trả về tài liệu đã index XONG. Thẻ của tài liệu đang xử lý chỉ
// tồn tại trong state của `SidebarLeft`, mà component đó unmount thật khi thu cột
// (MainLayout thay nó bằng PanelSpine). Mở lại cột — hoặc F5 — là thẻ biến mất hẳn, và
// người dùng đọc là upload hỏng.
//
// Cùng bài học với `makeActiveJobStore` (job nền dài phải lưu id ngay khi nhận được),
// chỉ khác là ở đây có NHIỀU nguồn cùng lúc nên lưu một danh sách.
const KEY = "memvid.nguon_dang_xu_ly";
const HAN_MS = 6 * 60 * 60 * 1000;   // quá 6 giờ thì chắc chắn không còn chạy

const doc = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const ds = raw ? JSON.parse(raw) : [];
    return Array.isArray(ds) ? ds : [];
  } catch {
    return [];
  }
};

const ghi = (ds) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(ds));
  } catch {
    /* chế độ riêng tư / hết quota — mất khả năng khôi phục, không phải lỗi chặn */
  }
};

export function nhoNguon({ sourceId, filename }, now = Date.now()) {
  if (!sourceId) return;
  const ds = doc().filter((x) => x.sourceId !== sourceId);
  ds.push({ sourceId, filename: filename || "", luc: now });
  ghi(ds);
}

export function quenNguon(sourceId) {
  if (!sourceId) return;
  ghi(doc().filter((x) => x.sourceId !== sourceId));
}

/** Xoá SẠCH danh sách — dùng khi đổi người dùng (đăng xuất / hết phiên).
 *
 * Danh sách này chứa `filename` của tài liệu, và `SidebarLeft` vẽ thẳng tên đó ra
 * thẻ NGAY LÚC MOUNT, không hỏi backend câu nào. Khoá localStorage lại không gắn
 * với người dùng nào. Không xoá lúc đăng xuất thì người tiếp theo đăng nhập trên
 * cùng trình duyệt sẽ thấy tên tài liệu của người trước — rò dữ liệu thuần client,
 * mọi kiểm tra quyền ở backend đều không chạm tới được.
 */
export function quenHetNguon() {
  ghi([]);
}

/** Danh sách còn hạn, và dọn luôn những mục đã quá hạn. */
export function nguonConDangXuLy(now = Date.now()) {
  const ds = doc().filter(
    (x) => x && x.sourceId && now - (Number(x.luc) || 0) < HAN_MS,
  );
  if (ds.length !== doc().length) ghi(ds);
  return ds;
}
