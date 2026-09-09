// Màn hình rỗng — THUẦN. Trả nội dung, không render.
//
// Ba trạng thái KHÁC NHAU thường bị gộp làm một, và gộp là nói dối:
//
//   chưa có gì            thư viện thật sự trống      → mời tải lên
//   không khớp bộ lọc     có tài liệu, lọc quá chặt   → mời nới bộ lọc
//   hỏng                  không tải được              → mời thử lại
//
// Người có đủ tài liệu mà đọc "Chưa có tài liệu nào" sẽ đi tải lên lại từ đầu.
// Bài học này đã có trong .playbook (2026-09-01, mục "Hỏng và rỗng là hai màn hình").
//
// Mỗi trạng thái phải MỜI một hành động cụ thể. Một màn hình rỗng không có lối ra
// là một ngõ cụt, và người dùng học được rằng khu vực đó không dùng được.

export const NGU_CANH = {
  THU_VIEN: "thu_vien",
  BO_LOC: "bo_loc",
  BO_SUU_TAP: "bo_suu_tap",
  YEU_THICH: "yeu_thich",
  GHIM: "ghim",
  GAN_DAY: "gan_day",
  LUU_TRU: "luu_tru",
  CAN_TOM_TAT: "can_tom_tat",
  CAN_SO_DO: "can_so_do",
};

const NOI_DUNG = {
  [NGU_CANH.THU_VIEN]: {
    icon: "FileStack",
    tieuDe: "Chưa có tài liệu nào",
    goiY: "Tải lên PDF, Word, PowerPoint, Excel, Markdown, EPUB hoặc ảnh chụp trang sách. "
      + "Mỗi tài liệu sẽ được lập chỉ mục để hỏi đáp, tóm tắt và tạo quiz.",
    hanhDong: "Tải tài liệu",
    khoaHanhDong: "tai_len",
  },
  [NGU_CANH.BO_LOC]: {
    icon: "Search",
    tieuDe: "Không có tài liệu nào khớp",
    goiY: "Thử bớt từ khoá, bỏ một bộ lọc, hoặc bật “Hiện đã lưu trữ”.",
    hanhDong: "Xoá tìm kiếm và bộ lọc",
    khoaHanhDong: "xoa_loc",
  },
  [NGU_CANH.BO_SUU_TAP]: {
    icon: "FolderOpen",
    tieuDe: "Bộ sưu tập này còn trống",
    goiY: "Chọn vài tài liệu rồi dùng “Chuyển” để đưa chúng vào đây.",
    hanhDong: "Xem tất cả tài liệu",
    khoaHanhDong: "xoa_loc",
  },
  [NGU_CANH.YEU_THICH]: {
    icon: "Star",
    tieuDe: "Chưa có tài liệu yêu thích",
    goiY: "Đánh dấu sao những tài liệu bạn quay lại nhiều để chúng luôn nằm gần đầu.",
    hanhDong: "Xem tất cả tài liệu",
    khoaHanhDong: "xoa_loc",
  },
  [NGU_CANH.GHIM]: {
    icon: "Pin",
    tieuDe: "Chưa ghim tài liệu nào",
    goiY: "Ghim tài liệu đang học để nó đứng đầu mọi cách sắp xếp.",
    hanhDong: "Xem tất cả tài liệu",
    khoaHanhDong: "xoa_loc",
  },
  [NGU_CANH.GAN_DAY]: {
    icon: "Clock",
    tieuDe: "Chưa mở tài liệu nào",
    goiY: "Mở một tài liệu để bắt đầu — lần sau bạn sẽ quay lại đúng chỗ đang dở.",
    hanhDong: "Xem tất cả tài liệu",
    khoaHanhDong: "xoa_loc",
  },
  [NGU_CANH.LUU_TRU]: {
    icon: "Archive",
    tieuDe: "Chưa lưu trữ tài liệu nào",
    // Nói rõ lưu trữ KHÔNG phải xoá: đây là hiểu nhầm phổ biến nhất về nút này, và
    // tài liệu đã lưu trữ vẫn được AI tra cứu.
    goiY: "Lưu trữ giúp dọn thư viện mà không xoá gì — tài liệu đã lưu trữ vẫn được "
      + "AI dùng khi trả lời.",
    hanhDong: null,
    khoaHanhDong: null,
  },
  [NGU_CANH.CAN_TOM_TAT]: {
    icon: "ScrollText",
    tieuDe: "Mọi tài liệu đều đã có tóm tắt",
    goiY: "Không còn gì phải tạo thêm ở đây.",
    hanhDong: null,
    khoaHanhDong: null,
  },
  [NGU_CANH.CAN_SO_DO]: {
    icon: "Network",
    tieuDe: "Mọi tài liệu đều đã có sơ đồ",
    goiY: "Không còn gì phải tạo thêm ở đây.",
    hanhDong: null,
    khoaHanhDong: null,
  },
};

/**
 * Nội dung cho một màn hình rỗng.
 *
 * `coTaiLieu` phân biệt "thư viện trống" với "bộ lọc quá chặt" — hai câu trả lời
 * hoàn toàn khác nhau cho cùng một danh sách rỗng.
 */
export function trangThaiRong(nguCanh, { coTaiLieu = false } = {}) {
  if (nguCanh === NGU_CANH.THU_VIEN && coTaiLieu) {
    return { ...NOI_DUNG[NGU_CANH.BO_LOC] };
  }
  return { ...(NOI_DUNG[nguCanh] || NOI_DUNG[NGU_CANH.THU_VIEN]) };
}

/** Ngữ cảnh phù hợp với bộ lọc đang bật — mục đang xem quyết định lời mời. */
export function nguCanhTuBoLoc({ collectionId, tags = [], khoa = [], truyVan = "" } = {}) {
  if (truyVan.trim()) return NGU_CANH.BO_LOC;
  if (collectionId) return NGU_CANH.BO_SUU_TAP;
  if (tags.length) return NGU_CANH.BO_LOC;
  if (khoa.includes("favorite")) return NGU_CANH.YEU_THICH;
  if (khoa.includes("pinned")) return NGU_CANH.GHIM;
  if (khoa.includes("archived")) return NGU_CANH.LUU_TRU;
  if (khoa.includes("recent")) return NGU_CANH.GAN_DAY;
  if (khoa.length) return NGU_CANH.BO_LOC;
  return NGU_CANH.THU_VIEN;
}
