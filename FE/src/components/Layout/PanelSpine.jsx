import { Icon } from "../ui/Icon";

/**
 * Cột đã thu gọn, hiện dưới dạng gáy sách trên kệ.
 *
 * Không dùng nút nổi hay biểu tượng ba gạch: bàn đọc thì thứ bị đẩy sang bên
 * vẫn phải nhìn thấy được, và cái nhìn thấy là gáy sách có tên. Tên đặt dọc nên
 * dải chỉ rộng 34px mà vẫn đọc được, không phải đoán bằng biểu tượng.
 */
export default function PanelSpine({ side, label, count, onExpand }) {
  const chevron = side === "left" ? "ArrowRight" : "ArrowLeft";
  return (
    <button
      type="button"
      onClick={onExpand}
      className={`panel-spine ${side === "left" ? "panel-spine--left" : "panel-spine--right"}`}
      aria-label={`Mở ${label}`}
      title={`Mở ${label}`}
    >
      <Icon name={chevron} size={14} className="panel-spine__chevron" />
      <span className="panel-spine__label">{label}</span>
      {count > 0 && <span className="panel-spine__count">{count}</span>}
    </button>
  );
}
