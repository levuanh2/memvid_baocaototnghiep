import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import { Icon } from "./Icon";
import Spinner from "./Spinner";

/**
 * Round 7 — hộp xác nhận DÙNG CHUNG cho mọi thao tác XOÁ VĨNH VIỄN (không áp
 * dụng cho hành động có thể khôi phục, như "ẩn khỏi thư viện" — xem
 * BulkBar.jsx, cố tình không dùng hộp này).
 *
 * Hộp này KHÔNG BAO GIỜ tự gọi API xoá. `onConfirm` là một hàm async do nơi
 * gọi cung cấp; hộp chỉ chờ nó, khoá nút trong lúc chờ (chặn gửi trùng), và
 * hiện lỗi nếu nó ném lỗi — KHÔNG đóng, KHÔNG báo thành công khi chưa chắc.
 * Đóng sau khi xoá xong là việc của nơi gọi (họ còn phải tự làm mới danh
 * sách/refresh state của họ trước).
 *
 * Ô tích xác nhận bắt buộc mới mở khoá nút xoá — không tích thì bấm cũng
 * không gửi gì. Đổi mục tiêu (đóng rồi mở lại cho một mục khác) tự đặt lại ô
 * tích và lỗi cũ, không mang "đã xác nhận" của mục trước sang mục sau.
 */
export default function DestructiveConfirmDialog({
  open,
  title,
  targetName,
  consequenceText = "Không thể hoàn tác.",
  confirmLabel = "Xoá",
  cancelLabel = "Huỷ",
  onConfirm,
  onCancel,
}) {
  const [daTick, setDaTick] = useState(false);
  const [dangXoa, setDangXoa] = useState(false);
  const [loi, setLoi] = useState("");
  const dangGuiRef = useRef(false); // chặn gửi trùng ngay cả khi 2 sự kiện click lọt qua disabled

  useEffect(() => {
    if (!open) return;
    setDaTick(false);
    setDangXoa(false);
    setLoi("");
  }, [open, targetName]);

  if (!open) return null;

  const xacNhan = async () => {
    if (!daTick || dangGuiRef.current) return;
    dangGuiRef.current = true;
    setDangXoa(true);
    setLoi("");
    try {
      await onConfirm?.();
      // Thành công: nơi gọi tự đóng hộp (họ còn phải cập nhật state/list của
      // họ trước). Không tự đóng ở đây để không báo xong trước khi chắc chắn.
    } catch (err) {
      setLoi(err?.message || "Không xoá được. Thử lại.");
      setDangXoa(false);
      dangGuiRef.current = false;
    }
  };

  return (
    <Modal
      open
      title={title}
      onClose={dangXoa ? undefined : onCancel}
      maxWidth={440}
      footer={
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-secondary !py-1.5 !text-small" disabled={dangXoa} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn-seal !py-1.5 !text-small inline-flex items-center gap-1.5"
            style={{ background: "var(--err)", borderColor: "var(--err)" }}
            disabled={!daTick || dangXoa}
            onClick={xacNhan}
          >
            {dangXoa && <Spinner size={13} />}
            {dangXoa ? "Đang xoá…" : confirmLabel}
          </button>
        </div>
      }
    >
      <div className="px-5 py-5">
        <div className="flex items-start gap-3">
          <Icon name="TriangleAlert" size={20} style={{ color: "var(--err)" }} className="shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-body text-text-primary">
              Xoá {targetName ? <strong className="break-words">“{targetName}”</strong> : "mục này"}?
            </p>
            <p className="mt-1.5 text-small text-text-secondary">{consequenceText}</p>
          </div>
        </div>

        <label className="mt-4 flex items-start gap-2.5 text-small text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={daTick}
            disabled={dangXoa}
            onChange={(e) => setDaTick(e.target.checked)}
          />
          <span>Tôi hiểu thao tác này không thể hoàn tác.</span>
        </label>

        {loi && (
          <p role="alert" className="mt-3 text-small" style={{ color: "var(--err)" }}>
            {loi}
          </p>
        )}
      </div>
    </Modal>
  );
}
