import { masteryPercent } from "../../utils/studyApi";

/**
 * Con dấu mức nắm — chữ ký thị giác của StudyMap.
 *
 * Mực đỏ dâng lên đúng bằng `score`: hình vẽ CHÍNH LÀ con số, không phải trang
 * trí đặt cạnh con số. Phần trăm vẫn in ra giữa dấu, và trạng thái luôn kèm chữ
 * ở nơi gọi — màu không bao giờ là kênh thông tin duy nhất.
 */
export default function SealMeter({ score, status, size = 44, label }) {
  const percent = masteryPercent(score);
  const mastered = status === "mastered";
  return (
    <span
      className={`seal-meter ${mastered ? "seal-meter--mastered" : ""}`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.26)) }}
      role="img"
      aria-label={label || `Mức nắm ${percent} phần trăm`}
      title={label || `Mức nắm ${percent}%`}
    >
      <span className="seal-meter__ink" style={{ height: `${percent}%` }} />
      <span className="seal-meter__value">{percent}</span>
    </span>
  );
}
