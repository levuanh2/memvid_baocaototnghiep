/**
 * Đường kẻ giữa hai cột, kéo được.
 *
 * `role="separator"` với `aria-orientation="vertical"` là vai trò ARIA đúng cho
 * thanh chia kéo được, và nó bắt buộc phải dùng được bằng bàn phím — mũi tên
 * nới 16px, Home/End về hai đầu, Enter đặt lại. Kéo chuột là lối tắt, không
 * phải lối duy nhất.
 */
export default function PanelDivider({ side, label, width, min, max, onDrag, onNudge, onReset, active }) {
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 48 : 16;
    // Cột phải nới về phía trái, nên mũi tên phải đảo dấu cho khớp với mắt nhìn.
    const dir = side === "right" ? -1 : 1;
    if (e.key === "ArrowLeft")  { e.preventDefault(); onNudge(-step * dir); }
    if (e.key === "ArrowRight") { e.preventDefault(); onNudge(step * dir); }
    if (e.key === "Home")       { e.preventDefault(); onNudge(-9999 * dir); }
    if (e.key === "End")        { e.preventDefault(); onNudge(9999 * dir); }
    if (e.key === "Enter")      { e.preventDefault(); onReset(); }
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={`Đổi bề rộng ${label}`}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      className={`panel-divider${active ? " panel-divider--active" : ""}`}
      onPointerDown={onDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <span className="panel-divider__grip" aria-hidden />
    </div>
  );
}
