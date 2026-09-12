// Tìm kiếm toàn cục (Command Palette) — THUẦN: không React, không mạng, không
// localStorage. Mọi trường tìm được ở đây đã có sẵn trong payload `/api/library`
// (xem ma trận trong PHASE 7 report) — không tính lại thứ máy chủ đã tính, không
// endpoint mới. `normalize` dùng LẠI `boDau` của thuVienTaiLieu.js — bỏ dấu tiếng
// Việt đã viết đúng một lần ở đó (đ không phải d+dấu, NFD viết bằng \u...), viết
// lại ở đây là nhân đôi một bẫy đã có sẵn cách sửa.
import { boDau, tenHienThi } from "./thuVienTaiLieu";

export const normalize = boDau;

export function tokenize(text) {
  return normalize(text).split(/\s+/).filter(Boolean);
}

// ── Xếp hạng — CỐ ĐỊNH, không học máy, không đổi theo dữ liệu. Thứ tự đúng như
// đặc tả: Exact title > Prefix > Contains > Topic > Entity > Tag > Collection >
// AI metadata. ───────────────────────────────────────────────────────────────
export const DIEM = {
  TIEU_DE_DUNG: 100,
  TIEU_DE_DAU: 90,
  TIEU_DE_CHUA: 80,
  CHU_DE: 70,
  THUC_THE: 60,
  THE: 50,
  BO_SUU_TAP: 40,
  META_AI: 30,
  // Chỉ dùng cho một điều khoản NÂNG CAO đã khớp (has:/favorite:/...) mà không
  // có một "loại trường" tự nhiên nào để xếp — thấp hơn mọi khớp văn bản thật,
  // cao hơn không khớp gì (0 nghĩa là loại).
  DIEU_KIEN: 20,
};

const LY_DO = {
  TIEU_DE_DUNG: "Khớp đúng tiêu đề",
  TIEU_DE_DAU: "Khớp đầu tiêu đề",
  TIEU_DE_CHUA: "Khớp tiêu đề",
  CHU_DE: "Khớp chủ đề",
  THUC_THE: "Khớp thực thể",
  THE: "Khớp thẻ",
  BO_SUU_TAP: "Khớp bộ sưu tập",
  META_AI: "Khớp nội dung AI",
  DIEU_KIEN: "Khớp điều kiện lọc",
};

export function lyDoKhop(hang) {
  return LY_DO[hang] || "Khớp";
}

function khopTieuDe(tenChuan, tuChuan) {
  if (!tuChuan) return null;
  if (tenChuan === tuChuan) return "TIEU_DE_DUNG";
  if (tenChuan.startsWith(tuChuan)) return "TIEU_DE_DAU";
  if (tenChuan.includes(tuChuan)) return "TIEU_DE_CHUA";
  return null;
}

/** Trường nào của MỘT tài liệu khớp MỘT token đã chuẩn hoá — hạng cao nhất trước.
 * `null` nghĩa là token này không khớp bất kỳ trường nào (loại tài liệu, vì mọi
 * token trong một truy vấn tự nhiên đều là AND — xem `score`). */
export function khopMotTuKhoa(doc, tuChuan, { tenBoSuuTap = null } = {}) {
  const ten = normalize(tenHienThi(doc));
  const hangTieuDe = khopTieuDe(ten, tuChuan);
  if (hangTieuDe) return hangTieuDe;

  const chuDe = (doc?.knowledge?.topics || []).map((t) => normalize(t?.name));
  if (chuDe.some((c) => c && c.includes(tuChuan))) return "CHU_DE";

  const thucThe = (doc?.knowledge?.entities || []).map((e) => normalize(e));
  if (thucThe.some((e) => e && e.includes(tuChuan))) return "THUC_THE";

  const the = (doc?.tags || []).map((t) => normalize(t));
  if (the.some((t) => t && t.includes(tuChuan))) return "THE";

  if (tenBoSuuTap && normalize(tenBoSuuTap).includes(tuChuan)) return "BO_SUU_TAP";

  const meta = normalize([
    doc?.file_type, doc?.language, doc?.ai?.summary?.preview,
    ...(Array.isArray(doc?.ai?.summary?.ai_overview) ? doc.ai.summary.ai_overview : []),
  ].filter(Boolean).join(" "));
  if (meta.includes(tuChuan)) return "META_AI";

  return null;
}

/** Điểm + lý do khớp TỐT NHẤT cho một tài liệu trên một truy vấn tự nhiên (nhiều
 * từ = AND, giống hệt quy ước của `thuVienTaiLieu.js::tim`). `null` = không khớp. */
export function score(doc, tuKhoaList, opts = {}) {
  if (!tuKhoaList.length) return null;
  let hangCaoNhat = null;
  for (const tu of tuKhoaList) {
    const hang = khopMotTuKhoa(doc, tu, opts);
    if (!hang) return null;
    if (!hangCaoNhat || DIEM[hang] > DIEM[hangCaoNhat]) hangCaoNhat = hang;
  }
  return { diem: DIEM[hangCaoNhat], hang: hangCaoNhat, lyDo: LY_DO[hangCaoNhat] };
}

export function match(doc, tuKhoaList, opts) {
  return score(doc, tuKhoaList, opts) != null;
}

/** Sắp theo điểm giảm dần; đồng điểm thì tài liệu mở gần đây hơn lên trước; vẫn
 * bằng thì A-Z — luôn CÙNG một thứ tự cho cùng một đầu vào (không có "gần giống
 * X%" giả vờ chính xác hơn nó thật sự là). */
export function sort(ketQua) {
  return [...ketQua].sort((a, b) =>
    b.diem - a.diem
    || (Date.parse(b.doc?.last_opened_at || 0) - Date.parse(a.doc?.last_opened_at || 0))
    || normalize(tenHienThi(a.doc)).localeCompare(normalize(tenHienThi(b.doc))));
}
