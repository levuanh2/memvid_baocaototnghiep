// Chuẩn hoá văn bản trả lời/lỗi của luồng /query (SSE + polling) — THUẦN, tách
// khỏi ChatArea.jsx (Final Freeze cleanup) để có test thật cho logic đã có từ
// trước, không đổi hành vi.
export const QUERY_SSE_ERR_FALLBACK = "Loi khi xu ly truy van. Vui long thu lai.";

const INVISIBLE_RE = new RegExp(
  "[" + [0x200B, 0x200C, 0x200D, 0xFEFF, 0x2060, 0x180E].map((c) => String.fromCharCode(c)).join("") + "]",
  "g",
);

/** Xoá ký tự vô hình (zero-width, BOM…) — chuỗi lỗi từ BE đôi khi lẫn chúng,
 * và `.trim()` không bắt được vì chúng không phải khoảng trắng. */
export function stripInvisible(s) {
  return String(s ?? "").replace(INVISIBLE_RE, "");
}

/** Đảm bảo luôn có một câu lỗi hiển thị được — rỗng/toàn ký tự vô hình thì
 * lùi về `fb` (hoặc mặc định chung nếu `fb` cũng rỗng). */
export function ensureErrMsg(msg, fb = QUERY_SSE_ERR_FALLBACK) {
  const base = fb != null && String(fb).trim() !== "" ? String(fb).trim() : QUERY_SSE_ERR_FALLBACK;
  const t = stripInvisible(msg).trim();
  return t.length > 0 ? t : base;
}

/** Văn bản hiển thị cho một kết quả job /query: ưu tiên phần đã stream được,
 * rồi `payload.answer`/`payload.error`, rồi `jobResult.answer` — ba nơi khác
 * nhau BE có thể đặt câu trả lời tuỳ đường job đi qua. */
export function pickQueryDisplayText(jobResult, streamedText) {
  const st = streamedText != null ? String(streamedText).trim() : "";
  if (st) return st;
  const p = jobResult && typeof jobResult === "object" ? jobResult.payload : null;
  if (p && typeof p === "object") {
    if (p.answer != null && String(p.answer).trim()) return String(p.answer).trim();
    if (p.error != null && String(p.error).trim()) return String(p.error).trim();
  }
  if (jobResult && typeof jobResult === "object" && jobResult.answer != null && String(jobResult.answer).trim()) {
    return String(jobResult.answer).trim();
  }
  return "";
}

/** Chuẩn hoá payload lỗi SSE (`d.error`, kiểu tuỳ ý từ BE) thành một chuỗi. */
export function sseErrorToMessage(raw, fallback = QUERY_SSE_ERR_FALLBACK) {
  const fb = ensureErrMsg(fallback, QUERY_SSE_ERR_FALLBACK);
  if (raw == null) return fb;
  if (typeof raw === "string") { const t = stripInvisible(raw).trim(); return t.length > 0 ? t : fb; }
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "boolean") return String(raw);
  return fb;
}
