// Chọn nhiều tài liệu + điều hướng bàn phím — THUẦN.
//
// Tách khỏi component vì bộ test chạy ở env node (không jsdom): quyết định nào là
// "chọn tất cả", phím nào làm gì, nhãn trợ năng ra sao — tất cả đều test được ở đây
// mà không cần render.
//
// Bài học từ Phase 1A: ô chọn ở CỘT TRÁI của Workspace mang nghĩa "phạm vi câu hỏi",
// không phải "chọn để thao tác". Ô chọn ở đây là thứ HOÀN TOÀN KHÁC và sống ở một
// màn hình khác — cố ý không dùng chung, để một cú bấm "Xoá" không bao giờ đổ vào
// những tài liệu người dùng vừa chọn để hỏi.

/** Bật/tắt một id. Luôn trả Set MỚI — sửa tại chỗ là một lần render bị bỏ qua. */
export function batTat(daChon, id) {
  const s = new Set(daChon || []);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  return s;
}

/**
 * Chọn tất cả trong phạm vi ĐANG HIỂN THỊ, không phải toàn thư viện.
 *
 * Người dùng lọc còn 5 tài liệu rồi bấm "Chọn tất cả" thì phải được 5 — chọn cả 300
 * tài liệu đang bị ẩn rồi xoá là mất dữ liệu sau một cú bấm.
 */
export function chonTatCa(dangHienThi) {
  return new Set((dangHienThi || []).map((d) => d?.document_id).filter(Boolean));
}

export const xoaChon = () => new Set();

/** Đã chọn hết những gì đang hiển thị chưa (danh sách rỗng → false, không phải true). */
export function daChonHet(daChon, dangHienThi) {
  const ds = (dangHienThi || []).map((d) => d?.document_id).filter(Boolean);
  if (!ds.length) return false;
  return ds.every((id) => daChon?.has(id));
}

export function daChonMotPhan(daChon, dangHienThi) {
  const ds = (dangHienThi || []).map((d) => d?.document_id).filter(Boolean);
  if (!ds.length) return false;
  const n = ds.filter((id) => daChon?.has(id)).length;
  return n > 0 && n < ds.length;
}

/**
 * Bỏ khỏi lựa chọn những id không còn hiển thị.
 *
 * Gọi mỗi khi bộ lọc/tìm kiếm đổi. Không có bước này thì một tài liệu đã lọc đi vẫn
 * nằm trong lựa chọn, và "Xoá 3 tài liệu" xoá một thứ người dùng không nhìn thấy.
 */
export function locTheoHienThi(daChon, dangHienThi) {
  const co = new Set((dangHienThi || []).map((d) => d?.document_id).filter(Boolean));
  const s = new Set();
  for (const id of daChon || []) if (co.has(id)) s.add(id);
  return s;
}

// ── Hành động hàng loạt ─────────────────────────────────────────────────────
// Trùng đúng tập `_BULK_HANH_DONG` của máy chủ. KHÔNG có hành động AI ở đây: sinh
// tóm tắt cho 200 tài liệu một lúc là một quyết định về chi phí và hàng đợi, không
// phải một mục trong thanh công cụ.
export const HANH_DONG = [
  { khoa: "pin", nhan: "Ghim", icon: "Pin" },
  { khoa: "unpin", nhan: "Bỏ ghim", icon: "Pin" },
  { khoa: "favorite", nhan: "Yêu thích", icon: "Star" },
  { khoa: "unfavorite", nhan: "Bỏ yêu thích", icon: "Star" },
  { khoa: "archive", nhan: "Lưu trữ", icon: "Archive" },
  { khoa: "unarchive", nhan: "Bỏ lưu trữ", icon: "ArchiveRestore" },
  { khoa: "move_collection", nhan: "Chuyển bộ sưu tập", icon: "FolderOpen" },
  { khoa: "add_tags", nhan: "Gắn thẻ", icon: "Tag" },
  { khoa: "remove_tags", nhan: "Bỏ thẻ", icon: "Tag" },
  { khoa: "delete", nhan: "Xoá", icon: "Trash2", nguyHiem: true },
];

