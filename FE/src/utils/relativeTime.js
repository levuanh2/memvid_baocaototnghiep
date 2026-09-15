// Feature Pack D — extracted out of ResearchTimeline.jsx (Feature Pack A),
// which had this exact logic as a local, untested function. Two real callers
// now need the identical "x phút trước" formatting (ResearchTimeline.jsx and
// the new KnowledgeDashboard.jsx) — one shared, tested function instead of a
// second hand-rolled copy, same reasoning Feature Pack B applied to `citeKey`.
// THUẦN: không phụ thuộc window/Date.now() bên trong — caller truyền `now`,
// test được xác định (deterministic) không cần mock đồng hồ hệ thống.

/** Mốc thời gian tương đối, tiếng Việt — đủ cho một phiên (session), không
 * định hướng tới ngày/tháng (dữ liệu nguồn — `StudyContext.history` — không
 * lưu qua lần tải lại trang, nên không bao giờ thực sự cũ hơn một phiên). */
export function formatRelativeTime(at, now) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return "vừa xong";
  if (s < 60) return `${s} giây trước`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  return `${h} giờ trước`;
}
