// Coverage theo artifact của thư viện. THUẦN: không mạng, không React, không localStorage.
// Đầu vào là `documents` (`/api/library`); không tính lại thứ máy chủ đã tính (điểm, mastery
// lấy từ /api/progress/*).
//
// V9.3 cleanup: hoanThanhTongThe, chuDeChuaDanhGia, taiLieuItMo, taiLieuChuaXong,
// thoiLuongDocUocTinh và insightThuVien bị gỡ — người dùng duy nhất là LearningDashboard,
// đã bỏ ở P3b (#203). thoiLuongDocUocTinh là ước tính thời gian đọc mà owner không cho hiển thị.
import { daLapChiMuc } from "../utils/thuVienTaiLieu";

const mang = (v) => (Array.isArray(v) ? v : []);

/** % làm tròn, an toàn chia-cho-0. */
function phanTram(co, tong) {
  return tong > 0 ? Math.round((co / tong) * 100) : 0;
}

// ── Step 2 — Progress: coverage theo artifact + Completion tổng ─────────────
/**
 * Coverage: trong số tài liệu ĐÃ lập chỉ mục (artifact nào cũng cần chỉ mục
 * trước), bao nhiêu % đã có từng loại artifact. Không tính tài liệu chưa lập
 * chỉ mục vào mẫu số — mời tạo tóm tắt cho tài liệu chưa có đoạn nào là mời
 * vào ngõ cụt (đúng lý do `chiaMuc.js::canTomTat` chỉ lọc trong `daIndex`).
 */
export function baoPhuArtifact(documents) {
  const daIndex = mang(documents).filter(daLapChiMuc);
  const tong = daIndex.length;
  const dem = (kiemTra) => daIndex.filter(kiemTra).length;
  const summary = dem((d) => d.ai?.summary?.state === "ready");
  const mindmap = dem((d) => d.ai?.mindmap?.state === "ready" || d.ai?.studymap?.state === "ready");
  const quiz = dem((d) => Boolean(d.ai?.quiz?.ready));
  const review = dem((d) => Boolean(d.ai?.review?.ready));
  return {
    tongSoDaLapChiMuc: tong,
    summary: { co: summary, tong, phanTram: phanTram(summary, tong) },
    mindmap: { co: mindmap, tong, phanTram: phanTram(mindmap, tong) },
    quiz: { co: quiz, tong, phanTram: phanTram(quiz, tong) },
    review: { co: review, tong, phanTram: phanTram(review, tong) },
  };
}
