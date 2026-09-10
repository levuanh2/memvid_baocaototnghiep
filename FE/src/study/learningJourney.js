// Hành trình học (Phase 5, Step 1) — THUẦN. Đọc `doc.knowledge.timeline`, một
// mảng [{event, at}] MÁY CHỦ ĐÃ TÍNH SẴN từ các mốc thật trong Postgres/SQLite
// (`tri_thuc.py::dong_thoi_gian`, đã có trong payload `/api/library` — không
// fetch thêm gì). Mỗi mốc ở đây là một sự kiện THẬT đã xảy ra; module này chỉ
// sắp chúng vào các chặng hiển thị, KHÔNG bịa chặng nào không có bằng chứng.
//
// Không phải mọi chặng trong ví dụ của đặc tả (Upload → Summary → MindMap →
// Knowledge → Questions → Chat → Quiz → Review → Finished) đều có một sự kiện
// rời rạc ở BE:
//   - "Knowledge" không phải một sự kiện — nó là HỆ QUẢ của việc trích chủ đề
//     (chạy kèm tóm tắt/sơ đồ), nên đánh dấu đạt được ngay khi có topic đầu
//     tiên, không đợi một event tên "knowledge".
//   - "Questions" (bấm một câu hỏi gợi ý) không được BE ghi lại thành sự kiện
//     riêng — nó luôn đổ vào "Chat" (`last_chat`) ngay sau đó, nên hai chặng
//     gộp làm một, đúng luồng thật (Question Engine → Study Context → Chat).
//   - "Finished" không có cờ nào — coi là đạt khi đã có kế hoạch ôn tập
//     (`review_created`), chặng cuối cùng của mọi bề mặt học hiện có.
const CHANG = [
  { key: "upload", event: "uploaded", nhan: "Tải lên" },
  { key: "summary", event: "summary", nhan: "Tóm tắt" },
  { key: "mindmap", event: "mindmap", nhan: "Sơ đồ tư duy" },
  { key: "knowledge", event: null, nhan: "Tri thức" },     // suy từ topics, không phải event
  { key: "chat", event: "last_chat", nhan: "Hỏi đáp" },
  { key: "quiz_created", event: "quiz_created", nhan: "Tạo quiz" },
  { key: "quiz_graded", event: "quiz_graded", nhan: "Chấm quiz" },
  { key: "review", event: "review_created", nhan: "Ôn tập" },
];

export function hanhTrinhHoc(doc) {
  const timeline = Array.isArray(doc?.knowledge?.timeline) ? doc.knowledge.timeline : [];
  const mocTheoEvent = new Map(timeline.map((m) => [m.event, m.at]));
  const coChuDe = Array.isArray(doc?.knowledge?.topics) && doc.knowledge.topics.length > 0;

  return CHANG.map((c) => {
    if (c.key === "knowledge") {
      return { key: c.key, nhan: c.nhan, at: null, dat: coChuDe };
    }
    const at = mocTheoEvent.get(c.event) || null;
    return { key: c.key, nhan: c.nhan, at, dat: Boolean(at) };
  });
}

/** Chặng ĐÃ ĐẠT gần nhất — dùng cho một dòng tóm tắt "đang ở đâu". `null` khi
 * tài liệu chưa có mốc nào (chưa từng mở, chưa có tri thức gì). */
export function changGanNhat(doc) {
  const hanhTrinh = hanhTrinhHoc(doc);
  const daDat = hanhTrinh.filter((c) => c.dat && c.at);
  if (!daDat.length) return null;
  return daDat.reduce((moiNhat, c) => (Date.parse(c.at) > Date.parse(moiNhat.at) ? c : moiNhat));
}
