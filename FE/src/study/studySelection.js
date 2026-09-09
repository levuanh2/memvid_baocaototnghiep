// Trạng thái CHỌN dùng chung giữa Summary/MindMap/Knowledge/Câu hỏi gợi ý/Tiếp tục
// học/Chat (Phase 4A.1) — THUẦN, tách khỏi Provider để test không cần dựng React.
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
};

const KHOA_THEO_TAI_LIEU = [
  "selectedTopic", "selectedEntity", "selectedSummary", "selectedNode", "selectedQuestion",
];

/**
 * Đổi tài liệu đang xem: mọi lựa chọn khác (chủ đề/thực thể/mục tóm tắt/node/câu
 * hỏi) thuộc về tài liệu CŨ — giữ lại thì một chủ đề của tài liệu A tô sáng nhầm
 * sang tài liệu B vừa mở. `learningMode` KHÔNG bị xoá: đó là chế độ hiển thị của
 * phiên làm việc (Focus/Reader/Tutor...), không thuộc về một tài liệu cụ thể.
 * Chọn LẠI đúng tài liệu đang xem là no-op — không tạo object mới, không xoá gì.
 */
export function chonDoc(state, documentId) {
  if (state.selectedDocument === documentId) return state;
  return { ...TRANG_THAI_RONG, selectedDocument: documentId, learningMode: state.learningMode };
}

export const chonTopic = (state, topic) => ({ ...state, selectedTopic: topic });
export const chonEntity = (state, entity) => ({ ...state, selectedEntity: entity });
export const chonSummary = (state, summaryId) => ({ ...state, selectedSummary: summaryId });
export const chonNode = (state, nodeId) => ({ ...state, selectedNode: nodeId });
export const chonQuestion = (state, questionId) => ({ ...state, selectedQuestion: questionId });
export const datLearningMode = (state, mode) => ({ ...state, learningMode: mode });

/** Xoá MỘT lựa chọn theo khoá. `selectedDocument`/`learningMode` không xoá được qua
 * đây (dùng `chonDoc`/`datLearningMode` cho hai trường đó) — khoá lạ cũng no-op. */
export function xoaLuaChon(state, key) {
  if (!KHOA_THEO_TAI_LIEU.includes(key)) return state;
  return { ...state, [key]: null };
}
