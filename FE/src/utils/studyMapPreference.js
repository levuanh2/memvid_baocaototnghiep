// Tuỳ chọn StudyMap của người dùng TRÊN THIẾT BỊ NÀY, theo TỪNG TÀI LIỆU — layout đã
// chọn (Phase 2 #1) và chế độ trình chiếu (Phase 2 #9), CÙNG một object mỗi tài liệu.
//
// Cùng khuôn với `hooks/panelLayout.js`: nhận `storage` qua tham số để test được mà
// không cần localStorage thật; đọc hỏng/thiếu đều rơi về mặc định, không bao giờ ném.
//
// KHÔNG xoá khi đăng xuất (`auth/phienNguoiDung.js`): đây là sở thích THIẾT BỊ, cùng
// lớp với `memvid-theme` và `memvidx.panels.v1` (xem comment ở `phienNguoiDung.js`)
// — không mang tên tài liệu, không mang nội dung của ai. Xoá nó chỉ bắt người dùng
// chọn lại layout sau mỗi lần đăng nhập, không đóng góp gì cho việc dọn dữ liệu rò.
import { LAYOUT_IDS, LAYOUT_MAC_DINH } from "./studyMapLayout";

const STORAGE_KEY = "memvidx.study_map.v1";

function tatCa(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Tuỳ chọn đã lưu của MỘT tài liệu. Luôn trả đủ trường hợp lệ, kể cả khi chưa lưu gì. */
export function docPrefs(storage, documentId) {
  const raw = documentId ? tatCa(storage)[documentId] : null;
  const layout = raw && LAYOUT_IDS.includes(raw.layout) ? raw.layout : LAYOUT_MAC_DINH;
  const presentation = Boolean(raw?.presentation);
  return { layout, presentation };
}

/** Ghi ĐÈ một phần tuỳ chọn của một tài liệu — các trường khác (và tài liệu khác) giữ nguyên. */
export function writeDocPref(storage, documentId, patch) {
  if (!documentId || !patch || typeof patch !== "object") return;
  const all = tatCa(storage);
  const hienTai = all[documentId] && typeof all[documentId] === "object" ? all[documentId] : {};
  all[documentId] = { ...hienTai, ...patch };
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* hết chỗ hoặc bị chặn (cửa sổ riêng tư) — layout vẫn áp dụng trong phiên này */
  }
}
