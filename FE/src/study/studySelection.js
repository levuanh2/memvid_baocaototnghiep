// Trạng thái CHỌN dùng chung giữa Summary/MindMap/Knowledge/Câu hỏi gợi ý/Tiếp tục
// học/Chat (Phase 4A.1, mở rộng Phase 4B) — THUẦN, tách khỏi Provider để test
// không cần dựng React.
//
// Chỉ lưu ID/khoá, KHÔNG lưu bản sao đối tượng: mỗi module (StudyMapView có
// `focusedId`+node đầy đủ, SummaryPanel có section đầy đủ...) vẫn giữ state CHI
// TIẾT của riêng nó. Study Context chỉ là tầng PHÁT lựa chọn cho module khác biết
// module này đang xem gì — không phải kho dữ liệu thứ hai của cùng một thứ.
export const TRANG_THAI_RONG = {
  selectedDocument: null,
  selectedTopic: null,
  selectedEntity: null,
  selectedSummary: null,
  selectedNode: null,
  selectedQuestion: null,
  learningMode: null,
  // Phase 4B: bề mặt vừa TẠO RA lựa chọn nội dung gần nhất (một trong
  // SELECTION_SOURCES) + mốc thời gian của nó — Breadcrumb đọc hai trường này để
  // vẽ "đang ở đâu", không suy từ URL.
  selectionSource: null,
  timestamp: null,
};

/** Năm bề mặt có thể tạo ra một lựa chọn nội dung. */
export const SELECTION_SOURCES = [
  "mindmap", "summary", "knowledge", "question", "continue_learning",
];

const KHOA_THEO_TAI_LIEU = [
  "selectedTopic", "selectedEntity", "selectedSummary", "selectedNode", "selectedQuestion",
];

/** Áp một lựa chọn NỘI DUNG + đóng dấu bề mặt/thời điểm. `now` nhận qua tham số để
 * test được xác định — không gọi `Date.now()` ở nhiều nơi khác nhau trong module. */
function ghiLuaChon(state, patch, { source = null, now = Date.now() } = {}) {
  return { ...state, ...patch, selectionSource: source, timestamp: now };
}

/**
 * Đổi tài liệu đang xem: mọi lựa chọn khác (chủ đề/thực thể/mục tóm tắt/node/câu
 * hỏi) thuộc về tài liệu CŨ — giữ lại thì một chủ đề của tài liệu A tô sáng nhầm
 * sang tài liệu B vừa mở. `learningMode` KHÔNG bị xoá: đó là chế độ hiển thị của
 * phiên làm việc (Focus/Reader/Tutor...), không thuộc về một tài liệu cụ thể.
 * Chọn LẠI đúng tài liệu đang xem là no-op — không tạo object mới, không xoá gì,
 * không đóng dấu lại source/timestamp cũ.
 */
export function chonDoc(state, documentId, opts) {
  if (state.selectedDocument === documentId) return state;
  return ghiLuaChon(
    { ...TRANG_THAI_RONG, learningMode: state.learningMode },
    { selectedDocument: documentId },
    opts,
  );
}

export const chonTopic = (state, topic, opts) => ghiLuaChon(state, { selectedTopic: topic }, opts);
export const chonEntity = (state, entity, opts) => ghiLuaChon(state, { selectedEntity: entity }, opts);
export const chonSummary = (state, summaryId, opts) => ghiLuaChon(state, { selectedSummary: summaryId }, opts);
export const chonNode = (state, nodeId, opts) => ghiLuaChon(state, { selectedNode: nodeId }, opts);
export const chonQuestion = (state, questionId, opts) => ghiLuaChon(state, { selectedQuestion: questionId }, opts);

// KHÔNG một "lựa chọn nội dung": chế độ hiển thị của phiên làm việc, không gắn với
// bề mặt/mốc thời gian mà Breadcrumb quan tâm.
export const datLearningMode = (state, mode) => ({ ...state, learningMode: mode });

/** Xoá MỘT lựa chọn theo khoá. `selectedDocument`/`learningMode`/`selectionSource`/
 * `timestamp` không xoá được qua đây (dùng `chonDoc`/`datLearningMode` cho các
 * trường đóng dấu) — khoá lạ cũng no-op. */
export function xoaLuaChon(state, key) {
  if (!KHOA_THEO_TAI_LIEU.includes(key)) return state;
  return { ...state, [key]: null };
}
