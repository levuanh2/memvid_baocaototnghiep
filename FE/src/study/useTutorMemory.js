import { useEffect, useRef, useState } from "react";
import { useStudyContext } from "./useStudyContext";
import { TRANG_THAI_RONG, ghiCauHoi, ghiChuDe, ghiNode, ghiThucThe } from "./tutorMemory";

/**
 * Bộ nhớ Gia sư AI, sống trong component gọi nó (thường là `MainLayout`, một
 * lần cho cả phiên Workspace) — đọc Study Context, ghi log MỖI KHI một trường
 * đổi sang giá trị mới. Không ghi khi giá trị y hệt lần trước (đổi tài liệu
 * đặt lại `selectedTopic` về null rồi người dùng chọn lại đúng chủ đề cũ không
 * nên tính là "vừa xem lại").
 */
export function useTutorMemory() {
  const { selectedQuestion, selectedTopic, selectedNode, selectedEntity } = useStudyContext();
  const [state, setState] = useState(TRANG_THAI_RONG);
  const lastRef = useRef({});

  useEffect(() => {
    const last = lastRef.current;
    if (selectedQuestion && selectedQuestion !== last.q) {
      setState((s) => ghiCauHoi(s, selectedQuestion, selectedQuestion));
    }
    if (selectedTopic && selectedTopic !== last.t) {
      setState((s) => ghiChuDe(s, selectedTopic));
    }
    if (selectedNode && selectedNode !== last.n) {
      setState((s) => ghiNode(s, selectedNode));
    }
    if (selectedEntity && selectedEntity !== last.e) {
      setState((s) => ghiThucThe(s, selectedEntity));
    }
    lastRef.current = { q: selectedQuestion, t: selectedTopic, n: selectedNode, e: selectedEntity };
  }, [selectedQuestion, selectedTopic, selectedNode, selectedEntity]);

  return state;
}
