// Hàng đợi ôn tập (Phase 5, Step 4) — THUẦN, KHÔNG scheduler, KHÔNG thông báo,
// KHÔNG lưu trữ nào mới. Xếp lại đúng tập tài liệu mà `chiaMuc.js::canOnTap`
// đã lọc (đã lập chỉ mục + đã có ít nhất một lượt quiz được chấm + chưa có kế
// hoạch ôn tập) — KHÔNG viết lại predicate đó, chỉ nhận nó làm đầu vào, cộng
// một lớp xếp hạng theo mức nắm cho "khi nào nên ôn trước".
//
// KHÔNG có mốc "lần ôn tiếp theo" nào lưu ở đâu — Hôm nay/Ngày mai/Sau chỉ là
// một cách ĐẶT TÊN cho thứ tự ưu tiên suy từ mastery đã có (`knowledge.readiness
// .mastery`), không phải một lịch hẹn thật. Không giả vờ có ngày giờ chính xác.
const mang = (v) => (Array.isArray(v) ? v : []);

/**
 * `canOnTap`: mảng đã lọc sẵn từ `chiaMuc(...).canOnTap` (tài liệu cần ôn,
 * chưa có kế hoạch). `daHoanThanh`: tài liệu đã có kế hoạch ôn tập
 * (`d.ai?.review?.ready`) — gọi nơi khác truyền vào, hàm này không tự lọc lại
 * từ `documents` để khỏi có hai chỗ định nghĩa "cần ôn" khác nhau.
 */
export function hangDoiOnTap(canOnTap, daHoanThanh = []) {
  const homNay = [];
  const ngayMai = [];
  const sau = [];

  for (const d of mang(canOnTap)) {
    const mastery = Number(d?.knowledge?.readiness?.mastery);
    const m = Number.isFinite(mastery) ? mastery : 0;
    // Mastery càng thấp càng cần ôn sớm — ba mốc chỉ là ba dải của MỘT trục.
    if (m < 40) homNay.push(d);
    else if (m < 70) ngayMai.push(d);
    else sau.push(d);
  }

  const theoMastery = (a, b) =>
    (Number(a?.knowledge?.readiness?.mastery) || 0) - (Number(b?.knowledge?.readiness?.mastery) || 0);

  return {
    homNay: homNay.sort(theoMastery),
    ngayMai: ngayMai.sort(theoMastery),
    sau: sau.sort(theoMastery),
    hoanThanh: mang(daHoanThanh),
  };
}

/** Tài liệu đã có kế hoạch ôn tập — cặp còn lại của `hangDoiOnTap`'s "Completed". */
export function taiLieuDaOnXong(documents) {
  return mang(documents).filter((d) => Boolean(d?.ai?.review?.ready));
}
