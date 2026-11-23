import { Icon } from "../ui/Icon";
import Spinner from "../ui/Spinner";

// V9.3 P3a — trạng thái RIÊNG của từng tệp trong một lượt chọn: chờ, đang tải, đã tải lên,
// bị từ chối trước khi gửi (không có "Thử lại": gửi lại cũng bị từ chối y như vậy), hoặc
// lỗi từ máy chủ (có "Thử lại" chỉ cho tệp đó).
const NHAN = {
  cho: "Đang chờ",
  dang_tai: "Đang tải lên…",
  xong: "Đã tải lên. Đang xử lý trong thư viện.",
};

export default function UploadQueue({ hang, dangChay, onThuLai, onDong }) {
  if (!hang.length) return null;
  return (
    <section className="upload-queue surface-card mb-4" aria-label="Tệp đang tải lên">
      <ul className="upload-queue__list" aria-live="polite">
        {hang.map((m) => (
          <li key={m.khoa} data-upload-item className="upload-queue__item" data-state={m.trangThai}>
            <span className="upload-queue__name">{m.ten}</span>
            {m.loi ? (
              <span role="alert" className="upload-queue__error">
                <Icon name="AlertCircle" size={13} aria-hidden="true" /> {m.loi}
              </span>
            ) : (
              <span className="upload-queue__status">
                {m.trangThai === "dang_tai" && <Spinner size={12} />} {NHAN[m.trangThai]}
              </span>
            )}
            {m.trangThai === "loi" && (
              <button type="button" className="pill-action upload-queue__retry" disabled={dangChay}
                      onClick={() => onThuLai(m.khoa)}>
                Thử lại <span className="sr-only">{m.ten}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {!dangChay && (
        <button type="button" className="upload-queue__close text-small" onClick={onDong}>
          Ẩn danh sách tải lên
        </button>
      )}
    </section>
  );
}
