/**
 * Ảnh đại diện tròn, với chữ cái làm nền.
 *
 * Chữ cái LUÔN được vẽ; ảnh (nếu có) nằm đè lên. Link hỏng / hệ thống ngoài đổi
 * ảnh / mạng chặn ⇒ `onError` giấu thẻ ảnh và chữ cái lộ ra. Không state, và không
 * có khoảnh khắc nào ô này trống.
 */
export default function Avatar({ src, chuCai, size = 32, className = "" }) {
  return (
    <div
      className={`relative rounded-full flex-shrink-0 overflow-hidden inline-flex items-center justify-center font-display font-semibold select-none ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        background: "color-mix(in srgb, var(--accent) 12%, transparent)",
        color: "var(--accent)",
        border: "1.5px solid var(--border-strong)",
      }}
    >
      {chuCai}
      {src && (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
    </div>
  );
}
