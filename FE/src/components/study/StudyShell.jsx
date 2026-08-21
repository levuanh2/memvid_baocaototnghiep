import { Link } from "react-router-dom";
import { Icon } from "../ui/Icon";
import Spinner from "../ui/Spinner";

/**
 * Khung chung cho các trang StudyMap.
 *
 * Cùng bảng màu / chữ với phòng đọc (chat) — StudyMap là một gian khác của cùng
 * toà nhà, không phải sản phẩm thứ hai. Eyebrow mono giữ nguyên vai trò cũ: nói
 * người đọc đang ở đâu.
 */
export default function StudyShell({
  eyebrow = "StudyMap",
  title,
  subtitle,
  backTo = "/app/study",
  backLabel = "Tài liệu",
  actions = null,
  loading = false,
  error = null,
  onRetry = null,
  children,
  width = "max-w-[980px]",
}) {
  return (
    <div className="min-h-screen overflow-y-auto" style={{ background: "var(--bg-base)" }}>
      <header
        className="sticky top-0 z-20 border-b transition-theme"
        style={{ background: "var(--bg-sidebar)", borderColor: "var(--border-color)" }}
      >
        <div className={`${width} mx-auto px-5 py-3 flex items-center gap-4`}>
          {backTo && (
            <Link
              to={backTo}
              className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-brand transition-theme shrink-0"
            >
              <Icon name="ArrowLeft" size={14} /> {backLabel}
            </Link>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[10.5px] tracking-[0.2em] uppercase text-text-muted">
              {eyebrow}
            </div>
            <h1 className="font-display text-[19px] font-semibold text-text-primary truncate">
              {title}
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        </div>
      </header>

      <main className={`${width} mx-auto px-5 py-7`}>
        {subtitle && <p className="text-[13.5px] text-text-secondary mb-6">{subtitle}</p>}

        {loading ? (
          <div className="flex items-center gap-2.5 text-[13.5px] text-text-secondary py-10">
            <Spinner size={15} /> Đang tải…
          </div>
        ) : error ? (
          <div className="surface-card flex flex-col items-start gap-3">
            <div className="flex items-center gap-2 text-[13.5px]" style={{ color: "var(--err)" }}>
              <Icon name="AlertCircle" size={15} /> {error}
            </div>
            {onRetry && (
              <button type="button" className="btn-secondary text-[13px]" onClick={onRetry}>
                Thử lại
              </button>
            )}
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

/** Trạng thái rỗng — luôn kèm một việc làm được ngay, không phải câu than. */
export function EmptyState({ icon = "FileText", title, hint, action }) {
  return (
    <div className="surface-card flex flex-col items-center text-center py-12 gap-3">
      <Icon name={icon} size={26} className="text-text-muted" />
      <div className="font-display text-[16px] font-semibold text-text-primary">{title}</div>
      {hint && <p className="text-[13px] text-text-secondary max-w-[380px]">{hint}</p>}
      {action}
    </div>
  );
}

/** Nhãn trạng thái dạng chữ (không bao giờ chỉ dùng màu). */
export function StatusTag({ status }) {
  const map = {
    completed: ["badge-ready", "Đã xử lý"],
    ready: ["badge-ready", "Sẵn sàng"],
    graded: ["badge-ready", "Đã chấm"],
    processing: ["badge-processing", "Đang xử lý"],
    index_ready: ["badge-processing", "Đang xử lý"],
    uploaded: ["badge-processing", "Chờ xử lý"],
    submitted: ["badge-processing", "Đã nộp"],
    in_progress: ["badge-processing", "Đang làm"],
    failed: ["badge-error", "Thất bại"],
    error: ["badge-error", "Lỗi"],
    deleted: ["badge-error", "Đã xoá"],
  };
  const [cls, text] = map[status] || ["badge-processing", status || "—"];
  return <span className={cls}>{text}</span>;
}
