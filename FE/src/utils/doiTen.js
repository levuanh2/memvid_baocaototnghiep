// Đổi tên hiển thị — kiểm tra đầu vào THUẦN, tách khỏi component.
//
// Cùng khuôn với `hoSoForm.js` / `matKhauForm.js`: component ở env node không render
// được, nên phần quyết định nằm ở đây và được test thẳng.

export const DAI_TOI_DA = 200;

/**
 * `{ hopLe, giaTri, loi, khongDoi }`.
 *
 * `giaTri` là thứ SẼ gửi lên: chuỗi đã cắt trắng, hoặc `null` khi người dùng xoá
 * trống — `null` nghĩa là "quay về tên file", một thao tác hợp lệ, không phải lỗi.
 * Chỉ ô trống KHI ĐANG có tên đã đặt mới là xoá; ô trống khi chưa từng đặt tên thì
 * không có gì để làm.
 */
export function kiemTraTen(nhap, tenHienTai = null) {
  const t = String(nhap ?? "").trim();
  const hienTai = tenHienTai == null ? null : String(tenHienTai).trim();

  if (!t) {
    if (!hienTai) return { hopLe: false, giaTri: null, loi: null, khongDoi: true };
    return { hopLe: true, giaTri: null, loi: null, khongDoi: false };
  }
  if (t.length > DAI_TOI_DA) {
    return { hopLe: false, giaTri: null, loi: `Tên tối đa ${DAI_TOI_DA} ký tự.`,
             khongDoi: false };
  }
  // Không đổi gì thì đừng gọi mạng: một request không đổi gì vẫn có thể hỏng, và
  // lúc đó màn hình báo lỗi cho một thao tác người dùng không hề thực hiện.
  if (t === hienTai) return { hopLe: false, giaTri: t, loi: null, khongDoi: true };
  return { hopLe: true, giaTri: t, loi: null, khongDoi: false };
}

/**
 * Cập nhật lạc quan có đường lùi.
 *
 * Trả `{ danhSachMoi, hoanTac }`. `hoanTac` khôi phục ĐÚNG giá trị cũ, không phải
 * "tính lại từ máy chủ" — PATCH hỏng thường vì mất mạng, và lúc đó không tải lại
 * được gì. Báo thành công rồi để giá trị sai nằm lại là kiểu nói dối rẻ nhất.
 */
export function apDungLacQuan(danhSach, documentId, thayDoi) {
  const truoc = new Map();
  const danhSachMoi = (danhSach || []).map((d) => {
    if (d?.document_id !== documentId) return d;
    truoc.set(documentId, d);
    return { ...d, ...thayDoi };
  });
  const hoanTac = (ds) => (ds || []).map((d) =>
    d?.document_id === documentId && truoc.has(documentId) ? truoc.get(documentId) : d);
  return { danhSachMoi, hoanTac };
}
