// Bộ nhớ Gia sư AI (Phase 4C, Step 5) — THUẦN, sống trong một phiên, KHÔNG lưu
// server, KHÔNG phải bản sao của Study Context. Study Context giữ lựa chọn
// HIỆN TẠI (một giá trị mỗi trường); đây là NHẬT KÝ các lựa chọn ĐÃ QUA — hai
// việc khác nhau, không trùng dữ liệu: mất tab/refresh là mất sạch, đúng ý
// "session-only, no persistence".
const CAP = 8;

export const TRANG_THAI_RONG = {
  recentQuestions: [],   // [{ id, text, at }]
  openedTopics: [],      // [{ value, at }]
  visitedNodes: [],       // [{ value, at }]
  selectedEntities: [],    // [{ value, at }]
};

/** Đẩy lên đầu, gộp trùng theo `key`, cắt còn CAP mục — mới nhất luôn đứng đầu. */
function themVaoDau(list, item, key) {
  const con = list.filter((x) => x[key] !== item[key]);
  return [item, ...con].slice(0, CAP);
}

export function ghiCauHoi(state, id, text, now = Date.now()) {
  if (!id) return state;
  return { ...state, recentQuestions: themVaoDau(state.recentQuestions, { id, text: text || id, at: now }, "id") };
}
export function ghiChuDe(state, value, now = Date.now()) {
  if (!value) return state;
  return { ...state, openedTopics: themVaoDau(state.openedTopics, { value, at: now }, "value") };
}
export function ghiNode(state, value, now = Date.now()) {
  if (!value) return state;
  return { ...state, visitedNodes: themVaoDau(state.visitedNodes, { value, at: now }, "value") };
}
export function ghiThucThe(state, value, now = Date.now()) {
  if (!value) return state;
  return { ...state, selectedEntities: themVaoDau(state.selectedEntities, { value, at: now }, "value") };
}
