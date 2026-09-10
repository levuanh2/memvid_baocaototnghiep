// Demo Mode (Phase 6, Step 4) — THUẦN. Chọn tài liệu THẬT tốt nhất trong thư
// viện đang có để dẫn một lượt "Xem thử" Summary/MindMap/Knowledge/Tutor —
// KHÔNG tạo dữ liệu giả, KHÔNG gọi API mới (chỉ đọc lại `documents`, mảng
// `/api/library` mà DocumentList.jsx đã tải sẵn), KHÔNG cần tải lên gì thêm.
//
// Nếu thư viện chưa có tài liệu nào đủ sẵn sàng, KHÔNG CÓ GÌ để demo — trả
// `null`, nơi gọi ẩn hẳn nút "Xem thử". Vẽ ra một bản demo rỗng/giả là đúng
// thứ .playbook (2026-09-01) đã cảnh báo: "Hỏng và rỗng là hai màn hình", và
// một demo bịa còn tệ hơn cả hai — nó nói dối về sản phẩm.
import { daLapChiMuc } from "./thuVienTaiLieu";

const mang = (v) => (Array.isArray(v) ? v : []);

/**
 * Điểm "đáng xem thử" — dùng LẠI đúng các cờ Phase 5 đã đọc
 * (`ai.*.state`/`ai.*.ready`, `knowledge.readiness.total`), không tính lại
 * readiness ở đây (đã có `learningAnalytics.js`/BE `tri_thuc.py` làm việc đó).
 * Tài liệu chưa lập chỉ mục thì chưa mở được bề mặt nào — loại thẳng.
 */
function diemDemo(doc) {
  if (!daLapChiMuc(doc)) return -1;
  let diem = Number(doc?.knowledge?.readiness?.total) || 0;
  if (doc?.ai?.summary?.state === "ready") diem += 15;
  if (doc?.ai?.mindmap?.state === "ready" || doc?.ai?.studymap?.state === "ready") diem += 15;
  if (doc?.ai?.quiz?.ready) diem += 5;
  if (doc?.ai?.review?.ready) diem += 5;
  return diem;
}

/**
 * Tài liệu THẬT phù hợp nhất để mở đầu một lượt Xem thử. `null` khi chưa có
 * tài liệu nào đủ sẵn sàng (thư viện trống, hoặc mọi tài liệu còn đang xử lý).
 */
export function chonTaiLieuDemo(documents) {
  let best = null;
  let diemCao = -1;
  for (const d of mang(documents)) {
    const s = diemDemo(d);
    if (s > diemCao) { best = d; diemCao = s; }
  }
  return diemCao > 0 ? best : null;
}

/** Bề mặt mở đầu tốt nhất: tóm tắt nếu có (đọc nhanh nhất), không thì bản đồ
 * học tập — luôn xem được vì tài liệu demo chắc chắn đã lập chỉ mục. */
export function beMatDemoDauTien(doc) {
  if (doc?.ai?.summary?.state === "ready") return "summary";
  return "studymap";
}
