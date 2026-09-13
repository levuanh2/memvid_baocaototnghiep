import { useCallback, useEffect, useState } from "react";
import Modal from "../ui/Modal";
import { Icon } from "../ui/Icon";
import { O, kiemTra, loiDeDoc, sauKhiHong, trangThaiSach } from "../../auth/matKhauForm";
import { doiMatKhauNks } from "../../utils/api";

/**
 * Đổi mật khẩu NKS.
 *
 * KHÔNG dùng chứng từ ghi 10 phút: `updatePass` vốn đã đòi mật khẩu hiện tại, nên
 * không tiết kiệm được thao tác nào, mà lại biến một chứng từ bị đánh cắp từ "sửa
 * được hồ sơ" thành "khoá được chủ tài khoản ra ngoài".
 *
 * Đổi xong, máy chủ vô hiệu MỌI token StudyMap của người này (`reauth_required`), nên
 * ở đây phải dọn phiên và đưa về màn hình đăng nhập — không có cách nào ở lại.
 *
 * Mật khẩu chỉ sống trong `useState` của component này — không localStorage, không
 * context, không log — và bị XOÁ khi hộp thoại đóng.
 *
 * Việc xoá đó phải làm TAY: `AccountMenu` dựng hộp thoại này vô điều kiện và nó tự
 * `return null` khi `open` sai, nên đóng lại KHÔNG unmount và KHÔNG tự mất state. Bỏ
 * bước xoá thì mở lại sẽ thấy nguyên mật khẩu đã gõ lần trước, kèm cả công tắc "Hiện
 * mật khẩu" nếu nó đang bật — tức là mật khẩu cũ hiện rõ cho người kế tiếp ngồi vào máy.
 */
export default function ChangePasswordDialog({ open, email, onClose, onDoiXong }) {
  const [form, setForm] = useState(() => trangThaiSach(email).form);
  const [loi, setLoi] = useState({});
  const [loiChung, setLoiChung] = useState("");
  const [dangGui, setDangGui] = useState(false);
  const [hien, setHien] = useState(false);

  // Đóng ⇒ xoá sạch. Xem docstring: hộp thoại không unmount, nên đây là chỗ DUY NHẤT
  // bảo đảm lần mở sau bắt đầu từ trắng.
  useEffect(() => {
    if (open) return;
    const sach = trangThaiSach(email);
    setForm(sach.form);
    setLoi(sach.loi);
    setLoiChung(sach.loiChung);
    setHien(sach.hien);
  }, [open, email]);

  const doi = useCallback((k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setLoi((l) => (l[k] ? { ...l, [k]: undefined } : l));
    setLoiChung("");
  }, []);

  const gui = useCallback(async (e) => {
    e.preventDefault();
    if (dangGui) return;                       // chặn gửi trùng ngay tại nguồn

    const l = kiemTra(form);
    setLoi(l);
    if (Object.keys(l).length) return;

    setDangGui(true);
    setLoiChung("");
    try {
      await doiMatKhauNks(form);
      // Token StudyMap đã chết ở máy chủ. Người gọi lo dọn phiên + chuyển trang.
      onDoiXong?.();
    } catch (err) {
      setLoiChung(loiDeDoc(err?.code, err?.status, err?.message));
      // Giữ định danh, xoá các ô mật khẩu — người dùng vốn phải gõ lại thứ vừa sai.
      setForm(sauKhiHong(form));
    } finally {
      setDangGui(false);
    }
  }, [form, dangGui, onDoiXong]);

  if (!open) return null;

  return (
    <Modal open title="Đổi mật khẩu NKS" onClose={dangGui ? undefined : onClose} maxWidth={440}>
      <form onSubmit={gui} className="px-5 py-5">
        <p className="text-small text-text-secondary">
          Mật khẩu này thuộc tài khoản NKS. Sau khi đổi, bạn sẽ được đăng xuất khỏi
          StudyMap trên mọi thiết bị và cần đăng nhập lại.
        </p>

        {O.map((o) => (
          <label key={o.khoa} className="block mt-3.5">
            <span className="font-mono text-metadata uppercase text-text-muted">
              {o.nhan}
            </span>
            <input
              type={o.loai === "password" && hien ? "text" : o.loai}
              value={form[o.khoa]}
              onChange={(e) => doi(o.khoa, e.target.value)}
              autoComplete={o.auto}
              disabled={dangGui}
              aria-invalid={loi[o.khoa] ? true : undefined}
              aria-describedby={loi[o.khoa] ? `loi-${o.khoa}` : undefined}
              className="input-surface text-body mt-1.5"
            />
            {loi[o.khoa] && (
              <p id={`loi-${o.khoa}`} role="alert" className="mt-1 text-caption"
                style={{ color: "var(--err)" }}>
                {loi[o.khoa]}
              </p>
            )}
          </label>
        ))}

        <label className="flex items-center gap-2 mt-3 text-small text-text-secondary select-none">
          <input type="checkbox" checked={hien} disabled={dangGui}
            onChange={(e) => setHien(e.target.checked)} />
          Hiện mật khẩu
        </label>

        {loiChung && (
          <p role="alert" className="mt-3 text-small" style={{ color: "var(--err)" }}>
            {loiChung}
          </p>
        )}

        <div className="flex gap-2 justify-end mt-5">
          <button type="button" onClick={onClose} disabled={dangGui}
            className="btn-secondary !py-1.5 !text-small">
            Huỷ
          </button>
          <button type="submit" disabled={dangGui}
            className="btn-seal !py-1.5 !text-small inline-flex items-center gap-1.5">
            {dangGui && <Icon name="Clock" size={14} />}
            {dangGui ? "Đang đổi…" : "Đổi mật khẩu"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
