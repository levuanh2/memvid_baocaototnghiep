// Command Palette — bộ điều phối tìm kiếm toàn cục. THUẦN, ghép
// `universalSearch.js` (tìm tự nhiên, xếp hạng) với `searchQuery.js` (cú pháp
// nâng cao) và chiếu ra bốn nhóm kết quả: Documents / Collections / Topics /
// Entities. KHÔNG tự tính Chủ đề/Thực thể riêng — cả hai đã có trong
// `doc.knowledge` của MỖI tài liệu (payload `/api/library` đã tải), ở đây chỉ
// gộp lại và đếm.
import { tenHienThi } from "./thuVienTaiLieu";
import { normalize, score as diemTuNhien, sort as sapTheoDiem, lyDoKhop } from "./universalSearch";
import { parseQuery, laTruyVanNangCao, evalQuery } from "./searchQuery";

function tenBoSuuTapCua(doc, collectionsById) {
  return doc?.collection_id ? collectionsById.get(doc.collection_id)?.name || null : null;
}

/** Kết quả Documents — mảng {doc, diem, lyDo}, đã sắp. */
export function timTaiLieu(documents, raw, collectionsById) {
  const docs = Array.isArray(documents) ? documents : [];
  if (!raw.trim()) return [];
  const nangCao = laTruyVanNangCao(raw);
  const ra = [];
  if (nangCao) {
    const cay = parseQuery(raw);
    for (const doc of docs) {
      const opts = { tenBoSuuTap: tenBoSuuTapCua(doc, collectionsById) };
      const kq = evalQuery(doc, cay, opts);
      if (kq) ra.push({ doc, diem: kq.diem, lyDo: lyDoKhop(kq.hang) });
    }
  } else {
    const tuKhoa = normalize(raw).split(/\s+/).filter(Boolean);
    for (const doc of docs) {
      const opts = { tenBoSuuTap: tenBoSuuTapCua(doc, collectionsById) };
      const kq = diemTuNhien(doc, tuKhoa, opts);
      if (kq) ra.push({ doc, diem: kq.diem, lyDo: kq.lyDo });
    }
  }
  return sapTheoDiem(ra);
}

/** Bộ sưu tập có tên khớp — chỉ cho truy vấn tự nhiên (nâng cao là để LỌC tài
 * liệu, không phải để tìm tên bộ sưu tập). */
export function timBoSuuTap(collections, raw) {
  if (laTruyVanNangCao(raw) || !raw.trim()) return [];
  const q = normalize(raw);
  return (collections || [])
    .filter((c) => normalize(c?.name || "").includes(q))
    .sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
}

/** Gộp chủ đề/thực thể DUY NHẤT qua toàn thư viện, đếm số tài liệu mang nó —
 * không phải một bảng mới, suy trực tiếp từ `doc.knowledge` đã có sẵn trên mỗi
 * tài liệu trong `documents`. */
function gomDuyNhat(documents, lay) {
  const dem = new Map();
  for (const doc of documents || []) {
    for (const gt of lay(doc)) {
      const ten = String(gt || "").trim();
      if (!ten) continue;
      const hien = dem.get(ten) || { ten, soTaiLieu: 0 };
      hien.soTaiLieu += 1;
      dem.set(ten, hien);
    }
  }
  return [...dem.values()];
}

export function timChuDe(documents, raw) {
  if (laTruyVanNangCao(raw) || !raw.trim()) return [];
  const q = normalize(raw);
  return gomDuyNhat(documents, (d) => (d?.knowledge?.topics || []).map((t) => t?.name))
    .filter((x) => normalize(x.ten).includes(q))
    .sort((a, b) => b.soTaiLieu - a.soTaiLieu || normalize(a.ten).localeCompare(normalize(b.ten)));
}

export function timThucThe(documents, raw) {
  if (laTruyVanNangCao(raw) || !raw.trim()) return [];
  const q = normalize(raw);
  return gomDuyNhat(documents, (d) => d?.knowledge?.entities || [])
    .filter((x) => normalize(x.ten).includes(q))
    .sort((a, b) => b.soTaiLieu - a.soTaiLieu || normalize(a.ten).localeCompare(normalize(b.ten)));
}

/**
 * Kết quả đầy đủ cho một truy vấn — bốn nhóm, mỗi nhóm đã cắt `gioiHan`. Rỗng
 * (`raw` trắng) trả bốn mảng rỗng — nơi gọi tự quyết định hiện "Gần đây" thay
 * vào đó (đó là việc của lịch sử, không phải của tìm kiếm).
 */
export function timKiemToanCuc(documents, collections, raw, { gioiHan = 8 } = {}) {
  const collectionsById = new Map((collections || []).map((c) => [c.collection_id, c]));
  return {
    documents: timTaiLieu(documents, raw, collectionsById).slice(0, gioiHan),
    collections: timBoSuuTap(collections, raw).slice(0, gioiHan),
    topics: timChuDe(documents, raw).slice(0, gioiHan),
    entities: timThucThe(documents, raw).slice(0, gioiHan),
  };
}

export { tenHienThi };
