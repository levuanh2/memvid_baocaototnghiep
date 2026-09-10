// Hành động nhanh của Gia sư AI (Phase 4C, Step 3+5) — THUẦN: quyết định nút
// nào bật và soạn sẵn câu hỏi/đích, không gọi mạng, không điều hướng. Nơi gọi
// (TutorPanel) chỉ cầm kết quả rồi gọi `askDirect`/`openArtifact` đã có sẵn.
//
// "Xem sơ đồ"/"Xem tóm tắt" KHÔNG điều hướng sang route khác: Workspace không
// có `document_id` (Study Context chỉ giữ `source_stem`; xem StudyMapView.jsx
// comment cùng lý do) nên không gọi được `duongDi`. Hai nút này thay vào đó mở
// ĐÚNG khu vực đã có sẵn trong cột phải (SidebarRight → tab Sơ đồ/Tóm tắt) —
// không thêm route, không thêm dữ liệu, chỉ chuyển tab của thứ đã tồn tại.
function tieuDiem(ctx) {
  return ctx.selectedEntity || ctx.selectedTopic || null;
}

export function danhSachHanhDong(ctx) {
  const coTaiLieu = Boolean(ctx.selectedDocument);
  const td = tieuDiem(ctx);
  return [
    {
      key: "explain", label: "Giải thích", icon: "MessageSquareText", enabled: coTaiLieu,
      prompt: td ? `Giải thích "${td}" trong tài liệu này, dễ hiểu, có ví dụ.`
                 : "Giải thích ý chính của tài liệu này, dễ hiểu, có ví dụ.",
    },
    {
      key: "resummarize", label: "Tóm tắt lại", icon: "ScrollText", enabled: coTaiLieu,
      prompt: "Tóm tắt lại nội dung chính của tài liệu này, ngắn gọn.",
    },
    {
      key: "quiz", label: "Kiểm tra nhanh", icon: "MessageCircleQuestion", enabled: coTaiLieu,
      prompt: td
        ? `Đặt cho tôi 3 câu hỏi kiểm tra về "${td}" trong tài liệu này, đợi tôi trả lời rồi chấm.`
        : "Đặt cho tôi 3 câu hỏi kiểm tra nội dung tài liệu này, đợi tôi trả lời rồi chấm.",
    },
    { key: "mindmap", label: "Xem sơ đồ", icon: "Network", enabled: coTaiLieu, artifact: "mindmap" },
    { key: "summary", label: "Xem tóm tắt", icon: "ScrollText", enabled: coTaiLieu, artifact: "summary" },
  ];
}

/**
 * "Ôn lại phiên này" — gộp Tutor Memory thành MỘT câu hỏi gửi thẳng vào chat.
 * KHÔNG dùng tính năng "Hướng dẫn ôn tập" thật (route đó treo dưới attempt,
 * cần `document_id` mà Workspace không có) — đây là bản trong-chat, dựng từ
 * đúng những gì phiên này đã thật sự xem, không bịa gì thêm. `null` khi phiên
 * chưa xem gì — panel phải ẩn nút, không hiện nút bấm-ra-rỗng.
 */
export function xayRecap(memory) {
  const chuDe = (memory?.openedTopics || []).map((x) => x.value);
  const thucThe = (memory?.selectedEntities || []).map((x) => x.value);
  const cauHoi = (memory?.recentQuestions || []).map((x) => x.text || x.id);
  const phan = [];
  if (chuDe.length) phan.push(`chủ đề đã xem: ${chuDe.join(", ")}`);
  if (thucThe.length) phan.push(`khái niệm đã xem: ${thucThe.join(", ")}`);
  if (cauHoi.length) phan.push(`câu hỏi đã hỏi: ${cauHoi.join("; ")}`);
  if (!phan.length) return null;
  return `Tóm tắt lại giúp tôi những gì tôi vừa xem trong phiên này (${phan.join(" · ")}), rồi hỏi tôi một câu để ôn lại.`;
}
