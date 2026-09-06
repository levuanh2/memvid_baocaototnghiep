// Logic THUẦN của form đăng nhập, tách khỏi Login.jsx để test được ở env node
// (kho này chưa có jsdom; component không render trong test — pattern jobRecovery).
//
// Phần đáng test không phải chỗ vẽ ô nhập, mà là hai quyết định:
//   1. provider nào thì hỏi trường gì;
//   2. luật hợp lệ nào được áp cho provider nào.
import { isValidEmail, isValidPassword } from "./validate";

export const PROVIDER_MAC_DINH = "local";
export const PROVIDERS = ["local", "nks"];

export const laProviderNgoai = (p) => Boolean(p) && p !== "local";

/** Provider này hỏi email hay username? */
export const truongDinhDanh = (provider) =>
  laProviderNgoai(provider) ? "username" : "email";

/**
 * Kiểm dữ liệu trước khi gửi. Trả `null` khi hợp lệ, hoặc câu báo lỗi.
 *
 * **KHÔNG áp luật của StudyMap lên tài khoản của nhà cung cấp khác.** Username NKS
 * không nhất thiết là email, và độ dài mật khẩu do NKS quy định — bắt mật khẩu NKS
 * phải dài ≥ 8 ký tự là tự khoá cửa với những tài khoản hoàn toàn hợp lệ mà mình
 * không có quyền đặt luật. Với provider ngoài chỉ chặn ô rỗng, phần còn lại để
 * provider trả lời.
 */
export function kiemTra(provider, { dinhDanh = "", password = "" } = {}) {
  if (laProviderNgoai(provider)) {
    if (!String(dinhDanh).trim()) return "Nhập tên đăng nhập NKS.";
    if (!password) return "Nhập mật khẩu.";
    return null;
  }
  if (!isValidEmail(dinhDanh)) return "Email chưa hợp lệ.";
  if (!isValidPassword(password)) return "Mật khẩu cần ít nhất 8 ký tự.";
  return null;
}
