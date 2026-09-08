// Thẻ AI Insight sau khi tải lên — máy trạng thái THUẦN.
//
// Quy tắc số một: **không bao giờ nói AI đã đọc xong khi chưa có tóm tắt.**
//
// Ingest KHÔNG tự tạo tóm tắt (chỉ `POST /generate-summary` mới tạo), nên ngay lúc
// upload trả 201 thì tài liệu chưa có đoạn nào, chưa có tóm tắt nào. Thêm nữa,
// `_unique_display_filename` đặt cho mỗi lần tải lên một tên khác nhau nên kể cả
// tải lại đúng file cũ cũng ra stem khác và không trúng cache. Vì vậy trạng thái
// "AI đã đọc xong" chỉ đạt tới khi có một bản tóm tắt THẬT — thường là sau khi
// người dùng bấm tạo.
//
// Trạng thái vẫn được viết đủ ở đây, và nó tự đúng khi Phase 1C thêm auto-summary
// cuối ingest: lúc ấy không phải sửa gì trong file này.

export const GIAI_DOAN = {
  DANG_TAI: "dang_tai",
  DANG_DOC: "dang_doc",
  DANG_LAP_CHI_MUC: "dang_lap_chi_muc",
  SAN_SANG: "san_sang",
  CO_TOM_TAT: "co_tom_tat",
  HONG: "hong",
};

const so = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * @param doc  mục thư viện (hoặc phản hồi 201 của upload), `null` khi đang tải lên
 * @param opts.dangTai  request upload còn đang bay
 */
export function giaiDoanInsight(doc, { dangTai = false } = {}) {
  if (dangTai || !doc) return GIAI_DOAN.DANG_TAI;

  if (doc.ingest_status === "error" || doc.status === "failed") return GIAI_DOAN.HONG;

  const ai = doc.ai || {};
  if (ai.summary?.state === "ready") return GIAI_DOAN.CO_TOM_TAT;

  const daIndex = Boolean(doc.capabilities?.chunk_query) || ai.index === "ready";
  if (daIndex) return GIAI_DOAN.SAN_SANG;

  return so(doc.progress) >= 0.3 ? GIAI_DOAN.DANG_LAP_CHI_MUC : GIAI_DOAN.DANG_DOC;
}

/**
 * Nội dung thẻ. Mỗi giai đoạn chỉ nói ĐÚNG thứ đang thật.
 *
 * `yChinh` chỉ có ở giai đoạn CO_TOM_TAT, và nó là AI Overview suy từ bản tóm tắt
 * có thật — không phải chỗ giữ chỗ, không phải văn bản bịa.
 */
export function noiDungInsight(doc, { dangTai = false, tenTep = "" } = {}) {
  const giaiDoan = giaiDoanInsight(doc, { dangTai });
  const ten = (doc?.display_name || doc?.title || tenTep || "Tài liệu").trim();
  const ai = doc?.ai || {};

  switch (giaiDoan) {
    case GIAI_DOAN.DANG_TAI:
      return { giaiDoan, ten, tieuDe: "Đang tải lên…", moTa: null,
               yChinh: [], hanhDong: [], dangChay: true };

    case GIAI_DOAN.DANG_DOC:
      return { giaiDoan, ten, tieuDe: "Đang đọc nội dung…",
               moTa: "Tài liệu đang được trích xuất văn bản.",
               yChinh: [], hanhDong: [], dangChay: true };

    case GIAI_DOAN.DANG_LAP_CHI_MUC:
      return { giaiDoan, ten, tieuDe: "Đang lập chỉ mục…",
               moTa: "Sắp có thể hỏi đáp trên tài liệu này.",
               yChinh: [], hanhDong: [], dangChay: true };

    case GIAI_DOAN.SAN_SANG:
      return {
        giaiDoan, ten,
        tieuDe: "Đã sẵn sàng tra cứu",
        // Nói con số THẬT đang có, không hứa thứ chưa tồn tại.
        moTa: [doc?.page_count ? `${doc.page_count} trang` : null,
               doc?.chunk_count ? `${doc.chunk_count} đoạn` : null]
          .filter(Boolean).join(" · ") || null,
        yChinh: [],
        // Tóm tắt chưa có, nên đây là một LỜI MỜI, không phải một thông báo.
        hanhDong: ["tom_tat", "so_do", "hoi_ai"],
        dangChay: false,
      };

    case GIAI_DOAN.CO_TOM_TAT:
      return {
        giaiDoan, ten,
        tieuDe: "AI đã đọc xong tài liệu này",
        moTa: ai.summary?.preview || null,
        yChinh: Array.isArray(ai.summary?.ai_overview) ? ai.summary.ai_overview : [],
        hanhDong: ["mo_tom_tat",
                   ...(ai.mindmap?.state === "ready" || ai.studymap?.state === "ready"
                     ? ["mo_so_do"] : []),
                   "hoi_ai"],
        dangChay: false,
      };

    case GIAI_DOAN.HONG:
    default:
      return {
        giaiDoan: GIAI_DOAN.HONG, ten,
        tieuDe: "Xử lý tài liệu thất bại",
        // Thông báo THẬT của máy chủ. Nuốt nó rồi thay bằng câu chung chung là lấy
        // mất đường duy nhất để người dùng tự sửa.
        moTa: doc?.error || "Không rõ nguyên nhân.",
        yChinh: [], hanhDong: ["tai_lai"], dangChay: false,
      };
  }
}

// ── Đã đóng, theo từng tài liệu ─────────────────────────────────────────────
const KHOA = "memvidx.insight.dismissed.v1";

const doc_ = () => {
  try {
    const raw = localStorage.getItem(KHOA);
    const data = raw ? JSON.parse(raw) : null;
    return Array.isArray(data) ? data.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export const daDong = (documentId) => Boolean(documentId) && doc_().includes(documentId);

export function dongInsight(documentId) {
  if (!documentId) return;
  try {
    // Giữ 50 mục gần nhất: danh sách này chỉ để khỏi hiện lại một thẻ đã đóng, nó
    // không đáng lớn vô hạn trong localStorage.
    const ds = [documentId, ...doc_().filter((x) => x !== documentId)].slice(0, 50);
    localStorage.setItem(KHOA, JSON.stringify(ds));
  } catch { /* chế độ riêng tư: không đóng được thì thẻ hiện lại, không phải lỗi */ }
}
