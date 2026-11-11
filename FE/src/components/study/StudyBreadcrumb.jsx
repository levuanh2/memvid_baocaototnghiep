import { useStudyContext } from "../../study/useStudyContext";

// Nhãn bề mặt (Phase 4B) — chỉ ba giá trị có thể là "vừa xem tài liệu qua đâu"
// (mindmap/summary/knowledge); "question"/"continue_learning" là hành động
// CHỌN câu hỏi, không phải một GIAN học riêng nên không có nhãn chặng ở đây.
const NHAN_NGUON = { mindmap: "Sơ đồ tư duy", summary: "Tóm tắt", knowledge: "Tri thức" };

const rutGon = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Breadcrumb Workspace (Phase 4B #8) — Tài liệu > Bề mặt > Chủ đề/Thực thể >
 * Câu hỏi > Chat. ĐỌC THUẦN từ Study Context, không suy từ URL: một đoạn chỉ
 * xuất hiện khi trường tương ứng trong context có giá trị thật — không đoán,
 * không bịa nhãn cho lựa chọn chưa xảy ra.
 *
 * `showChat`: chỉ true ở Workspace (MainLayout) — nơi DUY NHẤT "Chat" là chặng
 * kế tiếp thật sự; ở các trang StudyShell (Thư viện/StudyMap) không có ý nghĩa.
 *
 * `documentLabel` (W5-2): Study Context chỉ giữ STEM tài liệu (khoá nối giữa
 * Summary/MindMap, xem StudyMapView.jsx) — chặng đầu vì vậy từng in ra stem
 * thô thay vì tiêu đề thật. Trang nào có sẵn tiêu đề thì truyền xuống để thay
 * segment đầu; không truyền thì giữ đúng hành vi cũ (dùng stem), không trang
 * nào khác bị đổi.
 */
export default function StudyBreadcrumb({ showChat = false, className = "", documentLabel }) {
  const { selectedDocument, selectedTopic, selectedEntity, selectedQuestion, selectionSource } =
    useStudyContext();

  if (!selectedDocument) return null;

  const segments = [rutGon(documentLabel || selectedDocument, 20)];
  if (NHAN_NGUON[selectionSource]) segments.push(NHAN_NGUON[selectionSource]);
  if (selectedTopic || selectedEntity) segments.push(rutGon(selectedTopic || selectedEntity, 24));
  if (selectedQuestion) segments.push("Câu hỏi");
  if (showChat) segments.push("Chat");

  return (
    <nav
      aria-label="Đường dẫn học tập"
      className={`flex items-center gap-1.5 min-w-0 text-caption font-mono text-text-muted ${className}`}
    >
      {segments.map((nhan, i) => (
        <span key={i} className="flex items-center gap-1.5 min-w-0">
          {i > 0 && <span aria-hidden="true">›</span>}
          <span className={`truncate ${i === segments.length - 1 ? "text-text-secondary" : ""}`}>
            {nhan}
          </span>
        </span>
      ))}
    </nav>
  );
}
