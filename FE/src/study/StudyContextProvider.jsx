import { useCallback, useMemo, useState } from "react";
import { StudyContext } from "./studyContext";
import {
  chonDoc, chonEntity, chonNode, chonQuestion, chonSummary, chonTopic,
  datLearningMode, TRANG_THAI_RONG, xoaLuaChon,
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
 */
export function StudyContextProvider({ children }) {
  const [state, setState] = useState(TRANG_THAI_RONG);

  const selectDocument = useCallback((documentId) => setState((s) => chonDoc(s, documentId)), []);
  const selectTopic = useCallback((topic) => setState((s) => chonTopic(s, topic)), []);
  const selectEntity = useCallback((entity) => setState((s) => chonEntity(s, entity)), []);
  const selectSummary = useCallback((summaryId) => setState((s) => chonSummary(s, summaryId)), []);
  const selectNode = useCallback((nodeId) => setState((s) => chonNode(s, nodeId)), []);
  const selectQuestion = useCallback((questionId) => setState((s) => chonQuestion(s, questionId)), []);
  const setLearningMode = useCallback((mode) => setState((s) => datLearningMode(s, mode)), []);
  const clearSelection = useCallback((key) => setState((s) => xoaLuaChon(s, key)), []);

  // `value` chỉ đổi khi CHÍNH `state` đổi — các hàm chọn đều `useCallback([])` nên
  // tham chiếu ổn định qua mọi lần render, không kéo theo re-render thừa ở nơi dùng.
  const value = useMemo(() => ({
    ...state,
    selectDocument, selectTopic, selectEntity, selectSummary, selectNode,
    selectQuestion, setLearningMode, clearSelection,
  }), [state, selectDocument, selectTopic, selectEntity, selectSummary, selectNode,
      selectQuestion, setLearningMode, clearSelection]);

  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>;
}
