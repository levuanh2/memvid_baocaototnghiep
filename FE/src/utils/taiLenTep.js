// Kiểm tra một tệp trước khi gửi lên (V9.3 P3a, docs/StudyMap-V9.3/05, mục tải tài liệu):
// định dạng trước, dung lượng sau; đúng bằng giới hạn vẫn qua bước này.
//
// Danh sách đuôi KHÔNG chép ở đây: nó là thuộc tính `accept` của ô chọn tệp trong
// DocumentList.jsx, chuỗi mà BE/tests/test_upload_formats.py khoá khớp với backend.
//
// ponytail: giới hạn là mặc định MAX_UPLOAD_MB=100 của BE/app/main.py, mà máy chủ tính cho CẢ
// request multipart (MAX_CONTENT_LENGTH), không riêng tệp. Tệp sát mốc vẫn có thể nhận 413,
// và môi trường nào đổi biến đó thì máy chủ vẫn là thẩm quyền: lỗi ấy hiện ở dòng của chính
// tệp đó. Bước này chỉ để không bắt người học chờ tải 300 MB rồi mới nghe "quá lớn".
export const GIOI_HAN_TAI_LEN = 100 * 1024 * 1024;

export function kiemTraTep(tep, accept, gioiHan = GIOI_HAN_TAI_LEN) {
  const ten = tep?.name || "";
  const cham = ten.lastIndexOf(".");
  const duoi = cham > 0 ? ten.slice(cham).toLowerCase() : "";
  if (!duoi || !accept.split(",").includes(duoi)) {
    return duoi ? `Chưa hỗ trợ định dạng ${duoi}.` : "Tệp không có phần mở rộng nên chưa nhận ra định dạng.";
  }
  if (tep.size > gioiHan) return `Tệp lớn hơn ${Math.round(gioiHan / 1024 / 1024)} MB.`;
  return null;
}
