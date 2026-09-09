// Bộ sưu tập + thẻ — THUẦN. Không React, không mạng, không localStorage.
//
// Bộ sưu tập và thẻ KHÔNG hợp nhất:
//   bộ sưu tập  0..1 mỗi tài liệu, có danh tính (tên/màu/biểu tượng/thứ tự), sống
//               được khi rỗng, đổi tên không đụng tài liệu nào
//   thẻ         0..n mỗi tài liệu, chỉ là chuỗi, không có danh tính riêng
//
// Vì vậy bộ sưu tập là một bảng, còn thẻ vẫn là `documents.tags` (JSONB) từ Phase 1A.
// Danh sách thẻ ở thanh bên là phép GỘP trên chính cột ấy — không có bảng thẻ, không
// có mảng thẻ riêng trong payload, nên không có bản sao nào để lệch.

import { boDau } from "./thuVienTaiLieu";

export const KHONG_PHAN_LOAI = "__khong_phan_loai__";

/** {collection_id: bộ sưu tập} — tra tên/màu cho huy hiệu trên thẻ. */
export function chiMucBoSuuTap(danhSach) {
  const out = new Map();
  for (const c of danhSach || []) {
    if (c?.collection_id) out.set(c.collection_id, c);
  }
  return out;
}

export const boSuuTapCua = (doc, chiMuc) =>
  (doc?.collection_id && chiMuc?.get(doc.collection_id)) || null;

/**
 * Bộ sưu tập cho thanh bên, kèm số tài liệu ĐANG HIỂN THỊ.
 *
 * `document_count` từ máy chủ đếm mọi tài liệu chưa xoá; số ở thanh bên phải khớp
 * thứ người dùng thật sự nhìn thấy sau khi tìm/lọc, nếu không thì bấm vào một bộ
 * sưu tập ghi "5" lại ra danh sách rỗng.
 */
export function boSuuTapChoThanhBen(collections, documents, { hienLuuTru = false } = {}) {
  const dem = new Map();
  let chuaPhanLoai = 0;
  for (const d of documents || []) {
    if (!hienLuuTru && d?.archived_at) continue;
    if (d?.collection_id) dem.set(d.collection_id, (dem.get(d.collection_id) || 0) + 1);
    else chuaPhanLoai += 1;
  }
  const ds = (collections || [])
    .filter((c) => hienLuuTru || !c?.archived_at)
    .map((c) => ({ ...c, hien_thi_count: dem.get(c.collection_id) || 0 }))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      || String(a.created_at || "").localeCompare(String(b.created_at || "")));
  return { boSuuTap: ds, chuaPhanLoai };
}

/**
 * Thẻ cho thanh bên — GỘP từ chính các tài liệu, không phải từ một mảng riêng.
 *
 * Khử trùng không phân biệt hoa thường nhưng giữ cách viết ĐẦU TIÊN gặp, đúng như
 * máy chủ làm khi ghi thẻ; nếu hai bên khác luật thì "AI" và "ai" sẽ thành hai mục
 * trong thanh bên nhưng một mục trong database.
 */
export function theChoThanhBen(documents, { hienLuuTru = false } = {}) {
  const dem = new Map();     // khoá thường → { ten, so }
  for (const d of documents || []) {
    if (!hienLuuTru && d?.archived_at) continue;
    for (const t of Array.isArray(d?.tags) ? d.tags : []) {
      if (typeof t !== "string" || !t.trim()) continue;
      const ten = t.trim();
      const khoa = ten.toLowerCase();
      const cu = dem.get(khoa);
      if (cu) cu.so += 1;
      else dem.set(khoa, { ten, khoa, so: 1 });
    }
  }
  // Nhiều nhất trước, rồi theo bảng chữ cái — thẻ dùng một lần không được đẩy thẻ
  // dùng hai mươi lần xuống dưới chỉ vì tên nó đứng trước.
  return [...dem.values()].sort((a, b) => b.so - a.so || boDau(a.ten).localeCompare(boDau(b.ten)));
}

/** Kiểm tra tên bộ sưu tập — thuần, dùng cho cả tạo lẫn đổi tên. */
export const TEN_TOI_DA = 100;

export function kiemTraTenBoSuuTap(nhap, tenHienTai = null) {
  const t = String(nhap ?? "").trim();
  const hienTai = tenHienTai == null ? null : String(tenHienTai).trim();
  if (!t) return { hopLe: false, giaTri: null, loi: "Tên không được để trống", khongDoi: !hienTai };
  if (t.length > TEN_TOI_DA) {
    return { hopLe: false, giaTri: null, loi: `Tên tối đa ${TEN_TOI_DA} ký tự.`, khongDoi: false };
  }
  if (t === hienTai) return { hopLe: false, giaTri: t, loi: null, khongDoi: true };
  return { hopLe: true, giaTri: t, loi: null, khongDoi: false };
}

// Bảng màu cố định: người dùng chọn từ danh sách chứ không gõ mã màu tự do. Màu tự
// do trên nền sáng lẫn nền tối là một bài toán tương phản mà một ô chọn màu không
// giải được — và một bộ sưu tập vô hình thì vô dụng.
export const MAU = [
  { khoa: "slate", nhan: "Xám", hex: "#64748b" },
  { khoa: "red", nhan: "Đỏ", hex: "#dc2626" },
  { khoa: "amber", nhan: "Hổ phách", hex: "#d97706" },
  { khoa: "green", nhan: "Lục", hex: "#16a34a" },
  { khoa: "teal", nhan: "Lam lục", hex: "#0d9488" },
  { khoa: "blue", nhan: "Lam", hex: "#2563eb" },
  { khoa: "violet", nhan: "Tím", hex: "#7c3aed" },
  { khoa: "pink", nhan: "Hồng", hex: "#db2777" },
];

const MAU_THEO_KHOA = new Map(MAU.map((m) => [m.khoa, m]));

/** Mã hex của một khoá màu. Khoá lạ/thiếu → xám, không bao giờ `undefined`. */
export const hexMau = (khoa) => (MAU_THEO_KHOA.get(khoa) || MAU[0]).hex;
