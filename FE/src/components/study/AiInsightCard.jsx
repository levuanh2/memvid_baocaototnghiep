import { Icon } from "../ui/Icon";
import Spinner from "../ui/Spinner";
import { noiDungInsight, GIAI_DOAN } from "../../utils/aiInsight";

/**
 * Thẻ AI Insight sau khi tải lên — nhỏ, đóng được, KHÔNG chặn thao tác.
 *
 * Toàn bộ phần quyết định nằm ở `utils/aiInsight.js` (thuần, có test). Ở đây chỉ
 * là hiển thị.
 *
 * Điều quan trọng nhất về thẻ này là thứ nó KHÔNG làm: nó không nói "AI đã đọc
 * xong" cho tới khi có một bản tóm tắt THẬT. Ingest không tự tạo tóm tắt, nên
 * ngay sau khi tải lên thì trạng thái thật là "đã lập chỉ mục, chưa có tóm tắt" —
 * và thẻ nói đúng câu đó, kèm một nút để tạo.
 */

const NHAN_HANH_DONG = {
  tom_tat: ["Tạo tóm tắt", "ScrollText", "summary"],
  mo_tom_tat: ["Mở tóm tắt", "ScrollText", "summary"],
  so_do: ["Tạo sơ đồ", "Network", "studymap"],
  mo_so_do: ["Mở sơ đồ", "Network", "studymap"],
  hoi_ai: ["Hỏi AI", "MessageSquare", "chat"],
  tai_lai: ["Tải lại tài liệu", "Upload", null],
};

export default function AiInsightCard({ doc, dangTai, tenTep, onMo, onTaiLai, onDong }) {
  const n = noiDungInsight(doc, { dangTai, tenTep });
  const hong = n.giaiDoan === GIAI_DOAN.HONG;

  return (
    <div
      className="surface-card !p-3.5 mb-5 flex items-start gap-3"
      style={hong
        ? { borderColor: "var(--err)" }
        : { borderColor: "var(--accent)", background: "var(--bg-sidebar)" }}
      role="status"
      aria-live="polite"
    >
      <span className="shrink-0 mt-[2px]">
        {n.dangChay
          ? <Spinner size={15} />
          : <Icon name={hong ? "AlertCircle" : "Sparkles"} size={16}
                  className={hong ? "" : "text-brand"}
                  style={hong ? { color: "var(--err)" } : undefined} />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="text-body font-semibold text-text-primary">{n.tieuDe}</div>
        <div className="font-mono text-caption text-text-muted truncate mt-0.5">{n.ten}</div>

        {n.moTa && (
          <p className="mt-1.5 text-small text-text-secondary">{n.moTa}</p>
        )}

        {n.yChinh.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {n.yChinh.map((y, i) => (
              <li key={i} className="flex gap-2 text-small text-text-primary">
                <span aria-hidden className="text-brand">•</span>
                <span>{y}</span>
              </li>
            ))}
          </ul>
        )}

        {n.hanhDong.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {n.hanhDong.map((khoa) => {
              const [nhan, icon, beMat] = NHAN_HANH_DONG[khoa] || [];
              if (!nhan) return null;
              return (
                <button key={khoa} type="button" className="pill-action"
                        onClick={() => (beMat ? onMo?.(doc, beMat) : onTaiLai?.())}>
                  <Icon name={icon} size={13} /> {nhan}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <button type="button" className="icon-btn w-7 h-7 shrink-0"
              aria-label="Đóng thông báo" onClick={onDong}>
        <Icon name="X" size={14} />
      </button>
    </div>
  );
}