export const CAN_XAC_NHAN = new Set(["delete"]);

/**
 * Thân request cho `POST /api/documents/bulk`, hoặc `null` nếu chưa đủ dữ liệu.
 *
 * Trả `null` thay vì gửi một request thiếu tham số: máy chủ sẽ trả 400 và người
 * dùng đọc được một lỗi cho thao tác mà giao diện lẽ ra phải chặn từ đầu.
 */
export function thanRequest(hanhDong, ids, { collectionId, tags } = {}) {
  const ds = [...(ids || [])].filter(Boolean);
  if (!ds.length) return null;
  if (!HANH_DONG.some((h) => h.khoa === hanhDong)) return null;

  const than = { document_ids: ds, action: hanhDong };
  if (hanhDong === "move_collection") {
    than.collection_id = collectionId || null;   // null = bỏ khỏi bộ sưu tập, hợp lệ
    return than;
  }
  if (hanhDong === "add_tags" || hanhDong === "remove_tags") {
    const t = (tags || []).map((x) => String(x || "").trim()).filter(Boolean);
    if (!t.length) return null;
    than.tags = t;
  }
  return than;
}

/** Thay đổi lạc quan tương ứng một hành động. `null` = phải tải lại từ máy chủ. */
export function thayDoiLacQuan(hanhDong, { collectionId } = {}) {
  switch (hanhDong) {
    case "pin": return { pinned: true };
    case "unpin": return { pinned: false };
    case "favorite": return { favorite: true };
    case "unfavorite": return { favorite: false };
    case "archive": return { archived_at: new Date().toISOString() };
    case "unarchive": return { archived_at: null };
    case "move_collection": return { collection_id: collectionId || null };
    // Thẻ hợp nhất theo tập ở máy chủ, và xoá đổi cả danh sách — đoán ở client là
    // đoán sai. Tải lại thay vì hiện một trạng thái bịa.
    default: return null;
  }
}

// ── Điều hướng bàn phím ─────────────────────────────────────────────────────
/**
 * Phím → hành động trên danh sách thẻ. Trả `null` khi không xử lý, để trình duyệt
 * giữ nguyên hành vi mặc định (Tab, gõ chữ trong ô tìm kiếm…).
 *
 * `chiSo` là vị trí thẻ đang focus. Điều hướng bằng phím phải bám đúng danh sách
 * ĐANG HIỂN THỊ, nên `tong` là số thẻ sau khi lọc.
 */
export function phimDanhSach(e, { chiSo, tong }) {
  if (!e || e.altKey || e.ctrlKey || e.metaKey) return null;
  const cuoi = Math.max(0, (tong || 0) - 1);
  switch (e.key) {
    case "ArrowDown": return { loai: "focus", chiSo: Math.min(cuoi, (chiSo ?? -1) + 1) };
    case "ArrowUp": return { loai: "focus", chiSo: Math.max(0, (chiSo ?? 1) - 1) };
    case "Home": return { loai: "focus", chiSo: 0 };
    case "End": return { loai: "focus", chiSo: cuoi };
    // Space chọn, Enter mở — cùng quy ước với mọi danh sách chọn được của hệ điều
    // hành. Đảo hai phím này là cách chắc chắn nhất để ai đó xoá nhầm.
    case " ":
    case "Space": return { loai: "chon", chiSo };
    case "Enter": return { loai: "mo", chiSo };
    case "Escape": return { loai: "xoa_chon" };
    default: return null;
  }
}

/** Nhãn trợ năng cho ô chọn của một thẻ — nói rõ nó CHỌN cái gì, không chỉ "chọn". */
export const nhanOChon = (ten, daChon) =>
  `${daChon ? "Bỏ chọn" : "Chọn"} ${ten || "tài liệu"}`;

/** Thông báo vùng live cho số lượng đã chọn. Rỗng khi không chọn gì. */
export const thongBaoDaChon = (so) =>
  (so > 0 ? `Đã chọn ${so} tài liệu` : "");
