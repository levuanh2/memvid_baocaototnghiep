// Detailed learning progress (V6 Wave 1). Every number comes from the three progress routes;
// nothing here estimates or fills in. Learning Home answers "what next"; this page answers
// "what do I know, what is still weak, and is it improving".
import { formatScore, masteryPercent } from "./studyApi";
import { tenHienThi } from "./thuVienTaiLieu";

export const LOAI_BAI = { diagnostic: "Kiểm tra", practice: "Luyện tập" };

/** The thesis line at the top. `null` parts are left out, never printed as 0. */
export function tomTatTienDo(overview, concepts) {
  const tong = concepts.length;
  if (!tong) return null;
  const daNam = concepts.filter((c) => c.status === "mastered").length;
  const canOn = tong - daNam;
  // The server sorts weakest first.
  const yeuNhat = concepts.find((c) => c.status !== "mastered");
  const cau = [`Đã nắm tốt ${daNam} trên ${tong} khái niệm.`];
  if (canOn) cau.push(`${canOn} khái niệm cần ôn, yếu nhất là “${yeuNhat.concept_name}”.`);
  const tb = overview?.average_percentage;
  if (tb != null) cau.push(`Trung bình ${Math.round(Number(tb))}% điểm trên các bài đã chấm xong.`);
  const dangLam = Number(overview?.attempt_count_by_status?.in_progress || 0);
  if (dangLam) cau.push(`${dangLam} bài đang làm dở.`);
  return cau.join(" ");
}

/** "Lần đầu 40% → nay 65%", with the change in points of mastery. */
export function moTaKhaiNiem(c) {
  const dau = masteryPercent(c.first_mastery_score);
  const nay = masteryPercent(c.mastery_score);
  const lan = Number(c.attempt_count || 0);
  if (lan <= 1) return `Mức nắm ${nay}% sau 1 lần làm bài`;
  const doi = nay - dau;
  const xuHuong = doi > 0 ? `tăng ${doi}` : doi < 0 ? `giảm ${-doi}` : "không đổi";
  return `Lần đầu ${dau}% → nay ${nay}% (${xuHuong}), ${lan} lần làm bài`;
}

/** Concepts grouped by document, in library order of first appearance (weakest first). */
export function nhomTheoTaiLieu(concepts, documents) {
  const ten = new Map((documents || []).map((d) => [d.document_id, tenHienThi(d)]));
  const nhom = new Map();
  for (const c of concepts) {
    const id = c.document_id || "";
    if (!nhom.has(id)) {
      nhom.set(id, {
        documentId: ten.has(id) ? id : null,
        ten: ten.get(id) || "Tài liệu không còn trong thư viện",
        khaiNiem: [],
      });
    }
    nhom.get(id).khaiNiem.push(c);
  }
  return [...nhom.values()];
}

export function locKhaiNiem(concepts, loc) {
  if (loc === "can-on") return concepts.filter((c) => c.status !== "mastered");
  if (loc === "da-nam") return concepts.filter((c) => c.status === "mastered");
  return concepts;
}

/** Where a past attempt row leads, and what its result reads as. */
export function baiLam(a) {
  const luyenTap = a.quiz_type === "practice";
  const conCauChuaCham = a.status === "graded" && Number(a.ungraded_count || 0) > 0;
  let ketQua;
  if (a.status === "in_progress") ketQua = "Đang làm dở";
  else if (a.status === "submitted") ketQua = "Đang chấm";
  else if (a.status !== "graded") ketQua = "—";
  else if (Number(a.max_score || 0) === 0) ketQua = "Chưa chấm được";
  else {
    const pct = a.percentage == null ? null : Math.round(Number(a.percentage));
    ketQua = `${pct == null ? "—" : `${pct}%`} điểm · ${formatScore(a.score, a.max_score)}`;
    if (conCauChuaCham) ketQua = `Tạm tính ${ketQua}`;
  }
  let den = null;
  if (luyenTap) den = `/app/study/practice/${encodeURIComponent(a.quiz_id)}`;
  else if (a.status === "in_progress") den = `/app/study/quiz/${encodeURIComponent(a.quiz_id)}`;
  else if (a.status === "graded" || a.status === "submitted") den = `/app/study/result/${encodeURIComponent(a.attempt_id)}`;
  const nhanDen = a.status === "in_progress" && !luyenTap ? "Làm tiếp" : "Xem bài";
  return { loai: LOAI_BAI[a.quiz_type] || "Bài làm", ketQua, den, nhanDen, tamTinh: conCauChuaCham };
}

export function ngayLam(a) {
  const iso = a.submitted_at || a.started_at;
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}
