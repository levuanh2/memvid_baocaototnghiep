import Modal from "../ui/Modal";
import Avatar from "../ui/Avatar";
import { Icon } from "../ui/Icon";

/**
 * Phần HIỂN THỊ của ngăn hồ sơ — không hook, không mạng, không state.
 *
 * Tách khỏi `ProfileDrawer` khi ngăn này có thêm chế độ sửa: chế độ sửa cần state
 * thật, mà kho này test ở env node không có DOM (xem `phienNguoiDung.test.js`). Giữ
 * phần vẽ ở một hàm thuần thì nó vẫn gọi thẳng được như một hàm bình thường và trả
 * về cây element — dữ liệu đọc được — thay vì phải render.
 *
 * KHÔNG có ô "Tên hiển thị" ở chế độ sửa: đo thật cho thấy `name` của NKS độc lập
 * với firstname/lastname và endpoint ghi không có tham số nào đặt nó.
 */
export default function ProfileView({
  hoSo, onClose, laNks, dangSua, dangTai, onSua, rongHon, khoiAnh, children,
}) {
  if (!hoSo) return null;

  return (
    <Modal open title="Hồ sơ tài khoản" onClose={onClose} maxWidth={rongHon ? 620 : 460}>
      <div className="px-5 py-6">

        {/* Danh tính: ảnh lớn, tên, nơi đăng nhập.
            `khoiAnh` thay chỗ tấm ảnh khi tài khoản đổi được ảnh — nó tự mang ảnh,
            nút bấm và trạng thái xem trước của riêng nó. */}
        {khoiAnh}
        <div className={`flex items-center gap-4${khoiAnh ? " mt-4" : ""}`}>
          {!khoiAnh && <Avatar src={hoSo.avatar} chuCai={hoSo.chuCai} size={72} />}
          <div className="min-w-0 flex-1">
            <div className="font-display text-h3 font-semibold text-text-primary truncate" title={hoSo.ten}>
              {hoSo.ten}
            </div>
            {hoSo.nhaCungCap && (
              <div className="mt-1 font-mono text-metadata uppercase text-text-muted">
                {hoSo.nhaCungCap}
              </div>
            )}
          </div>
          {laNks && !dangSua && (
            <button
              onClick={onSua}
              disabled={dangTai}
              className="pill-action flex-shrink-0"
              title="Chỉnh sửa hồ sơ tại NKS"
            >
              <Icon name={dangTai ? "Clock" : "Pencil"} size={14} />
              <span className="hidden sm:inline">{dangTai ? "Đang mở…" : "Chỉnh sửa"}</span>
            </button>
          )}
        </div>

        {/* Trường chỉ đọc — trường vắng thì KHÔNG có dòng, không hiện ô trống có nhãn */}
        <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
          {hoSo.dong.map((d) => (
            <div key={d.khoa} className="min-w-0">
              <dt className="font-mono text-metadata uppercase text-text-muted">{d.nhan}</dt>
              <dd className="mt-1 text-body text-text-primary break-words">{d.giaTri}</dd>
            </div>
          ))}
        </dl>

        {children}

        {hoSo.nhaCungCap === "NKS" && !dangSua && (
          <p className="mt-6 pt-4 border-t text-small text-text-muted"
            style={{ borderColor: "var(--border-color)" }}>
            Hồ sơ này do NKS quản lý. Thay đổi ở đây được ghi thẳng sang NKS; tên hiển thị
            và ảnh đại diện phải sửa tại tài khoản NKS.
          </p>
        )}
      </div>
    </Modal>
  );
}
