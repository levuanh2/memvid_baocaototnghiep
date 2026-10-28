import { useEffect, useRef } from "react";
import Modal from "../ui/Modal";
import Avatar from "../ui/Avatar";
import { Icon } from "../ui/Icon";

/**
 * Phần HIỂN THỊ của ngăn hồ sơ — không hook mạng, không state nghiệp vụ.
 *
 * Tách khỏi `ProfileDrawer` khi ngăn này có thêm chế độ sửa: chế độ sửa cần state
 * thật, mà kho này test ở env node không có DOM (xem `phienNguoiDung.test.js`). Giữ
 * phần vẽ ở một hàm thuần thì nó vẫn gọi thẳng được như một hàm bình thường và trả
 * về cây element — dữ liệu đọc được — thay vì phải render.
 *
 * KHÔNG có ô "Tên hiển thị" ở chế độ sửa: đo thật cho thấy `name` của NKS độc lập
 * với firstname/lastname và endpoint ghi không có tham số nào đặt nó.
 *
 * Round 7: `variant="page"` vẽ CÙNG nội dung này như một trang riêng thay vì hộp
 * thoại — không Modal bọc ngoài, có nút quay lại và tự nhận focus vào tiêu đề khi
 * mở. `variant="modal"` (mặc định) giữ nguyên hành vi cũ, không đổi gì — không còn
 * nơi nào trong sản phẩm mount nó nữa (AccountMenu giờ điều hướng sang trang), chỉ
 * giữ lại để không phải viết lại `ProfileDrawer` thành hai bản logic song song.
 */
export default function ProfileView({
  hoSo, onClose, laNks, dangSua, dangTai, onSua, rongHon, khoiAnh, children,
  variant = "modal",
}) {
  if (!hoSo) return null;

  const body = (
    <>
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
            type="button"
            aria-label="Chỉnh sửa hồ sơ tại NKS"
            className="pill-action profile-edit-action flex-shrink-0"
            title="Chỉnh sửa hồ sơ tại NKS"
          >
            <Icon name={dangTai ? "Clock" : "Pencil"} size={14} />
            <span>{dangTai ? "Đang mở…" : "Chỉnh sửa"}</span>
          </button>
        )}
      </div>

      {/* Trường chỉ đọc — trường vắng thì KHÔNG có dòng, không hiện ô trống có nhãn.
          Sprint J: 2 cột ở ngưỡng sm bổ đôi hộp thoại hẹp (460px) thành ~200px/cột —
          một email dài (vd "sprinti-qa-1789286238622@example.com") vỡ ba dòng dù đã
          `break-words`. Một cột duy nhất tránh vỡ dòng cho MỌI độ dài giá trị, không
          cần biết trước trường nào sẽ dài. */}
      <dl className="mt-6 grid grid-cols-1 gap-x-5 gap-y-4">
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
    </>
  );

  if (variant === "page") {
    return <ProfilePageShell onBack={onClose}>{body}</ProfilePageShell>;
  }

  return (
    <Modal open title="Hồ sơ tài khoản" onClose={onClose} maxWidth={rongHon ? 620 : 460}>
      <div className="px-5 py-6">{body}</div>
    </Modal>
  );
}

/**
 * Khung trang — không phải hộp thoại: nút quay lại, tiêu đề tự nhận focus khi mở.
 *
 * `onBack` undefined (đang lưu dở) ⇒ nút bị VÔ HIỆU HOÁ, không phải rơi về một
 * điều hướng mặc định — y hệt lý do Modal's `onClose` cũng thành undefined lúc
 * `dangLuu`: không cho rời trang giữa lúc lưu. `ProfilePage` (nơi mount) là chỗ
 * quyết định quay lại đi đâu khi được mở trực tiếp bằng URL (không có lịch sử),
 * không phải chỗ này.
 */
function ProfilePageShell({ onBack, children }) {
  const tieuDeRef = useRef(null);

  useEffect(() => { tieuDeRef.current?.focus(); }, []);

  return (
    <div className="min-h-screen overflow-y-auto" style={{ background: "var(--bg-base)" }}>
      <header className="sticky top-0 z-20 border-b transition-theme"
        style={{ background: "var(--bg-sidebar)", borderColor: "var(--border-color)" }}>
        <div className="max-w-[720px] mx-auto px-5 py-3 flex items-center gap-4">
          <button type="button" onClick={onBack} disabled={!onBack}
            className="inline-flex min-h-[44px] items-center gap-1.5 text-small text-text-muted hover:text-accent transition-theme shrink-0 disabled:opacity-50 disabled:pointer-events-none">
            <Icon name="ArrowLeft" size={14} /> Quay lại
          </button>
          <h1 ref={tieuDeRef} tabIndex={-1} className="font-display text-h3 font-semibold text-text-primary outline-none">
            Hồ sơ tài khoản
          </h1>
        </div>
      </header>
      <main className="max-w-[720px] mx-auto px-5 py-8">
        <div className="surface-card px-5 py-6 sm:px-7 sm:py-8">{children}</div>
      </main>
    </div>
  );
}
