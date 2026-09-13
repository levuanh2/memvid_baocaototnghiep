import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import Avatar from "../ui/Avatar";
import ProfileDrawer from "./ProfileDrawer";
import ChangePasswordDialog from "./ChangePasswordDialog";
import { dungHoSo } from "../../auth/hoSoNguoiDung";

/**
 * Khối tài khoản trên thanh đầu: ảnh + tên + menu.
 *
 * `user` đi vào từ `AuthContext` qua props — chỗ này KHÔNG được có bản sao thứ hai
 * của trạng thái đăng nhập, nếu không hai bản sẽ lệch nhau đúng lúc phiên chết. Mở
 * ngăn hồ sơ chỉ là bật một cờ trong bộ nhớ; mạng chỉ được gọi khi người dùng bấm
 * "Chỉnh sửa" bên trong ngăn đó.
 */
export default function AccountMenu({ user, onLogout }) {
  const [moDoiMatKhau, setMoDoiMatKhau] = useState(false);
  const [moMenu, setMoMenu] = useState(false);
  const [moHoSo, setMoHoSo] = useState(false);
  const [hoSoMoi, setHoSoMoi] = useState(null);
  const boc = useRef(null);

  // Bấm ra ngoài / Escape thì đóng menu — cùng cách `Modal` xử lý, ở quy mô nhỏ hơn.
  useEffect(() => {
    if (!moMenu) return;
    const raNgoai = (e) => { if (boc.current && !boc.current.contains(e.target)) setMoMenu(false); };
    const phim = (e) => { if (e.key === "Escape") setMoMenu(false); };
    document.addEventListener("mousedown", raNgoai);
    window.addEventListener("keydown", phim);
    return () => {
      document.removeEventListener("mousedown", raNgoai);
      window.removeEventListener("keydown", phim);
    };
  }, [moMenu]);

  // Hồ sơ mới đọc lại từ provider sau khi lưu. Phủ lên `user` của AuthContext —
  // `/auth/me` không mang `phone`/`avatar`, nên chờ nó thì header không bao giờ đổi.
  // Ưu tiên giá trị của provider, giữ nguyên những khoá nó không nói tới.
  const dayDu = hoSoMoi
    ? {
        ...user,
        display_name: hoSoMoi.display_name ?? user.display_name,
        email: hoSoMoi.email ?? user.email,
        phone: hoSoMoi.phone ?? user.phone,
        avatar: hoSoMoi.avatar ?? user.avatar,
      }
    : user;

  const hoSo = dungHoSo(dayDu);
  if (!hoSo) return null;

  const muc = "w-full flex items-center gap-2.5 px-3 py-2 text-small text-left transition-theme";

  return (
    <div className="relative" ref={boc}>
      <button
        onClick={() => setMoMenu((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={moMenu}
        title={hoSo.email}
        className="flex items-center gap-2 pl-1 pr-1.5 py-1 rounded-full border transition-theme hover:border-[rgba(178,58,46,0.30)]"
        style={{ borderColor: "var(--border-color)" }}
      >
        <Avatar src={hoSo.avatar} chuCai={hoSo.chuCai} size={28} />
        <span className="hidden md:inline text-small text-text-secondary max-w-[140px] truncate">{hoSo.ten}</span>
        <Icon name="ChevronDown" size={14} className={moMenu ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>

      {moMenu && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-[228px] rounded-[10px] border overflow-hidden py-1 animate-fadeUp"
          style={{ background: "var(--bg-card)", borderColor: "var(--border-strong)", boxShadow: "var(--shadow-card-hover)" }}
        >
          <div className="px-3 pt-2 pb-2.5 border-b" style={{ borderColor: "var(--border-color)" }}>
            <div className="text-small font-medium text-text-primary truncate">{hoSo.ten}</div>
            <div className="text-caption text-text-muted truncate">{hoSo.email}</div>
          </div>

          <button
            role="menuitem"
            className={`${muc} text-text-secondary hover:text-forest`}
            onClick={() => { setMoMenu(false); setMoHoSo(true); }}
          >
            <Icon name="UserRound" size={15} /> Hồ sơ tài khoản
          </button>

          {/* Chỉ tài khoản NKS mới có mật khẩu NKS để đổi. Người dùng local KHÔNG
              được đưa tới endpoint NKS — với họ mục này không tồn tại, chứ không
              phải hiện ra rồi báo lỗi. */}
          {hoSo.nhaCungCap === "NKS" && (
            <button
              role="menuitem"
              className={`${muc} text-text-secondary hover:text-forest`}
              onClick={() => { setMoMenu(false); setMoDoiMatKhau(true); }}
            >
              <Icon name="KeyRound" size={15} /> Đổi mật khẩu
            </button>
          )}

          <div className="my-1 border-t" style={{ borderColor: "var(--border-color)" }} />

          <button role="menuitem" className={`${muc} text-text-secondary hover:text-forest`} onClick={() => { setMoMenu(false); onLogout?.(); }}>
            <Icon name="LogOut" size={15} /> Đăng xuất
          </button>
        </div>
      )}

      <ProfileDrawer
        open={moHoSo}
        hoSo={hoSo}
        onClose={() => setMoHoSo(false)}
        onHoSoMoi={setHoSoMoi}
      />

      <ChangePasswordDialog
        open={moDoiMatKhau}
        email={hoSo.email}
        onClose={() => setMoDoiMatKhau(false)}
        onDoiXong={() => {
          setMoDoiMatKhau(false);
          // Máy chủ đã vô hiệu mọi token StudyMap của người này, nên ở lại là ở lại
          // với một phiên đã chết. Dùng chính đường đăng xuất sẵn có: nó dọn token,
          // dọn state theo người dùng, rồi chuyển về trang đăng nhập.
          onLogout?.({ lyDo: "doi-mat-khau" });
        }}
      />
    </div>
  );
}
