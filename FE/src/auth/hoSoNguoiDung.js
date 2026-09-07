// Hồ sơ hiển thị — dựng TỪ `user` sẵn có trong AuthContext. Không gọi mạng.
//
// NKS là nguồn sự thật của hồ sơ NKS, StudyMap không sao chép nó xuống DB. Hệ quả
// cho lớp giao diện: mọi trường ngoài `email` đều là TUỲ CÓ. Payload `/auth/me`
// hôm nay chỉ mang {id, email, display_name, role}; `avatar`, `phone`, `provider`
// chỉ xuất hiện khi backend chuyển tiếp chúng.
//
// Trường vắng ⇒ DÒNG ĐÓ BIẾN MẤT. Không "—", không "Chưa cập nhật", không đoán:
// một ô trống có nhãn trông y hệt một ô mà người dùng đã xoá nội dung, và người
// dùng sẽ đi tìm chỗ sửa nó ở một hệ thống mà StudyMap không có quyền ghi.

export const NHA_CUNG_CAP = { nks: "NKS", local: "StudyMap" };
export const VAI_TRO = { learner: "Học viên", teacher: "Giảng viên", admin: "Quản trị" };

/** Tên để chào. Không có tên thật thì dùng phần trước @ của email, không dùng id. */
export function tenHienThi(user) {
  const ten = String(user?.display_name || user?.name || "").trim();
  if (ten) return ten;
  const email = String(user?.email || "").trim();
  if (email) return email.split("@")[0];
  return "Người dùng";
}

/** Chữ cái thay ảnh: đầu tên + đầu họ, hoặc hai ký tự đầu nếu chỉ một từ. */
export function chuCaiDaiDien(ten, email) {
  const tu = String(ten || "").trim().split(/\s+/).filter(Boolean);
  if (tu.length >= 2) return (tu[0][0] + tu[tu.length - 1][0]).toUpperCase();
  if (tu.length === 1) return tu[0].slice(0, 2).toUpperCase();
  const e = String(email || "").trim();
  return e ? e[0].toUpperCase() : "?";
}

/**
 * Chỉ nhận URL **https** tuyệt đối.
 *
 * Hợp đồng NKS đã xác minh trả `user.avatar` là URL https trực tiếp. Bất cứ thứ gì
 * khác — `http:` (nội dung lẫn lộn, chặn bởi trình duyệt), `data:` (ảnh nhúng, thứ
 * mà chiều ĐỌC không bao giờ trả), `javascript:` — là giá trị không thuộc hợp đồng
 * và bị bỏ, rơi về chữ cái. Đây là chỗ duy nhất giá trị từ hệ thống ngoài trở thành
 * `src` của một thẻ trên trang.
 */
export function anhDaiDien(user) {
  const url = String(user?.avatar || "").trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : null;
}

/** `null` khi không biết — KHÔNG mặc định "StudyMap", vì đoán sai là nói dối. */
export function nhanNhaCungCap(provider) {
  return NHA_CUNG_CAP[String(provider || "").trim().toLowerCase()] || null;
}

/** Vai trò lạ vẫn hiện nguyên văn: giấu đi thì không ai biết mà sửa bảng ánh xạ. */
export function nhanVaiTro(role) {
  const k = String(role || "").trim().toLowerCase();
  if (!k) return null;
  return VAI_TRO[k] || String(role);
}

/**
 * Toàn bộ nội dung ngăn hồ sơ, dưới dạng dữ liệu thuần — thành phần hiển thị chỉ
 * việc vẽ. Đây cũng là ranh giới test được ở env node (kho này không có DOM).
 */
export function dungHoSo(user) {
  if (!user) return null;
  const ten = tenHienThi(user);
  const email = String(user.email || "");
  const dong = [];
  const them = (khoa, nhan, giaTri) => {
    if (giaTri) dong.push({ khoa, nhan, giaTri: String(giaTri) });
  };
  them("email", "Email", email);
  them("phone", "Điện thoại", user.phone);
  them("role", "Vai trò", nhanVaiTro(user.role));
  them("provider", "Đăng nhập qua", nhanNhaCungCap(user.provider));
  return {
    ten,
    email,
    avatar: anhDaiDien(user),
    chuCai: chuCaiDaiDien(ten, email),
    nhaCungCap: nhanNhaCungCap(user.provider),
    dong,
  };
}
