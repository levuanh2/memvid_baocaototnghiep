// Dọn state THUỘC VỀ NGƯỜI DÙNG khi phiên kết thúc.
//
// Vì sao cần: state trong React biến mất theo component (đăng xuất ⇒ `Workspace`
// unmount ⇒ mọi useState mất), nhưng localStorage thì KHÔNG. Ba khoá dưới đây gắn
// với một người dùng cụ thể mà tên khoá lại không có gì phân biệt người dùng, nên
// chúng sống sót qua đăng xuất và được người kế tiếp đọc lại trên cùng trình duyệt.
//
// Nặng nhất là `memvid.nguon_dang_xu_ly`: nó chứa `filename` của tài liệu, và
// `SidebarLeft` vẽ tên đó ra thẻ ngay lúc mount, KHÔNG qua backend. Kiểm tra quyền
// ở server không đỡ được — dữ liệu chưa bao giờ rời trình duyệt.
//
// Hai khoá job (`mindmap_active_job`, `summary_active_job`) nhẹ hơn vì
// `/mindmap-status` và `/summary-status` đều kiểm chủ sở hữu và trả 404 cho người
// khác. Nhưng để lại thì người mới đăng nhập thấy chip "đang tạo sơ đồ…" rồi một
// thông báo lỗi về một job họ chưa từng bấm — trạng thái cũ nói dối về hiện tại.
import { clearActiveMindmapJob } from "../utils/activeMindmapJob";
import { clearActiveSummaryJob } from "../utils/activeSummaryJob";
import { quenHetNguon } from "../utils/nguonDangXuLy";

/**
 * Xoá mọi thứ thuộc về phiên của MỘT người dùng.
 *
 * CỐ Ý không đụng tới:
 *   - `memvid-theme`      sáng/tối là lựa chọn của THIẾT BỊ, không của tài khoản;
 *   - `memvidx.panels.v1` bề rộng/đóng-mở cột, cũng thuộc thiết bị.
 * Xoá hai cái đó là bắt người dùng chỉnh lại giao diện sau mỗi lần đăng xuất, mà
 * chúng không hề mang dữ liệu của ai.
 *
 * Token do `tokenStore.clearToken()` lo, tách riêng để tầng gọi quyết định thứ tự.
 */
export function xoaDuLieuPhienNguoiDung() {
  quenHetNguon();
  clearActiveMindmapJob();
  clearActiveSummaryJob();
}
