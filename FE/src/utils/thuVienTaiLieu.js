// Thư viện học tập — tìm / sắp / lọc / chia mục. THUẦN: không React, không mạng,
// không localStorage. Mọi mục trên trang đều là phép chiếu của MỘT payload
// `/api/library`, nên không có endpoint `/sections`, không có tìm kiếm phía máy chủ.

// ── Chuẩn hoá tiếng Việt ────────────────────────────────────────────────────
// NFD tách dấu ra thành ký tự tổ hợp rồi ta xoá dải U+0300–U+036F. Nhưng 'đ' KHÔNG
// phải 'd' + dấu — nó là một chữ cái riêng trong Unicode, NFD để nguyên. Không xử lý
// riêng thì gõ "dinh thoi" không ra "định thời", đúng cái người dùng gõ nhiều nhất.
// Viết bằng \u thay vì ký tự tổ hợp trần: một dấu tổ hợp đứng một mình trong mã
// nguồn hiển thị dính vào ký tự trước nó, và một lần sao chép/đổi encoding là nó im
// lặng biến mất — lúc đó bỏ dấu không còn chạy mà không test nào lộ ra ngay.
const DAU_TO_HOP = /[\u0300-\u036f]/g;

export function boDau(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(DAU_TO_HOP, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

export const tenHienThi = (d) => (d?.display_name || d?.title || "").trim();

// ── Suy ra ──────────────────────────────────────────────────────────────────
// Máy chủ đã tính `reading_minutes`; hàm này chỉ để hiển thị và để dùng lại được
// khi payload thiếu trường đó (bản ghi cũ, phản hồi upload).
export function thoiGianDoc(d) {
  if (typeof d?.reading_minutes === "number") return d.reading_minutes;
  const chars = Number(d?.char_count);
  if (!Number.isFinite(chars) || chars <= 0) return null;
  return Math.max(1, Math.ceil(chars / 1000));
}

export function nhanThoiGianDoc(phut) {
  if (phut == null) return null;
  if (phut < 60) return `${phut} phút đọc`;
  const gio = Math.floor(phut / 60);
  const du = phut % 60;
  return du ? `${gio} giờ ${du} phút đọc` : `${gio} giờ đọc`;
}

// ── Tìm kiếm ────────────────────────────────────────────────────────────────
// Gộp mọi trường tìm được thành MỘT chuỗi đã bỏ dấu. Có `entities` và `key_points`
// vì pipeline tóm tắt đã trích sẵn (đã chặn 20 / 3 ở máy chủ) — miễn phí với ta, và
// là trường chính xác nhất trên mỗi byte mà thư viện có.
export function chuoiTim(d, tenBoSuuTap = null) {
  const ai = d?.ai || {};
  const s = ai.summary || {};
  return boDau([
    d?.display_name, d?.title, d?.file_type, d?.language,
    // Tên bộ sưu tập TRUYỀN VÀO, không lấy từ tài liệu: tài liệu chỉ mang
    // `collection_id`, nên không có bản sao tên nào để lệch khi đổi tên.
    tenBoSuuTap,
    ...(Array.isArray(d?.tags) ? d.tags : []),
    s.preview,
    ...(Array.isArray(s.ai_overview) ? s.ai_overview : []),
    ...(Array.isArray(s.entities) ? s.entities : []),
  ].filter(Boolean).join("  "));
}

/**
 * `chiMucBoSuuTap` (tuỳ chọn) là Map {collection_id: bộ sưu tập} — có nó thì gõ tên
 * bộ sưu tập cũng tìm ra tài liệu bên trong.
 */
export function tim(danhSach, truyVan, chiMucBoSuuTap = null) {
  const q = boDau(truyVan);
  if (!q) return [...(danhSach || [])];
  // Mọi từ đều phải khớp (AND) — "os quiz" tìm tài liệu OS ĐÃ có quiz, không phải
  // hợp của hai tập.
  const tu = q.split(/\s+/).filter(Boolean);
  return (danhSach || []).filter((d) => {
    const ten = d?.collection_id && chiMucBoSuuTap
      ? chiMucBoSuuTap.get(d.collection_id)?.name : null;
    const kho = chuoiTim(d, ten);
    return tu.every((t) => kho.includes(t));
  });
}

// ── Lọc ─────────────────────────────────────────────────────────────────────
const LOAI_ANH = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp"]);

const SAN_SANG = new Set(["completed", "ready", "index_ready"]);

// Khai ở ĐÂY chứ không import từ `boSuuTap.js`: file kia đã import `boDau` từ file
// này, nên import ngược lại sẽ tạo vòng. Một hằng chuỗi không đáng một vòng import.
export const KHONG_PHAN_LOAI = "__khong_phan_loai__";

export const daLapChiMuc = (d) => d?.ai?.index === "ready";
export const daLuuTru = (d) => Boolean(d?.archived_at);

export const BO_LOC = {
  favorite: (d) => Boolean(d?.favorite),
  pinned: (d) => Boolean(d?.pinned),
  archived: daLuuTru,
  pdf: (d) => d?.file_type === "pdf",
  docx: (d) => d?.file_type === "docx" || d?.file_type === "doc",
  txt: (d) => d?.file_type === "txt" || d?.file_type === "md",
  image: (d) => LOAI_ANH.has(d?.file_type),
  completed: (d) => SAN_SANG.has(d?.status) || SAN_SANG.has(d?.ingest_status),
  processing: (d) => d?.ingest_status === "processing" || d?.ingest_status === "index_ready",
  failed: (d) => d?.ingest_status === "error" || d?.status === "failed",
  summary_ready: (d) => d?.ai?.summary?.state === "ready",
  mindmap_ready: (d) => d?.ai?.mindmap?.state === "ready",
  studymap_ready: (d) => d?.ai?.studymap?.state === "ready",
  quiz_ready: (d) => Boolean(d?.ai?.quiz?.ready),
  review_ready: (d) => Boolean(d?.ai?.review?.ready),
  // "Gần đây" = đã mở trong 7 ngày. Không phải "vừa tải lên" — người dùng lọc
  // "gần đây" là đang hỏi "tôi vừa HỌC gì", không phải "tôi vừa thêm gì".
  recent: (d) => {
    const t = d?.last_opened_at ? Date.parse(d.last_opened_at) : NaN;
    return Number.isFinite(t) && Date.now() - t <= 7 * 86400000;
  },
  uncategorized: (d) => !d?.collection_id,
};

/** Bộ lọc động theo bộ sưu tập / thẻ — không nằm trong BO_LOC vì giá trị do người
 *  dùng đặt, không phải một tập khoá cố định. */
export const locTheoBoSuuTap = (collectionId) => (d) => d?.collection_id === collectionId;
export const locTheoThe = (the) => {
  const k = String(the || "").toLowerCase();
  return (d) => (Array.isArray(d?.tags) ? d.tags : [])
    .some((t) => String(t || "").toLowerCase() === k);
};

/**
 * `khoa` là mảng khoá BO_LOC. Nhiều khoá = AND — chọn "PDF" và "Yêu thích" phải ra
 * tài liệu PDF được yêu thích, không phải hợp của hai tập.
 *
 * Tài liệu đã lưu trữ bị GIẤU mặc định. Chỉ hiện khi bật `hienLuuTru` hoặc khi
 * chính bộ lọc `archived` được chọn — nếu không thì mục "Đã lưu trữ" sẽ luôn rỗng.
 */
export function loc(danhSach, khoa = [], {
  hienLuuTru = false, collectionId = null, tags = [],
} = {}) {
  const dung = (khoa || []).filter((k) => BO_LOC[k]);
  const xemLuuTru = hienLuuTru || dung.includes("archived");
  const theCanCo = (tags || []).map((t) => String(t || "").toLowerCase()).filter(Boolean);
  const bstLoc = collectionId === KHONG_PHAN_LOAI
    ? (d) => !d?.collection_id
    : collectionId ? locTheoBoSuuTap(collectionId) : null;

  return (danhSach || []).filter((d) => {
    if (!xemLuuTru && daLuuTru(d)) return false;
    if (bstLoc && !bstLoc(d)) return false;
    // Nhiều thẻ là AND: chọn "AI" và "Exam" phải ra tài liệu có CẢ HAI, không phải
    // hợp của hai tập — hợp thì lọc càng nhiều kết quả càng rộng, đúng ngược ý.
    if (theCanCo.length) {
      const co = (Array.isArray(d?.tags) ? d.tags : [])
        .map((t) => String(t || "").toLowerCase());
      if (!theCanCo.every((t) => co.includes(t))) return false;
    }
    return dung.every((k) => BO_LOC[k](d));
  });
}

// ── Sắp xếp ─────────────────────────────────────────────────────────────────
const chuoi = (v) => String(v ?? "");
const moc = (v) => (v ? Date.parse(v) || 0 : 0);

const SO_SANH = {
  newest: (a, b) => moc(b.created_at) - moc(a.created_at),
  oldest: (a, b) => moc(a.created_at) - moc(b.created_at),
  recently_uploaded: (a, b) => moc(b.created_at) - moc(a.created_at),
  recently_opened: (a, b) => moc(b.last_opened_at) - moc(a.last_opened_at),
  // Khác `recently_opened`: điểm này do MÁY CHỦ tính, gộp độ mới với tần suất mở
  // (`open_count`) — thứ client không có công thức nào để tự suy ra.
  recently_studied: (a, b) => (Number(b?.recency_score) || 0) - (Number(a?.recency_score) || 0)
    || moc(b.last_opened_at) - moc(a.last_opened_at),
  az: (a, b) => boDau(tenHienThi(a)).localeCompare(boDau(tenHienThi(b))),
  za: (a, b) => boDau(tenHienThi(b)).localeCompare(boDau(tenHienThi(a))),
  // Chưa đếm được ký tự thì xuống cuối ở CẢ HAI chiều: "không biết" không phải
  // "ngắn nhất", và đẩy nó lên đầu làm hỏng đúng câu hỏi người dùng đang hỏi.
  reading_time: (a, b) => {
    const x = thoiGianDoc(a);
    const y = thoiGianDoc(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return y - x;
  },
};

export const CHE_DO_SAP = Object.keys(SO_SANH);

/**
 * Quy tắc TOÀN CỤC: Ghim → Yêu thích → chế độ sắp.
 *
 * Chế độ chỉ sắp BÊN TRONG hai nhóm ấy, nên "A-Z" không bao giờ chôn một tài liệu
 * đã ghim xuống giữa danh sách. Người dùng ghim là để nó ở trên; một chế độ sắp
 * xoá được điều đó thì cái ghim vô nghĩa.
 *
 * Luôn trả MẢNG MỚI — `Array.prototype.sort` sửa tại chỗ, và sửa tại chỗ một mảng
 * state của React là một lần render bị bỏ qua.
 */
export function sapXep(danhSach, cheDo = "newest") {
  const ss = SO_SANH[cheDo] || SO_SANH.newest;
  return [...(danhSach || [])].sort((a, b) => {
    const ghim = Number(Boolean(b?.pinned)) - Number(Boolean(a?.pinned));
    if (ghim) return ghim;
    const thich = Number(Boolean(b?.favorite)) - Number(Boolean(a?.favorite));
    if (thich) return thich;
    return ss(a, b) || chuoi(a?.document_id).localeCompare(chuoi(b?.document_id));
  });
}

// ── Mốc thời gian ───────────────────────────────────────────────────────────
// Tính theo lịch ĐỊA PHƯƠNG chứ không phải "24 giờ trước": 23:00 hôm qua là "hôm
// qua" với người dùng, dù mới cách 2 tiếng. Trừ 24h sẽ gọi nó là "hôm nay".
export function dauNgay(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function nhomThoiGian(iso, now = Date.now()) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const homNay = dauNgay(now);
  if (t >= homNay) return "today";
  if (t >= homNay - 86400000) return "yesterday";
  if (t >= homNay - 6 * 86400000) return "this_week";
  return "older";
}

// ── Chia mục ────────────────────────────────────────────────────────────────
const TOI_DA_GAN_DAY = 6;

/**
 * 12 mục hiển thị của Thư viện (Collections là Phase 1B — KHÔNG dựng chỗ trống).
 *
 * `danhSach` phải là danh sách ĐÃ tìm + ĐÃ lọc: gõ vào ô tìm mà các mục trên đầu
 * không đổi theo thì chúng đang nói về một thư viện khác với danh sách bên dưới.
 *
 * Mục rỗng KHÔNG được dựng — một mục "Cần tóm tắt" trống rỗng chỉ thêm nhiễu.
 */
export function chiaMuc(danhSach, { hienLuuTru = false, now = Date.now() } = {}) {
  const tatCa = danhSach || [];
  const hien = hienLuuTru ? tatCa : tatCa.filter((d) => !daLuuTru(d));

  // "Cần X" chỉ có nghĩa với tài liệu ĐÃ vào chỉ mục: mời tạo tóm tắt cho tài liệu
  // chưa có đoạn nào thì máy chủ trả 400 và người dùng không làm gì được.
  const daIndex = hien.filter(daLapChiMuc);

  const tiepTuc = sapXep(hien.filter((d) => d.last_opened_at), "recently_opened")[0] || null;

  // "Học gần đây" sắp theo ĐIỂM của máy chủ (độ mới × tần suất), không chỉ theo mốc
  // mở cuối: một tài liệu học 20 lần tuần trước liên quan hơn một tài liệu mở đúng
  // một lần hôm qua.
  const mucGanDay = sapXep(
    hien.filter((d) => d.last_opened_at && d.document_id !== tiepTuc?.document_id),
    "recently_studied",
  ).slice(0, TOI_DA_GAN_DAY);

  const theoNgay = (nhom) => sapXep(
    hien.filter((d) => nhomThoiGian(d.last_opened_at, now) === nhom), "recently_studied");

  return {
    tiepTucHoc: tiepTuc,
    daGhim: sapXep(hien.filter((d) => d.pinned), "newest"),
    yeuThich: sapXep(hien.filter((d) => d.favorite && !d.pinned), "newest"),
    hocGanDay: mucGanDay,
    // Ba mục theo lịch — THUẦN CLIENT, suy từ `last_opened_at` đã có trong payload.
    // Không cột nào, không truy vấn nào: một mốc thời gian đã đủ để chia ngày.
    homNay: theoNgay("today"),
    homQua: theoNgay("yesterday"),
    tuanNay: theoNgay("this_week"),
    taiLenGanDay: sapXep(hien, "recently_uploaded").slice(0, TOI_DA_GAN_DAY),
    chuaMoBaoGio: sapXep(daIndex.filter((d) => !d.last_opened_at), "newest"),
    canTomTat: sapXep(daIndex.filter((d) => d.ai?.summary?.state === "not_generated"), "newest"),
    canSoDo: sapXep(
      daIndex.filter((d) => d.ai?.mindmap?.state === "not_generated"
        && d.ai?.studymap?.state === "not_generated"), "newest"),
    canQuiz: sapXep(daIndex.filter((d) => !d.ai?.quiz?.ready), "newest"),
    // Hướng dẫn ôn tập chỉ dựng được TỪ một bài đã chấm — mời tạo nó khi chưa ai
    // làm bài nào là mời vào một ngõ cụt.
    canOnTap: sapXep(
      daIndex.filter((d) => (d.ai?.quiz?.graded_attempts || 0) > 0 && !d.ai?.review?.ready),
      "newest"),
    daLuuTru: sapXep(tatCa.filter(daLuuTru), "newest"),
    tatCa: hien,
  };
}
