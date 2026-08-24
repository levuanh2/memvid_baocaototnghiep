// Ảnh dán vào khung chat: lấy ra khỏi clipboard, thu nhỏ, gửi đi đọc chữ.
//
// Ảnh KHÔNG đi vào pipeline tài liệu. Nó được đọc thành chữ, chữ đó ghép vào câu
// hỏi rồi /query chạy y như câu hỏi thuần chữ — retrieval, trích dẫn, HITL giữ
// nguyên. Xem BE/app/domains/vision/transcribe.py.

import { apiFetch, _appError } from "./api";

// Cạnh dài tối đa trước khi gửi. Ảnh điện thoại 4000px làm mô hình chậm gấp
// nhiều lần mà không đọc chữ tốt hơn — chữ trong đề bài đã rõ ở 1600px.
export const MAX_EDGE = 1600;

// Khớp formats.IMAGE của backend. Lệch là 415.
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/bmp"];

const EXT_BY_TYPE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

/** Lấy ảnh đầu tiên trong dữ liệu clipboard. Không có ảnh thì trả null. */
export function pickImageFromClipboard(clipboardData) {
  const items = clipboardData?.items;
  if (!items) return null;
  for (const item of items) {
    if (item?.kind === "file" && IMAGE_TYPES.includes(item.type)) {
      const file = item.getAsFile?.();
      if (file) return file;
    }
  }
  return null;
}

/** Tên file cho ảnh dán — clipboard thường trả về tên rỗng hoặc "image.png". */
export function imageFileName(file) {
  const name = (file?.name || "").trim();
  if (name && name.includes(".")) return name;
  const ext = EXT_BY_TYPE[file?.type] || "png";
  return `anh-dan.${ext}`;
}

/**
 * Ghép chữ đọc từ ảnh vào câu hỏi.
 *
 * Phần ảnh nằm SAU câu hỏi và có nhãn rõ ràng: mô hình cần biết đâu là lời người
 * dùng, đâu là chữ máy đọc được — nếu đọc sai thì câu hỏi gốc vẫn còn nguyên để
 * bấu víu. Người dùng không gõ gì thì câu hỏi tự sinh, tránh gửi q rỗng (400).
 */
export function buildQuestionWithImage(userText, transcript) {
  const text = String(userText || "").trim();
  const read = String(transcript || "").trim();
  if (!read) return text;
  const head = text || "Giải thích nội dung trong ảnh này.";
  return `${head}\n\n[Nội dung đọc được từ ảnh đính kèm]\n${read}`;
}

/**
 * Thu nhỏ ảnh về cạnh dài MAX_EDGE. Không có canvas (test, môi trường lạ) hoặc
 * ảnh vốn đã nhỏ thì trả lại nguyên file — thu nhỏ là tối ưu, không phải điều kiện.
 */
export async function downscaleImage(file, maxEdge = MAX_EDGE) {
  if (!file) return file;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= maxEdge) {
      bitmap.close?.();
      return file;
    }
    const scale = maxEdge / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.88));
    if (!blob) return file;
    return new File([blob], imageFileName({ ...file, name: "", type: "image/jpeg" }), {
      type: "image/jpeg",
    });
  } catch {
    return file;
  }
}

/** Mô hình thị giác có dùng được không. Hỏng thì coi như không có. */
export async function getVisionStatus() {
  try {
    const res = await apiFetch("/api/vision/status");
    if (!res.ok) return { available: false };
    return await res.json();
  } catch {
    return { available: false };
  }
}

/** Gửi ảnh đi đọc. Trả `{text, model, elapsed_ms}`. */
export async function transcribeImage(file) {
  const body = new FormData();
  // Không tự đặt Content-Type — trình duyệt phải tự sinh boundary cho multipart.
  body.append("image", file, imageFileName(file));
  const res = await apiFetch("/api/vision/transcribe", { method: "POST", body });
  if (!res.ok) throw await _appError(res);
  return res.json();
}
