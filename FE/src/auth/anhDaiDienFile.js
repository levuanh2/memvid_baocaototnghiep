// Chuẩn bị ảnh đại diện phía trình duyệt — kiểm tra, thu nhỏ, mã hoá lại.
//
// Vì sao làm ở FE khi máy chủ đã làm lại hết: một ảnh 4 MB từ điện thoại đi qua mạng
// di động rồi mới bị từ chối là một phút chờ đổi lấy một thông báo lỗi. Thu nhỏ trước
// khi gửi biến nó thành ~60 KB. Đây là chuyện TRẢI NGHIỆM, không phải chuyện an toàn:
// mọi hàng rào thật nằm ở máy chủ, vì FE có thể bị bỏ qua hoàn toàn.
//
// Canvas cũng bỏ luôn EXIF (có toạ độ GPS) — nhưng lần nữa, máy chủ mới là nơi bảo
// đảm điều đó.

/** Định dạng cho người dùng chọn. Máy chủ nhận rộng hơn; đây là để hộp thoại lọc. */
export const LOAI_CHO_PHEP = ["image/jpeg", "image/png", "image/webp"];

/** Trần cho file NGƯỜI DÙNG CHỌN, trước khi thu nhỏ. */
export const TRAN_CHON_BYTE = 10 * 1024 * 1024;      // 10 MB

/** Đích sau khi thu nhỏ. Vượt mức này thì hạ chất lượng và thử lại. */
export const DICH_BYTE = 256 * 1024;                 // 256 KB

export const CANH_TOI_DA = 512;

export class AnhKhongHopLe extends Error {}

/** Lỗi để hiển thị. Không bao giờ ném nội dung file vào thông điệp. */
export function kiemTraFile(file) {
  if (!file) return "Chưa chọn ảnh.";
  if (!LOAI_CHO_PHEP.includes(file.type)) {
    return "Chỉ nhận ảnh JPG, PNG hoặc WEBP.";
  }
  if (file.size > TRAN_CHON_BYTE) {
    return `Ảnh tối đa ${Math.round(TRAN_CHON_BYTE / 1024 / 1024)} MB.`;
  }
  return null;
}

/** Cạnh mới, giữ nguyên tỉ lệ, KHÔNG phóng to ảnh nhỏ. */
export function canhSauThuNho(rong, cao, toiDa = CANH_TOI_DA) {
  if (rong <= 0 || cao <= 0) return { rong: 0, cao: 0 };
  const canh = Math.max(rong, cao);
  if (canh <= toiDa) return { rong, cao };
  const ti_le = toiDa / canh;
  return { rong: Math.max(1, Math.round(rong * ti_le)), cao: Math.max(1, Math.round(cao * ti_le)) };
}

/**
 * File → `Blob` JPEG đã thu nhỏ.
 *
 * Hạ dần chất lượng cho tới khi đạt `DICH_BYTE`. Không đạt cũng vẫn gửi bản nhỏ nhất
 * làm được — máy chủ có trần riêng và sẽ là bên nói lời cuối. Chặn ở đây thêm một lần
 * nữa chỉ khiến người dùng bế tắc mà không hiểu vì sao.
 */
export async function thuNhoAnh(file, { taoAnh, taoCanvas } = {}) {
  const loi = kiemTraFile(file);
  if (loi) throw new AnhKhongHopLe(loi);

  const img = await (taoAnh ? taoAnh(file) : _taiAnh(file));
  const { rong, cao } = canhSauThuNho(img.width, img.height);
  if (!rong || !cao) throw new AnhKhongHopLe("Ảnh không đọc được.");

  const canvas = taoCanvas ? taoCanvas(rong, cao) : _taoCanvas(rong, cao);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, rong, cao);

  for (const chatLuong of [0.85, 0.7, 0.55]) {
    const blob = await _toBlob(canvas, chatLuong);
    if (!blob) throw new AnhKhongHopLe("Không xử lý được ảnh.");
    if (blob.size <= DICH_BYTE || chatLuong === 0.55) return blob;
  }
  throw new AnhKhongHopLe("Không xử lý được ảnh.");
}

function _taiAnh(file) {
  return new Promise((giai, tuChoi) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); giai(img); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      tuChoi(new AnhKhongHopLe("Tệp này không phải ảnh đọc được."));
    };
    img.src = url;
  });
}

function _taoCanvas(rong, cao) {
  const c = document.createElement("canvas");
  c.width = rong;
  c.height = cao;
  return c;
}

function _toBlob(canvas, chatLuong) {
  return new Promise((giai) => canvas.toBlob(giai, "image/jpeg", chatLuong));
}
