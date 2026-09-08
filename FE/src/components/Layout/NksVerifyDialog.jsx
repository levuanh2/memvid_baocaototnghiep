import { useEffect, useState } from "react";
import Modal from "../ui/Modal";
import { Icon } from "../ui/Icon";

/**
 * Hộp xác minh NKS — đổi mật khẩu lấy một chứng từ ghi 10 phút.
 *
 * Vì sao phải hỏi lại mật khẩu thay vì dùng luôn phiên StudyMap: NKS không có tài
 * khoản máy và token của họ sống 365 ngày, nên StudyMap cố ý KHÔNG giữ nó. Cái giá
 * là một lần gõ mật khẩu cho mỗi lượt sửa; đổi lại, không có gì để rò.
 *
 * Mật khẩu chỉ tồn tại trong `useState` của component này — không localStorage, không
 * context, không log — và bị XOÁ khi hộp thoại đóng.
 *
 * Phải xoá TAY: `ProfileDrawer` dựng hộp thoại này vô điều kiện và nó tự `return null`
 * khi `open` sai, nên đóng lại KHÔNG unmount. Không xoá thì mật khẩu đã gõ còn nằm
 * trong ô ở lần mở sau.
 */
export default function NksVerifyDialog({ open, email, onXacNhan, onClose, dangGui, loi }) {
  const [dinhDanh, setDinhDanh] = useState(email || "");
  const [matKhau, setMatKhau] = useState("");

  useEffect(() => {
    if (open) return;
    setDinhDanh(email || "");
    setMatKhau("");
  }, [open, email]);

  if (!open) return null;

  const guiDuoc = dinhDanh.trim() && matKhau && !dangGui;
  const gui = (e) => {
    e.preventDefault();
    if (!guiDuoc) return;          // chặn gửi trùng ngay tại nguồn
    onXacNhan?.({ identifier: dinhDanh.trim(), password: matKhau });
  };

  return (
    <Modal open title="Xác minh tài khoản NKS" onClose={dangGui ? undefined : onClose} maxWidth={420}>
      <form onSubmit={gui} className="px-5 py-5">
        <p className="text-[13px] leading-[1.6] text-text-secondary">
          Hồ sơ do NKS quản lý. Nhập mật khẩu NKS để mở khoá chỉnh sửa trong 10 phút.
          StudyMap không lưu mật khẩu này.
        </p>

        <label className="block mt-4">
          <span className="font-mono text-[10.5px] tracking-[0.14em] uppercase text-text-muted">
            Tài khoản NKS
          </span>
          <input
            type="text"
            value={dinhDanh}
            onChange={(e) => setDinhDanh(e.target.value)}
            autoComplete="username"
            className="input-surface text-[14px] mt-1.5"
            disabled={dangGui}
          />
        </label>

        <label className="block mt-3">
          <span className="font-mono text-[10.5px] tracking-[0.14em] uppercase text-text-muted">
            Mật khẩu NKS
          </span>
          <input
            type="password"
            value={matKhau}
            onChange={(e) => setMatKhau(e.target.value)}
            autoComplete="current-password"
            className="input-surface text-[14px] mt-1.5"
            disabled={dangGui}
            autoFocus
          />
        </label>

        {loi && (
          <p role="alert" className="mt-3 text-[12.5px]" style={{ color: "var(--err)" }}>
            {loi}
          </p>
        )}

        <div className="flex gap-2 justify-end mt-5">
          <button type="button" onClick={onClose} disabled={dangGui} className="btn-secondary !py-1.5 !text-[13px]">
            Huỷ
          </button>
          <button type="submit" disabled={!guiDuoc} className="btn-seal !py-1.5 !text-[13px] inline-flex items-center gap-1.5">
            {dangGui && <Icon name="Clock" size={14} />}
            {dangGui ? "Đang xác minh…" : "Xác minh"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
