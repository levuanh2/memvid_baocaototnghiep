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
  selectedEvidence: null,
  learningMode: null,
  // Phase 4B: bề mặt vừa TẠO RA lựa chọn nội dung gần nhất (một trong
  // SELECTION_SOURCES) + mốc thời gian của nó — Breadcrumb đọc hai trường này để
  // vẽ "đang ở đâu", không suy từ URL.
  selectionSource: null,
  timestamp: null,
  // Feature Pack A (Research Timeline) — nhật ký CÓ GIỚI HẠN của chính các lần
  // chonX bên dưới, không phải một kho dữ liệu thứ hai: mỗi mục chỉ giữ
  // {kind, id, label, source, at}, đúng kỷ luật "chỉ ID/khoá" ở trên, cùng khuôn
  // với recentItems cục bộ mà useMindMapController đã tự làm cho riêng MindMap —
  // đây là bản CHUNG cho cả app. Xoá tài liệu (chonDoc) xoá nhật ký theo, vì mọi
  // mục cũ thuộc về tài liệu vừa rời — giữ lại thì "vừa xem" trỏ sang tài liệu
  // không còn mở.
  history: [],
};

/** Năm bề mặt có thể tạo ra một lựa chọn nội dung. "chat" (Feature Pack A) là bề
 * mặt thứ sáu — trước đây ChatArea không hề gọi hàm chọn nào trong module này. */
export const SELECTION_SOURCES = [
  "mindmap", "summary", "knowledge", "question", "continue_learning", "chat",
];

/** Các loại mục trong nhật ký — đúng bằng tên trường nội dung, bỏ tiền tố "selected". */
export const HISTORY_KINDS = ["topic", "entity", "summary", "node", "question", "evidence"];

const HISTORY_CAP = 50;

const KHOA_THEO_TAI_LIEU = [
  "selectedTopic", "selectedEntity", "selectedSummary", "selectedNode", "selectedQuestion",
  "selectedEvidence",
];

/** Đẩy một mục vào nhật ký, cắt còn HISTORY_CAP mục MỚI NHẤT (FIFO). Luôn trả
 * mảng mới — không sửa tại chỗ, cùng lý do StudyCard/panelLayout đã có ở nơi khác
 * trong kho: mảng state sửa tại chỗ làm React bỏ qua một lần render. */
function themVaoLichSu(history, entry) {
  const next = [...history, entry];
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
}

/** Áp một lựa chọn NỘI DUNG + đóng dấu bề mặt/thời điểm + ghi một mục nhật ký.
 * `now` nhận qua tham số để test được xác định — không gọi `Date.now()` ở nhiều
 * nơi khác nhau trong module (bài học 2026-09-01, audit vòng 6). `label` là chữ
 * hiển thị được cho mục nhật ký (tiêu đề node, nguyên văn câu hỏi…) — do NƠI GỌI
 * cung cấp từ dữ liệu nó ĐÃ có sẵn trong tầm tay lúc chọn, không phải một bản sao
 * lưu lại: thiếu thì tụt về chính `id`, không bao giờ trống hẳn trên giao diện.
 *
 * Mỗi lần gọi là MỘT mục nhật ký mới, kể cả chọn lại đúng ID vừa chọn — nhật ký
 * ghi "người dùng vừa làm gì", không phải "cái gì đang được chọn" (đó là việc của
 * `selectedX` ở trên, có guard riêng nếu cần — xem `chonDoc`).
 */
function ghiLuaChon(state, patch, kind, { source = null, now = Date.now(), label } = {}) {
  const id = Object.values(patch)[0];
  const entry = { kind, id, label: label ?? String(id), source, at: now };
  return {
    ...state, ...patch,
    selectionSource: source,
    timestamp: now,
    history: themVaoLichSu(state.history, entry),
  };
}

/**
 * Đổi tài liệu đang xem: mọi lựa chọn khác (chủ đề/thực thể/mục tóm tắt/node/câu
 * hỏi/bằng chứng) thuộc về tài liệu CŨ — giữ lại thì một chủ đề của tài liệu A tô
 * sáng nhầm sang tài liệu B vừa mở. Nhật ký (Feature Pack A) cùng lý do: một mục
 * "vừa xem node X" của tài liệu cũ vô nghĩa khi tài liệu đang mở đã khác.
 * `learningMode` KHÔNG bị xoá: đó là chế độ hiển thị của phiên làm việc
 * (Focus/Reader/Tutor...), không thuộc về một tài liệu cụ thể.
 * Chọn LẠI đúng tài liệu đang xem là no-op — không tạo object mới, không xoá gì,
 * không đóng dấu lại source/timestamp cũ, không đụng nhật ký.
 */
export function chonDoc(state, documentId, opts) {
  if (state.selectedDocument === documentId) return state;
  return {
    ...TRANG_THAI_RONG,
    learningMode: state.learningMode,
    selectedDocument: documentId,
    selectionSource: opts?.source ?? null,
    timestamp: opts?.now ?? Date.now(),
  };
}

export const chonTopic = (state, topic, opts) => ghiLuaChon(state, { selectedTopic: topic }, "topic", opts);
export const chonEntity = (state, entity, opts) => ghiLuaChon(state, { selectedEntity: entity }, "entity", opts);
export const chonSummary = (state, summaryId, opts) => ghiLuaChon(state, { selectedSummary: summaryId }, "summary", opts);
export const chonNode = (state, nodeId, opts) => ghiLuaChon(state, { selectedNode: nodeId }, "node", opts);
export const chonQuestion = (state, questionId, opts) => ghiLuaChon(state, { selectedQuestion: questionId }, "question", opts);
/** Feature Pack A — hành động thứ sáu, mirror đúng năm hành động trên. Đóng
 * khoảng trống thật: trước đây không có cách nào để "vừa mở một trích đoạn bằng
 * chứng" đi vào Study Context, nên bề mặt duy nhất không GHI được vào nhật ký
 * chung là bề mặt duy nhất người dùng thật sự đọc trích dẫn. */
export const chonEvidence = (state, evidenceId, opts) => ghiLuaChon(state, { selectedEvidence: evidenceId }, "evidence", opts);

// KHÔNG một "lựa chọn nội dung": chế độ hiển thị của phiên làm việc, không gắn với
// bề mặt/mốc thời gian mà Breadcrumb quan tâm, không ghi vào nhật ký.
export const datLearningMode = (state, mode) => ({ ...state, learningMode: mode });

/** Xoá MỘT lựa chọn theo khoá. `selectedDocument`/`learningMode`/`selectionSource`/
 * `timestamp`/`history` không xoá được qua đây (dùng `chonDoc`/`datLearningMode`/
 * `xoaLichSu` cho các trường đó) — khoá lạ cũng no-op. */
export function xoaLuaChon(state, key) {
  if (!KHOA_THEO_TAI_LIEU.includes(key)) return state;
  return { ...state, [key]: null };
}

/** Feature Pack A — xoá TOÀN BỘ nhật ký, hành động RIÊNG khỏi `xoaLuaChon` vì
 * ngữ nghĩa khác hẳn: `xoaLuaChon` xoá một khoá lựa chọn HIỆN TẠI (con trỏ một
 * ô), còn đây xoá một MẢNG (nhật ký), không đụng tới `selectedX` nào đang có —
 * người dùng có thể "xoá lịch sử đã xem" mà không mất lựa chọn đang xem dở. */
export function xoaLichSu(state) {
  if (state.history.length === 0) return state;
  return { ...state, history: [] };
}
