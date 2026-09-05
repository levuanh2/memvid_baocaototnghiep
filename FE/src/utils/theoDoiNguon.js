// Theo dõi trạng thái xử lý của MỘT tài liệu đang ingest.
//
// Vì sao có file này thay vì `setInterval` thẳng trong SidebarLeft:
//
// 1. **Một 502 không phải là ingest hỏng.** Render/proxy trả 502/503/504 lẻ tẻ trong khi
//    Gunicorn vẫn ghi `200` cho đúng request đó. Bản cũ dừng poll ngay ở lần hỏng ĐẦU
//    TIÊN và đổi thẻ sang "Mất liên lạc" — người dùng đọc là tài liệu chết, trong khi
//    backend đang xử lý bình thường. Lỗi VẬN CHUYỂN và lỗi XỬ LÝ là hai chuyện khác nhau
//    và phải hiện ra khác nhau.
//
// 2. **`setInterval` chồng request.** Thân poll là async; một lượt chậm hơn 1.5s thì lượt
//    sau vẫn bắn, hai request cùng bay, phản hồi về trễ ghi đè phản hồi mới hơn. Tự hẹn
//    giờ bằng `setTimeout` sau khi lượt trước KẾT THÚC thì không bao giờ có hai lượt
//    cùng lúc — cùng khuôn với `createJobPoller`.
//
// Ngưỡng bỏ cuộc lấy lại từ `jobPoller` để cả ứng dụng chỉ có MỘT con số, không phải hai
// con số trôi khỏi nhau.
import { MAX_CONSECUTIVE_FETCH_FAILURES } from "./jobPoller";

export { MAX_CONSECUTIVE_FETCH_FAILURES };

/** Nhịp hỏi bình thường. Thanh tiến trình ingest cần nhịp nhanh mới nhìn ra là đang chạy. */
export const NHIP_MS = 1500;

/** Trần thời gian chờ giữa hai lần thử lại — không để backoff giãn vô hạn. */
export const TRAN_CHO_MS = 10_000;

/**
 * Hỏng liên tiếp bao nhiêu lần thì mới nói ra.
 *
 * KHÔNG phải 1: cả mục đích của đợt sửa này là một cú 502 lẻ phải VÔ HÌNH. Đến lần thứ 3
 * thì không còn là nhiễu nữa, người dùng xứng đáng biết là đang có trục trặc — nhưng vẫn
 * là "đang thử lại", chưa phải "hỏng".
 */
export const NGUONG_CANH_BAO = 3;

/**
 * Mã HTTP coi là trục trặc ĐƯỜNG TRUYỀN, thử lại được.
 *
 * 500 CỐ Ý không nằm đây: đó là ứng dụng tự ném lỗi, thử lại 5 lần cũng ra đúng lỗi đó,
 * và giấu nó sau một banner "đang thử lại" là nói dối. 502/503/504 là gateway/khởi động
 * lại, 408/429 là hết giờ/bị bóp — cả năm cái đều tự khỏi.
 */
export const MA_TAM_THOI = new Set([408, 429, 502, 503, 504]);

/**
 * Lỗi này có phải trục trặc tạm thời không?
 *
 * Không có `status` = fetch ném (mất mạng, DNS, CORS preflight chết giữa chừng) — đúng
 * loại tự khỏi. Có `status` thì tra bảng trên.
 */
export function laLoiTamThoi(err) {
  const ma = err?.status;
  if (ma == null) return true;
  return MA_TAM_THOI.has(Number(ma));
}

/** Backoff có trần: 3s → 6s → 10s → 10s. Không bao giờ quay tít, không bao giờ giãn vô hạn. */
export function khoangChoMs(soLanHong) {
  if (soLanHong <= 0) return NHIP_MS;
  return Math.min(NHIP_MS * 2 ** soLanHong, TRAN_CHO_MS);
}

/** Trạng thái kết thúc của một lượt ingest — hết chuyện để hỏi. */
export const laTrangThaiKetThuc = (tt) => tt === "ready" || tt === "error";

/**
 * Poller cho một source_id.
 *
 * `layTrangThai(sourceId)` phải TRẢ VỀ object trạng thái, hoặc NÉM lỗi có `.status` khi
 * HTTP không ok (đúng hình dạng `_appError` của utils/api).
 *
 * Callback:
 *   onTrangThai(data)        mỗi lượt hỏi thành công, kể cả lượt chưa xong
 *   onKetThuc(data)          status = ready | error  → đã dừng
 *   onTrucTrac(soLanHong)    hỏng tạm thời liên tiếp ≥ NGUONG_CANH_BAO → vẫn đang thử lại
 *   onMatKetNoi(soLanHong)   quá MAX_CONSECUTIVE_FETCH_FAILURES → đã dừng, cần người bấm lại
 *
 * Lỗi KHÔNG tạm thời (404/401/403/500…) dừng ngay qua `onMatKetNoi`: thử lại chỉ tốn
 * request cho một câu trả lời không đổi.
 */
export function taoBoTheoDoiNguon({
  layTrangThai,
  onTrangThai,
  onKetThuc,
  onTrucTrac,
  onMatKetNoi,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let hen = null;
  let dung = true;
  let soLanHong = 0;

  const henGio = (sourceId, cho) => {
    if (dung) return;
    hen = setTimeoutFn(() => luot(sourceId), cho);
  };

  const luot = async (sourceId) => {
    if (dung) return;
    let data;
    try {
      data = await layTrangThai(sourceId);
    } catch (err) {
      // `stop()` gọi giữa lúc request đang bay: bỏ kết quả, đừng hẹn tiếp.
      if (dung) return;
      if (!laLoiTamThoi(err)) {
        dung = true;
        onMatKetNoi?.(soLanHong + 1, err);
        return;
      }
      soLanHong += 1;
      if (soLanHong >= MAX_CONSECUTIVE_FETCH_FAILURES) {
        dung = true;
        onMatKetNoi?.(soLanHong, err);
        return;
      }
      // Giữ nguyên trạng thái đang có — KHÔNG đụng tới tiến trình ingest.
      if (soLanHong >= NGUONG_CANH_BAO) onTrucTrac?.(soLanHong);
      henGio(sourceId, khoangChoMs(soLanHong));
      return;
    }
    if (dung) return;
    // Hỏi được là hết trục trặc: xoá sạch đếm, banner tạm thời phải biến mất.
    soLanHong = 0;
    onTrangThai?.(data);
    if (laTrangThaiKetThuc(data?.status)) {
      dung = true;
      onKetThuc?.(data);
      return;
    }
    henGio(sourceId, NHIP_MS);
  };

  return {
    start(sourceId) {
      // Gọi start() hai lần mà không guard là dựng hai vòng lặp trên cùng một bộ: số
      // request nhân đôi và không cách nào dừng cái thứ nhất (chỉ giữ được MỘT `hen`).
      // Đang chạy rồi thì lần gọi sau là no-op.
      if (!dung) return;
      dung = false;
      soLanHong = 0;
      luot(sourceId);
    },
    stop() {
      dung = true;
      if (hen != null) {
        clearTimeoutFn(hen);
        hen = null;
      }
    },
    get soLanHongLienTiep() {
      return soLanHong;
    },
  };
}
