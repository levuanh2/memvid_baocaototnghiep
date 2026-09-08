// Tiếp tục học — đưa người dùng về đúng BỀ MẶT họ đang dở, không chỉ về tài liệu.
//
// THUẦN: nhận tài liệu, trả đường đi. Không điều hướng, không gọi mạng.
//
// Không có `last_workspace_ref`, và cố ý: tóm tắt / sơ đồ / bản đồ / hỏi đáp mỗi
// tài liệu chỉ có một artifact sống, còn quiz và ôn tập thì "mới nhất" mới là đích
// đúng — và "mới nhất" tra được từ những bảng đã có. Một cột tham chiếu sẽ nhân đôi
// một giá trị suy ra được rồi lệch khỏi nó.

export const BE_MAT = {
  summary: "Tóm tắt",
  mindmap: "Sơ đồ tư duy",
  studymap: "Bản đồ học tập",
  quiz: "Quiz",
  review: "Hướng dẫn ôn tập",
  chat: "Hỏi AI",
};

const q = (v) => encodeURIComponent(String(v ?? ""));

/**
 * Đường đi cho một bề mặt.
 *
 * Tóm tắt, sơ đồ tư duy (mind-elixir) và hỏi đáp đều sống trong Workspace `/app`
 * — chúng là modal của màn hình ấy, không phải route riêng. `?source=<stem>` chọn
 * sẵn nguồn để câu hỏi kế tiếp đã đúng phạm vi.
 *
 * Bản đồ học tập (`knowledge_maps`) thì CÓ route riêng và khoá theo `document_id`.
 *
 * Bề mặt lạ hoặc thiếu dữ liệu → về chính tài liệu ấy, KHÔNG BAO GIỜ trả một route
 * hỏng: một nút "Tiếp tục" dẫn tới trang trắng còn tệ hơn không có nút.
 */
export function duongDi(doc, beMat) {
  if (!doc?.document_id) return null;
  const id = q(doc.document_id);
  const stem = String(doc.source_stem || "").trim();
  const toiWorkspace = stem ? `/app?source=${q(stem)}` : "/app";

  switch (beMat) {
    case "summary":
    case "mindmap":
    case "chat":
      return toiWorkspace;
    case "studymap":
      return `/app/study/map/${id}`;
    case "quiz": {
      // Đã có quiz thì vào thẳng bài MỚI NHẤT; chưa có thì vào màn tạo, đã chọn sẵn
      // tài liệu. Cả hai đều là "tiếp tục", chỉ khác điểm bắt đầu.
      const quizId = doc.ai?.quiz?.latest_quiz_id;
      return quizId ? `/app/study/quiz/${q(quizId)}` : `/app/study/quiz/new?document=${id}`;
    }
    case "review": {
      // Hướng dẫn ôn tập treo dưới ATTEMPT, không dưới tài liệu. Không có attempt
      // thì về bản đồ học tập — một route ôn tập với attempt sai còn tệ hơn không đi.
      const attemptId = doc.ai?.review?.latest_attempt_id;
      return attemptId ? `/app/study/review/${q(attemptId)}` : `/app/study/map/${id}`;
    }
    default:
      return `/app/study/map/${id}`;
  }
}

/**
 * Thẻ "Tiếp tục học", hoặc `null` khi chưa từng mở tài liệu nào.
 *
 * `null` phải làm mục ấy BIẾN MẤT hẳn. Một thẻ "Tiếp tục học" trống với người chưa
 * học gì là chỗ giữ chỗ, và chỗ giữ chỗ dạy người dùng bỏ qua khu vực đó.
 */
export function tiepTucHoc(doc, { now = Date.now() } = {}) {
  if (!doc?.document_id || !doc.last_opened_at) return null;
  const beMat = BE_MAT[doc.last_workspace] ? doc.last_workspace : null;
  return {
    doc,
    beMat,
    nhanBeMat: beMat ? BE_MAT[beMat] : "Tài liệu",
    duongDi: duongDi(doc, beMat),
    nhanThoiGian: thoiGianTuongDoi(doc.last_opened_at, now),
  };
}

/** Nhãn thời gian tương đối, tiếng Việt. Mốc hỏng → null (không hiện gì). */
export function thoiGianTuongDoi(iso, now = Date.now()) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const giay = Math.floor((now - t) / 1000);
  if (giay < 0) return "vừa xong";          // lệch đồng hồ, không phải tương lai
  if (giay < 60) return "vừa xong";
  const phut = Math.floor(giay / 60);
  if (phut < 60) return `${phut} phút trước`;
  const gio = Math.floor(phut / 60);
  if (gio < 24) return `${gio} giờ trước`;
  const ngay = Math.floor(gio / 24);
  if (ngay === 1) return "hôm qua";
  if (ngay < 30) return `${ngay} ngày trước`;
  const thang = Math.floor(ngay / 30);
  return thang < 12 ? `${thang} tháng trước` : `${Math.floor(thang / 12)} năm trước`;
}
