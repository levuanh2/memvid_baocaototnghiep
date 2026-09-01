// Sổ nháp cho đáp án đang chờ gửi lên server.
//
// Vì sao cần một thứ riêng thay vì một `useRef({})`: mã cũ dọn sổ NGAY TRƯỚC `await`
//
//     const batch = pendingRef.current;
//     pendingRef.current = {};        // <- mất trắng nếu request hỏng
//     await saveAnswers(attemptId, batch);
//
// Gửi hỏng thì lô đó biến mất vĩnh viễn, trong khi ô vẫn tô mực và bộ đếm vẫn ghi
// "N/M đã trả lời" — giao diện nói đã lưu, server không có. Tệ hơn: lần bấm "Nộp bài"
// sau đó gửi đi một sổ đã rỗng, nên mấy câu ấy được chấm như chưa trả lời, và trang kết
// quả hiện ra như một lần nộp bình thường.
//
// `traLai` là mảnh còn thiếu: gửi hỏng thì lô quay lại sổ, lần gửi sau (hoặc lúc nộp)
// mang nó đi lại.
export function taoSoNhap() {
  let cho = {};

  return {
    dat(questionId, value) {
      cho[questionId] = value;
    },

    coGi() {
      return Object.keys(cho).length > 0;
    },

    demCho() {
      return Object.keys(cho).length;
    },

    /** Lấy cả lô ra để gửi; sổ trống lại. Gửi hỏng thì gọi `traLai(lo)`. */
    layDeGui() {
      const lo = cho;
      cho = {};
      return lo;
    },

    /** Trả lô về sổ. Giá trị người dùng vừa đổi trong lúc gửi được ưu tiên — trả lại
     *  một câu trả lời cũ đè lên câu mới hơn cũng là mất dữ liệu, chỉ khó thấy hơn. */
    traLai(lo) {
      cho = { ...(lo || {}), ...cho };
    },
  };
}
