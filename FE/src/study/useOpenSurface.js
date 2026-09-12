import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { duongDi } from "../utils/tiepTucHoc";
import { markOpened } from "../utils/studyApi";

/**
 * Mở một bề mặt học tập cho một tài liệu — điều hướng theo `duongDi()` + ghi
 * mốc mở bắn-và-quên (`markOpened`, hỏng không chặn điều hướng). ĐÚNG MỘT chỗ
 * định nghĩa "mở nghĩa là gì" — DocumentList.jsx và Command Palette đều gọi
 * hook này (Phase 7 UX brief: "Commands MUST reuse moBeMat(), no duplicate
 * routing"). DocumentList.jsx bọc thêm một lớp cập nhật lạc quan cho danh sách
 * NÓ đang hiển thị — đó là state của riêng trang đó, không thuộc về đây.
 *
 * Trả `false` khi `duongDi` không dựng được đường đi (tài liệu thiếu
 * `document_id`) — nơi gọi tự quyết định làm gì tiếp (im lặng, hay báo lỗi).
 */
export function useOpenSurface() {
  const navigate = useNavigate();
  return useCallback((doc, beMat, context) => {
    const dich = duongDi(doc, beMat, context);
    if (!dich) return false;
    markOpened(doc.document_id, beMat).catch(() => {});
    navigate(dich);
    return true;
  }, [navigate]);
}
