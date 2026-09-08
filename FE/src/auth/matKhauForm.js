// Logic thuần của biểu mẫu đổi mật khẩu NKS — không React, không mạng, không DOM.
//
// Tách ra vì kho này test ở env node không có DOM, và vì "yêu cầu này có được gửi đi
// không" là một quyết định đúng/sai đáng có test riêng — nhất là khi thứ sắp rời máy
// là mật khẩu của một hệ thống khác.

/** Khớp `DAI_TOI_THIEU` / `DAI_TOI_DA` ở backend (`application/mat_khau.py`). */
export const DAI_TOI_THIEU = 8;
export const DAI_TOI_DA = 200;

export const O = [
  { khoa: "identifier", nhan: "Tên đăng nhập NKS", loai: "text", auto: "username" },
  { khoa: "oldPassword", nhan: "Mật khẩu hiện tại", loai: "password", auto: "current-password" },
  { khoa: "password", nhan: "Mật khẩu mới", loai: "password", auto: "new-password" },
  { khoa: "passwordConfirmation", nhan: "Xác nhận mật khẩu mới", loai: "password", auto: "new-password" },
];

export const KHOA = O.map((o) => o.khoa);

/** Biểu mẫu rỗng. `identifier` gợi ý sẵn nhưng người dùng sửa được — định danh NKS
 *  KHÔNG chắc là email, nên đây là gợi ý chứ không phải suy diễn. */
export function bieuMauRong(goiY = "") {
  return { identifier: goiY || "", oldPassword: "", password: "", passwordConfirmation: "" };
}

/**
 * Toàn bộ trạng thái SẠCH của hộp thoại đổi mật khẩu.
 *
 * Có mặt vì hộp thoại KHÔNG bị unmount khi đóng: `AccountMenu` luôn dựng nó và nó tự
 * `return null` khi `open` sai. Nghĩa là state sống qua lần đóng, và nếu không xoá
 * thì mở lại sẽ thấy nguyên mật khẩu đã gõ lần trước — kèm cả công tắc "Hiện mật
 * khẩu" nếu nó đang bật, tức là mật khẩu cũ hiện rõ cho bất kỳ ai đang ngồi trước máy.
 *
 * `hien` PHẢI về `false`: đó là thứ biến một ô đã điền sẵn thành một mật khẩu đọc được.
 */
export function trangThaiSach(goiY = "") {
  return { form: bieuMauRong(goiY), loi: {}, loiChung: "", hien: false };
}

/**
 * Lỗi nhập liệu, `{ khoa: "câu tiếng Việt" }`. Rỗng = gửi được.
 *
 * Cùng bộ luật với backend, cố ý lặp lại: backend là nơi quyết định, nhưng bắt lỗi ở
 * đây tiết kiệm cho người dùng một vòng mạng — và quan trọng hơn, tránh gửi mật khẩu
 * đi khi biết chắc yêu cầu sẽ hỏng.
 */
export function kiemTra(form) {
  const loi = {};
  const f = form || {};

  if (!String(f.identifier || "").trim()) loi.identifier = "Vui lòng nhập tên đăng nhập.";
  if (!f.oldPassword) loi.oldPassword = "Vui lòng nhập mật khẩu hiện tại.";

  if (!f.password) {
    loi.password = "Vui lòng nhập mật khẩu mới.";
  } else if (f.password.length < DAI_TOI_THIEU) {
    loi.password = `Mật khẩu mới cần ít nhất ${DAI_TOI_THIEU} ký tự.`;
  } else if (f.password.length > DAI_TOI_DA) {
    loi.password = `Mật khẩu mới tối đa ${DAI_TOI_DA} ký tự.`;
  } else if (f.oldPassword && f.password === f.oldPassword) {
    loi.password = "Mật khẩu mới phải khác mật khẩu hiện tại.";
  }

  if (!loi.password && f.password !== f.passwordConfirmation) {
    loi.passwordConfirmation = "Xác nhận mật khẩu không khớp.";
  }
  return loi;
}

export function guiDuoc(form) {
  return Object.keys(kiemTra(form)).length === 0;
}

/**
 * Mã lỗi máy chủ → câu hiển thị.
 *
 * `invalid_credentials` cố ý MƠ HỒ về nguyên nhân: máy chủ trả cùng một mã cho "sai
 * mật khẩu" và "tài khoản này không phải người dùng NKS", nên câu chữ ở đây cũng
 * không được phân biệt hộ.
 */
export function loiDeDoc(code, status, message) {
  if (code === "invalid_password" && message) return message;
  if (code === "invalid_credentials") return "Tên đăng nhập hoặc mật khẩu hiện tại không đúng.";
  if (code === "rate_limited") return "Bạn thử quá nhiều lần. Vui lòng đợi một chút rồi thử lại.";
  if (code === "provider_unavailable") return "NKS đang không phản hồi. Mật khẩu chưa được đổi.";
  if (code === "provider_protocol_error") return "NKS trả về dữ liệu không đọc được. Mật khẩu chưa được đổi.";
  if (code === "provider_not_enabled") return "Đăng nhập NKS chưa được bật.";
  if (status === 0) return "Không kết nối được máy chủ.";
  return "Không đổi được mật khẩu. Vui lòng thử lại.";
}

/**
 * Sau khi hỏng, giữ lại những ô nào?
 *
 * Giữ định danh, XOÁ cả ba ô mật khẩu. Bắt gõ lại tên đăng nhập là phiền vô ích; còn
 * giữ lại mật khẩu trong ô sau một lần thất bại thì để nó nằm trong DOM lâu hơn cần
 * thiết mà chẳng giúp gì — người dùng vốn phải gõ lại thứ họ vừa gõ sai.
 */
export function sauKhiHong(form) {
  return { ...bieuMauRong(form?.identifier || "") };
}
