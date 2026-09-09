import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import MainLayout from "../components/Layout/MainLayout";

// Workspace — the authenticated app screen (mounted at /app).
// Holds `selectedSources` (lifted out of the old App.jsx) so the chosen files
// persist across the workspace session. Everything below MainLayout — chat,
// upload, summary, mindmap, conversation context, RQ — is unchanged.
//
// `?source=<stem>` chọn sẵn một nguồn khi vào (Thư viện học tập dùng nó cho nút
// "Hỏi AI" và cho Tiếp tục học). CHỈ là giá trị KHỞI TẠO: sau đó cột trái làm chủ
// lựa chọn y như cũ, nên không có đường nào URL ghi đè thao tác của người dùng.
// Không có tham số → [] , đúng hành vi cũ.
export default function Workspace() {
  const [searchParams] = useSearchParams();
  const [selectedSources, setSelectedSources] = useState(() => {
    const stem = (searchParams.get("source") || "").trim();
    return stem ? [stem] : [];
  });
  // `?prompt=` (Phase 4A.3) — một Câu hỏi gợi ý (KnowledgePanel/cauHoiGoiY.js) bấm
  // vào đã đi qua `duongDi(doc, "chat", {prompt})` tới đây. CHỈ đọc lúc khởi tạo
  // (như `source` ở trên) — sau đó ô chat làm chủ nội dung của nó y như cũ.
  const [initialAskAbout] = useState(() => {
    const text = (searchParams.get("prompt") || "").trim();
    return text ? { text, nonce: Date.now() } : null;
  });
  return (
    <MainLayout
      selectedSources={selectedSources}
      setSelectedSources={setSelectedSources}
      initialAskAbout={initialAskAbout}
    />
  );
}
