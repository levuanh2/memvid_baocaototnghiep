// Chứng từ ghi NKS phía trình duyệt — CHỈ trong bộ nhớ, không bao giờ chạm ổ đĩa.
//
// Thứ giữ ở đây là `grant_id`: một chuỗi ngẫu nhiên 256 bit KHÔNG mang thông tin, tự
// nó vô dụng nếu không kèm token StudyMap của đúng chủ nhân. Access token của NKS thì
// không bao giờ tới được trình duyệt — nó nằm trong RAM của máy chủ, tối đa 10 phút.
//
// Vì sao KHÔNG dùng localStorage/sessionStorage, dù `grant_id` không phải bí mật đầy
// đủ: hai kho đó sống lâu hơn phiên và dùng chung cho mọi tab. Một chứng từ còn sót
// sau khi người khác đăng nhập trên cùng máy chính là lớp lỗi mà
// `phienNguoiDung.js` vừa được viết ra để dọn. Giữ trong module là hết hạn theo đúng
// vòng đời của trang, và không có gì để dọn.
//
// Mất khi tải lại trang là ĐÚNG: máy chủ cũng mất chứng từ mỗi lần khởi động lại
// (Render Free ngủ sau ~15 phút), nên "không có chứng từ" là trạng thái thường gặp
// nhất, và đường xử lý của nó — hỏi lại mật khẩu — phải là đường được đi nhiều nhất.

let _grantId = null;
let _hetHan = 0;      // epoch giây, theo máy chủ

/** Lề an toàn: coi như hết hạn sớm hơn máy chủ vài giây để tránh đua sát mốc. */
const LE_AN_TOAN_SEC = 5;

export function luuGrant(grantId, expiresAt) {
  _grantId = grantId ? String(grantId) : null;
  _hetHan = Number(expiresAt) || 0;
}

export function quenGrant() {
  _grantId = null;
  _hetHan = 0;
}

/** `grant_id` nếu còn hạn, ngược lại `null` (và tự quên luôn). */
export function layGrant(bayGio = Date.now() / 1000) {
  if (!_grantId) return null;
  if (bayGio >= _hetHan - LE_AN_TOAN_SEC) {
    quenGrant();
    return null;
  }
  return _grantId;
}

export function conHan(bayGio = Date.now() / 1000) {
  return layGrant(bayGio) !== null;
}

/** Giây còn lại, để giao diện báo trước khi phải xác minh lại. */
export function giayConLai(bayGio = Date.now() / 1000) {
  if (!layGrant(bayGio)) return 0;
  return Math.max(0, Math.floor(_hetHan - LE_AN_TOAN_SEC - bayGio));
}
