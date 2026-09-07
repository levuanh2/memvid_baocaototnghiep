// Kiểm lại phiên khi trình duyệt KHÔI PHỤC trang từ bfcache.
//
// Vì sao cần: bfcache trả lại nguyên vẹn heap JS và DOM — React KHÔNG mount lại,
// effect KHÔNG chạy lại, không một request nào được bắn. Toàn bộ hàng rào của
// `AuthContext` nằm ở lượt mount, nên với một trang được khôi phục thì chúng chưa
// bao giờ chạy. Người dùng A rời trang, B đăng nhập ở nơi khác, bấm Back — giao
// diện của A hiện lại nguyên vẹn dù localStorage đã là token của B.
//
// `pageshow` là sự kiện DUY NHẤT bắn ở lượt khôi phục đó, và `event.persisted`
// là thứ duy nhất phân biệt "khôi phục từ bfcache" với "tải trang bình thường".
// Điều hướng SPA (pushState) KHÔNG bắn `pageshow`, nên cơ chế này không đụng gì
// tới đường đi thường ngày.

export const GIU = "giu";
export const HUY = "huy";

/**
 * Sau khi hỏi lại server, giữ giao diện đang có hay huỷ phiên?
 *
 * `HUY` khi phiên đã chết (`userTraVe` rỗng) HOẶC khi server trả về một người dùng
 * KHÁC với người mà giao diện đang hiển thị. Trường hợp thứ hai chính là ca bfcache:
 * màn hình là của A, token trong localStorage là của B.
 *
 * Không có `idDangHienThi` (trang công khai, chưa đăng nhập lúc rời đi) thì không có
 * gì cũ để rò — giữ nguyên, để luồng đăng nhập bình thường lo tiếp.
 */
export function quyetDinh(idDangHienThi, userTraVe) {
  if (!idDangHienThi) return GIU;
  if (!userTraVe || !userTraVe.id) return HUY;
  return userTraVe.id === idDangHienThi ? GIU : HUY;
}

/**
 * Gắn listener `pageshow`. Trả về hàm gỡ.
 *
 * `layIdDangHienThi` là hàm chứ không phải giá trị: listener đăng ký MỘT lần và
 * phải đọc được id ở thời điểm sự kiện xảy ra, không phải id lúc đăng ký.
 *
 * `dangKiem` chặn chồng lượt kiểm: vài trình duyệt bắn `pageshow` nhiều lần, và một
 * lần kiểm còn đang bay mà lần sau đã chạy thì hai lời gọi mạng đua nhau ghi state.
 */
export function caiDatKiemTraKhoiPhuc({
  layIdDangHienThi,
  layUser,
  onHuy,
  onGiu,
  window: win = typeof window === "undefined" ? undefined : window,
}) {
  if (!win || typeof win.addEventListener !== "function") return () => {};

  let dangKiem = false;

  const xuLy = async (ev) => {
    // CHỈ lượt khôi phục từ bfcache. Tải trang bình thường đã có hàng rào lúc mount;
    // chạy thêm ở đây là một lời gọi `/auth/me` thừa cho mỗi lần mở trang.
    if (!ev || ev.persisted !== true) return;
    if (dangKiem) return;
    dangKiem = true;
    try {
      const id = layIdDangHienThi();
      let user = null;
      try {
        user = await layUser();
      } catch {
        user = null;      // mạng hỏng / token hỏng ⇒ coi như phiên đã chết
      }
      if (quyetDinh(id, user) === HUY) onHuy?.();
      else onGiu?.(user);
    } finally {
      dangKiem = false;
    }
  };

  win.addEventListener("pageshow", xuLy);
  return () => win.removeEventListener("pageshow", xuLy);
}
