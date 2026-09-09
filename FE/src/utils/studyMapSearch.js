// Tìm theo tiêu đề node trong StudyMap — THUẦN, không React, không DOM.
//
// `timStudyMap` không chỉ trả danh sách khớp: nó trả {matches, activeIndex, total} —
// cùng MỘT mô hình cho điều hướng bàn phím, thanh trạng thái ("2/5 kết quả"), và một
// command palette sau này, thay vì mỗi nơi tự suy activeIndex/total từ mảng khớp theo
// cách riêng của nó.
import { boDau } from "./thuVienTaiLieu";

const mang = (v) => (Array.isArray(v) ? v : []);

const KHONG_KHOP = { matches: [], activeIndex: -1, total: 0 };

export function timStudyMap(nodes, query) {
  const q = boDau(query);
  if (!q) return { ...KHONG_KHOP };
  const matches = mang(nodes)
    .filter((n) => n && typeof n === "object" && n.node_id && boDau(n.title).includes(q))
    .map((n) => n.node_id);
  return { matches, activeIndex: matches.length ? 0 : -1, total: matches.length };
}

/** Vòng qua đầu/cuối — `huong`: +1 tiếp, -1 trước. Không có kết quả thì giữ nguyên. */
export function diChuyenKetQua(state, huong) {
  if (!state?.total) return state;
  const activeIndex = (state.activeIndex + huong + state.total) % state.total;
  return { ...state, activeIndex };
}

/**
 * Dịch MỘT sự kiện bàn phím thành Ý ĐỊNH — không tự gọi setState/điều hướng. Cùng
 * khuôn với `chonNhieu.js::phimDanhSach`: tách "phím nào" khỏi "làm gì với nó" để
 * test được mà không cần dựng ô nhập liệu thật.
 */
export function phimTimKiemStudyMap(e) {
  if (!e || e.altKey || e.ctrlKey || e.metaKey) return null;
  switch (e.key) {
    case "ArrowDown": case "ArrowRight": return { loai: "tiep" };
    case "ArrowUp": case "ArrowLeft": return { loai: "truoc" };
    case "Enter": return { loai: "nhay" };
    case "Escape": return { loai: "xoa" };
    default: return null;
  }
}
