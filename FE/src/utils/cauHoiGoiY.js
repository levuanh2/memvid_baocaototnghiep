// Chips câu hỏi chỉ diễn giải payload đã có.  Không tạo câu hỏi, không tự đoán route:
// nếu thiếu dữ liệu thì trả trạng thái rỗng có hướng hành động thật cho người học.
import { duongDi } from "./tiepTucHoc";

export const DANH_MUC = [
  "Explain", "Definitions", "Summarize", "QuizMe", "Compare", "Timeline",
  "Architecture", "Implementation", "ProsCons",
];

const NHAN = {
  Explain: "Giải thích",
  Definitions: "Định nghĩa",
  Summarize: "Tóm tắt",
  QuizMe: "Kiểm tra tôi",
  Compare: "So sánh",
  Timeline: "Trình tự",
  Architecture: "Cấu trúc",
  Implementation: "Cách hoạt động",
  ProsCons: "Ưu & nhược",
};

// Tất cả tên ở đây đều thuộc registry tường minh của components/ui/Icon.jsx.
const BIEU_TUONG = {
  Explain: "MessageSquareText",
  Definitions: "BookOpen",
  Summarize: "ScrollText",
  QuizMe: "MessageCircleQuestion",
  Compare: "MessagesSquare",
  Timeline: "Clock",
  Architecture: "Network",
  Implementation: "Spline",
  ProsCons: "Star",
};

const BE_MAT = { chat: "chat", quiz: "quiz", studymap: "studymap" };
const mang = (value) => (Array.isArray(value) ? value : []);

export function nhanDanhMuc(category) {
  return NHAN[category] || (category == null ? "" : String(category));
}

// `reason.source` — nguồn Tier-0 gán ở `cau_hoi_goi_y.py::_candidate`. Nhãn ở đây
// dịch NGUỒN ra chữ; `reason.value` (chủ đề/thực thể/phần…) giữ nguyên, không dịch.
const NHAN_LY_DO = {
  topic: "Chủ đề",
  weak_mastery: "Cần ôn",
  relation: "Liên hệ",
  entity: "Thực thể",
  section: "Phần",
};

/** "Chủ đề: Định thời" — chip lý do cho MỘT câu hỏi gợi ý. `null` khi thiếu dữ liệu. */
export function nhanLyDoCauHoi(reason) {
  if (!reason || typeof reason !== "object") return null;
  const value = typeof reason.value === "string" ? reason.value.trim() : "";
  if (!value) return null;
  const nhan = NHAN_LY_DO[reason.source];
  return nhan ? `${nhan}: ${value}` : value;
}

export function bieuTuongDanhMuc(category) {
  return BIEU_TUONG[category] || "MessageSquare";
}

export function nhomTheoDanhMuc(questions) {
  const groups = new Map();
  for (const question of mang(questions)) {
    if (!question || typeof question !== "object" || !question.category) continue;
    const category = String(question.category);
    if (!groups.has(category)) {
      groups.set(category, {
        category,
        nhan: nhanDanhMuc(category),
        icon: bieuTuongDanhMuc(category),
        cauHoi: [],
      });
    }
    groups.get(category).cauHoi.push({
      ...question,
      reason: question.reason && typeof question.reason === "object" ? { ...question.reason } : question.reason,
    });
  }
  return [...groups.values()];
}

export function duongDiCauHoi(question, doc) {
  const beMat = BE_MAT[question?.target];
  return beMat && doc?.document_id ? duongDi(doc, beMat) : null;
}

export function trangThaiRongCauHoi(questions, { dangTai = false } = {}) {
  if (dangTai) {
    return {
      loai: "dang_tai",
      tieuDe: "Đang tải câu hỏi gợi ý",
      goiY: "Đang đọc các chủ đề và phần nội dung của tài liệu.",
    };
  }
  if (!mang(questions).length) {
    return {
      loai: "rong",
      tieuDe: "Chưa có câu hỏi gợi ý",
      goiY: "Tài liệu chưa có chủ đề, thực thể hoặc phần nội dung; hãy lập chỉ mục rồi tạo tóm tắt.",
    };
  }
  return {
    loai: "co",
    tieuDe: "Câu hỏi gợi ý",
    goiY: "Chọn một câu hỏi để tiếp tục học với tài liệu này.",
  };
}
