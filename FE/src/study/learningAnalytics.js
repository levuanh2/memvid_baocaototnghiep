// Lớp tính toán học tập DÙNG CHUNG (Phase 5, Step 7 — "one reusable
// calculation layer"). THUẦN: không mạng, không React, không localStorage.
//
// Đầu vào DUY NHẤT của mọi hàm ở đây là `documents` — mảng `/api/library` mà
// `DocumentList.jsx` đã tải sẵn cho trang Thư viện học tập (`getLibrary`,
// studyApi.js). KHÔNG hàm nào ở đây fetch gì, và KHÔNG hàm nào tính lại thứ
// máy chủ đã tính: `overview`/`weak`/`attempts` (getProgressOverview/
// getProgressConcepts/getProgressAttempts, cũng đã tải sẵn ở DocumentList.jsx)
// vẫn là nguồn sự thật cho điểm trung bình và mastery theo Postgres — các hàm
// dưới đây chỉ lấp phần máy chủ CHƯA tính: coverage theo artifact, bao phủ
// theo chủ đề, tài liệu chưa/ít mở, và các insight kim ngạch thư viện.
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

/** Completion tổng thể = trung bình bốn coverage artifact — một con số duy
 * nhất cho "đã đi được bao xa với thư viện này", KHÔNG thay thế
 * `overview.average_percentage` (đó là điểm quiz, một thứ khác). */
export function hoanThanhTongThe(documents) {
  const bp = baoPhuArtifact(documents);
  if (bp.tongSoDaLapChiMuc === 0) return 0;
  return Math.round(
    (bp.summary.phanTram + bp.mindmap.phanTram + bp.quiz.phanTram + bp.review.phanTram) / 4,
  );
}

// ── Step 3 — Weak Topic Detection (bổ sung, KHÔNG thay `weak` từ máy chủ) ───
/**
 * Chủ đề chưa từng được đánh giá mastery (`topic.mastery === null`) — khác hẳn
 * "yếu" (có điểm nhưng thấp, đã có ở `getProgressConcepts` phía máy chủ):
 * đây là chủ đề CHƯA CÓ đủ dữ liệu để chấm, gộp từ mọi tài liệu.
 */
export function chuDeChuaDanhGia(documents, { gioiHan = 6 } = {}) {
  const out = [];
  for (const doc of mang(documents)) {
    for (const topic of mang(doc?.knowledge?.topics)) {
      if (topic?.name && topic.mastery == null) {
        out.push({ name: topic.name, documentId: doc.document_id, taiLieu: doc.display_name || doc.title });
      }
    }
  }
  return out.slice(0, Math.max(0, gioiHan));
}

/** Tài liệu đã lập chỉ mục nhưng chưa mở bao giờ, hoặc mở rất ít lần. */
export function taiLieuItMo(documents, { gioiHan = 6, nguongLan = 1 } = {}) {
  return mang(documents)
    .filter(daLapChiMuc)
    .filter((d) => (Number(d.open_count) || 0) <= nguongLan)
    .sort((a, b) => (Number(a.open_count) || 0) - (Number(b.open_count) || 0))
    .slice(0, Math.max(0, gioiHan));
}

/** Tài liệu đã bắt đầu học (có mở) nhưng điểm sẵn sàng còn thấp — "dở dang". */
export function taiLieuChuaXong(documents, { gioiHan = 6, tranDuoi = 20, tranTren = 80 } = {}) {
  return mang(documents)
    .filter((d) => d.last_opened_at && d.knowledge?.readiness)
    .filter((d) => {
      const t = Number(d.knowledge.readiness.total) || 0;
      return t >= tranDuoi && t < tranTren;
    })
    .sort((a, b) => (Number(a.knowledge.readiness.total) || 0) - (Number(b.knowledge.readiness.total) || 0))
    .slice(0, Math.max(0, gioiHan));
}

// ── "Study Time" ─────────────────────────────────────────────────────────────
/**
 * KHÔNG có cột "thời gian ngồi học" nào trong hệ thống — không đo được thật.
 * Số ở đây là THỜI LƯỢNG ĐỌC ƯỚC TÍNH (`reading_minutes`, máy chủ đã tính từ
 * char_count) cộng dồn qua các tài liệu ĐÃ MỞ — một proxy trung thực, không
 * phải thời gian hoạt động thật. Nhãn hiển thị phải nói rõ "ước tính".
 */
export function thoiLuongDocUocTinh(documents) {
  return mang(documents)
    .filter((d) => d.last_opened_at)
    .reduce((tong, d) => tong + (Number(d.reading_minutes) || 0), 0);
}

// ── Step 6 — Insights (không AI, chỉ đọc metadata đã có) ────────────────────
export function insightThuVien(documents) {
  const ds = mang(documents);
  const daIndex = ds.filter(daLapChiMuc);

  // Chủ đề học nhiều nhất/ít nhất: gộp trọng số (`topic.weight`, đã tính sẵn ở
  // BE — xem `tri_thuc.py::topics`) qua toàn thư viện.
  const trongSoChuDe = new Map();
  for (const d of ds) {
    for (const t of mang(d?.knowledge?.topics)) {
      if (!t?.name) continue;
      trongSoChuDe.set(t.name, (trongSoChuDe.get(t.name) || 0) + (Number(t.weight) || 0));
    }
  }
  const chuDeSap = [...trongSoChuDe.entries()].sort((a, b) => b[1] - a[1]);

  const lonNhat = (mang, key) => mang.reduce(
    (max, d) => (Number(d[key]) || 0) > (Number(max?.[key]) || -1) ? d : max, null);

  return {
    chuDeHocNhieuNhat: chuDeSap[0]?.[0] || null,
    chuDeItHocNhat: chuDeSap.length ? chuDeSap[chuDeSap.length - 1][0] : null,
    taiLieuLonNhat: lonNhat(ds, "char_count"),
    taiLieuHoatDongNhat: lonNhat(ds, "open_count"),
    // "Câu hỏi đã trả lời" không có bộ đếm riêng ở đâu — proxy trung thực gần
    // nhất là số LƯỢT LÀM QUIZ ĐÃ CHẤM (`graded_attempts`), không phải số câu.
    luotQuizDaCham: ds.reduce((t, d) => t + (Number(d.ai?.quiz?.graded_attempts) || 0), 0),
    soMindmapDaXem: ds.filter((d) => d.ai?.mindmap?.state === "ready").length,
    baoPhuTomTat: phanTram(ds.filter((d) => d.ai?.summary?.state === "ready").length, daIndex.length),
  };
}
