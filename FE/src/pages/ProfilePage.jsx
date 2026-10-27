import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ProfileDrawer from "../components/Layout/ProfileDrawer";
import { useAuth } from "../auth/useAuth";
import { dungHoSo } from "../auth/hoSoNguoiDung";

/**
 * Round 7 — Hồ sơ tài khoản dạng TRANG riêng (approved design), thay cho ngăn
 * kéo trong AccountMenu. Dùng LẠI nguyên `ProfileDrawer` làm bộ điều khiển —
 * mọi logic NKS (chứng từ, sửa, đổi ảnh) đứng y nguyên một chỗ, trang này chỉ
 * đổi CÁCH VẼ (`variant="page"`) và cách đồng bộ dữ liệu mới về header.
 *
 * `location.key === "default"` ⇒ trang được mở thẳng bằng URL (tải lại, link
 * dán vào thanh địa chỉ, tab mới) — không có lịch sử của ứng dụng để lùi về,
 * nên nút quay lại trỏ thẳng `/app` thay vì gọi `navigate(-1)` (sẽ rời khỏi
 * StudyMap luôn, ra ngoài ứng dụng).
 */
export default function ProfilePage() {
  const { user, updateUserFields } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const quayLai = useCallback(() => {
    if (location.key && location.key !== "default") navigate(-1);
    else navigate("/app");
  }, [navigate, location.key]);

  // Hồ sơ NKS trả về sau khi lưu/đổi ảnh KHÔNG đi qua `/auth/me` (endpoint đó
  // không mang phone/avatar — xem AuthContext), nên đẩy thẳng các trường này
  // vào `user` dùng chung để AccountMenu và mọi nơi khác đọc `user` thấy ngay.
  // Truyền kèm id của người đang đăng nhập LÚC NÀY (lúc tạo callback này, tức
  // lúc lưu bắt đầu) — nếu lượt lưu về chậm sau khi người khác đã đăng nhập
  // trên cùng tab, `updateUserFields` tự bỏ qua thay vì ghi đè nhầm người.
  const onHoSoMoi = useCallback((moi) => {
    updateUserFields({
      display_name: moi.display_name ?? user?.display_name,
      email: moi.email ?? user?.email,
      phone: moi.phone ?? user?.phone,
      avatar: moi.avatar ?? user?.avatar,
    }, user?.id);
  }, [updateUserFields, user]);

  const hoSo = dungHoSo(user);
  if (!hoSo) return null;

  return (
    <ProfileDrawer
      open
      variant="page"
      hoSo={hoSo}
      onClose={quayLai}
      onHoSoMoi={onHoSoMoi}
    />
  );
}
