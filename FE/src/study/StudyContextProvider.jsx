import { useCallback, useMemo, useState } from "react";
import { StudyContext } from "./studyContext";
import {
  chonDoc, chonEntity, chonEvidence, chonNode, chonQuestion, chonSummary, chonTopic,
  datLearningMode, TRANG_THAI_RONG, xoaLichSu, xoaLuaChon,
} from "./studySelection";

/**
 * Study Context (Phase 4A.1) — MỘT nơi phát lựa chọn hiện tại cho mọi module học
 * tập (Summary/MindMap/Knowledge/Câu hỏi gợi ý/Tiếp tục học/Chat) cùng đọc.
 *
 * KHÔNG thay state riêng của từng module: `StudyMapView` vẫn giữ `focusedId` +
 * node đầy đủ của nó, `SummaryPanel` (khi dựng) vẫn giữ section đầy đủ của nó —
 * context này chỉ nhận một ID mỗi lần chọn và PHÁT nó ra, để module khác biết mà
 * phản ứng, không phải nơi lưu lại bản sao thứ hai của cùng dữ liệu.
 *
 * Mount ở `main.jsx`, TRÊN `<Routes>` (cùng tầng `AuthProvider`) — cố ý: nếu đặt
 * trong một trang cụ thể (`Workspace`, `StudyMapView`...), đổi route sẽ unmount
 * Provider và tạo lại state rỗng, đúng lỗi mất-lựa-chọn-khi-điều-hướng mà Phase 4
 * tồn tại để sửa.
 *
 * Feature Pack A (Research Timeline) thêm `selectEvidence` (mirror đúng năm hành
 * động chọn trên) và `clearHistory` — cả hai chỉ PHÁT thêm, không đổi cách năm
 * hành động cũ hoạt động.
 */
export function StudyContextProvider({ children }) {
  const [state, setState] = useState(TRANG_THAI_RONG);

  // `opts` (Phase 4B): `{ source }` — bề mặt gọi lựa chọn này (một trong
  // SELECTION_SOURCES). Tuỳ chọn, không phá lời gọi cũ chưa truyền nó — thiếu thì
  // `selectionSource` đơn giản là `null`.
  const selectDocument = useCallback(
    (documentId, opts) => setState((s) => chonDoc(s, documentId, opts)), []);
  const selectTopic = useCallback(
    (topic, opts) => setState((s) => chonTopic(s, topic, opts)), []);
  const selectEntity = useCallback(
    (entity, opts) => setState((s) => chonEntity(s, entity, opts)), []);
  const selectSummary = useCallback(
    (summaryId, opts) => setState((s) => chonSummary(s, summaryId, opts)), []);
  const selectNode = useCallback(
    (nodeId, opts) => setState((s) => chonNode(s, nodeId, opts)), []);
  const selectQuestion = useCallback(
    (questionId, opts) => setState((s) => chonQuestion(s, questionId, opts)), []);
  const selectEvidence = useCallback(
    (evidenceId, opts) => setState((s) => chonEvidence(s, evidenceId, opts)), []);
  const setLearningMode = useCallback((mode) => setState((s) => datLearningMode(s, mode)), []);
  const clearSelection = useCallback((key) => setState((s) => xoaLuaChon(s, key)), []);
  const clearHistory = useCallback(() => setState((s) => xoaLichSu(s)), []);

  // `value` chỉ đổi khi CHÍNH `state` đổi — các hàm chọn đều `useCallback([])` nên
  // tham chiếu ổn định qua mọi lần render, không kéo theo re-render thừa ở nơi dùng.
  const value = useMemo(() => ({
    ...state,
    selectDocument, selectTopic, selectEntity, selectSummary, selectNode,
    selectQuestion, selectEvidence, setLearningMode, clearSelection, clearHistory,
  }), [state, selectDocument, selectTopic, selectEntity, selectSummary, selectNode,
      selectQuestion, selectEvidence, setLearningMode, clearSelection, clearHistory]);

  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>;
}
