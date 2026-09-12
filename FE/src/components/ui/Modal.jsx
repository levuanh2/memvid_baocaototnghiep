import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

// Phase 6, Step 2 — cùng danh sách chọn dùng cho cả auto-focus lẫn bẫy Tab bên
// dưới, MỘT chỗ định nghĩa "cái gì đếm là focus được" cho hộp thoại này.
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Shared portal modal frame. Backdrop click + Escape close.
 * `fullBleed` skips internal padding/scroll for canvas content (e.g. ReactFlow).
 */
export default function Modal({
  open = true,
  title,
  subtitle,
  onClose,
  children,
  footer,
  maxWidth = 920,
  fullBleed = false,
}) {
  const dialogRef = useRef(null);
  const focusTraKhiDongRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Mở: đưa focus vào TRONG hộp thoại (phần tử bấm được đầu tiên, hoặc chính
  // khung hộp thoại nếu rỗng — vd MindMapModal `fullBleed` với canvas ReactFlow
  // không có phần tử focus được nào ở lần render đầu). Đóng: trả focus về ĐÚNG
  // phần tử đã mở nó. Thiếu cặp này, người dùng bàn phím/đọc màn hình mất dấu
  // hoàn toàn — Tab tiếp tục rơi vào trang phía sau, và lúc đóng focus rơi về
  // đầu <body> thay vì về lại nút "Mở" vừa bấm.
  useEffect(() => {
    if (!open) return;
    focusTraKhiDongRef.current = document.activeElement;
    const node = dialogRef.current;
    const first = node?.querySelector(FOCUSABLE);
    (first || node)?.focus();
    return () => {
      const prev = focusTraKhiDongRef.current;
      if (prev && typeof prev.focus === "function" && document.contains(prev)) prev.focus();
    };
  }, [open]);

  // Bẫy Tab/Shift+Tab bên trong hộp thoại — không có nó, Tab từ nút cuối cùng
  // rơi thẳng ra trang phía sau lớp phủ, một hộp thoại "modal" chỉ modal về
  // mặt hình ảnh, không modal với bàn phím.
  const bayTab = (e) => {
    if (e.key !== "Tab") return;
    const node = dialogRef.current;
    if (!node) return;
    const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const dau = items[0], cuoi = items[items.length - 1];
    if (e.shiftKey && document.activeElement === dau) { e.preventDefault(); cuoi.focus(); }
    else if (!e.shiftKey && document.activeElement === cuoi) { e.preventDefault(); dau.focus(); }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-label={title || "Hộp thoại"}>
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={bayTab}
        className="relative flex flex-col w-full max-h-[90vh] rounded-control border overflow-hidden animate-fadeIn"
        style={{ maxWidth, background: "var(--bg-card)", borderColor: "var(--border-strong)", outline: "none" }}
      >
        {(title || onClose) && (
          <div className="flex items-center gap-3 px-5 py-3.5 border-b flex-shrink-0" style={{ borderColor: "var(--border-color)" }}>
            <div className="flex-1 min-w-0">
              {title && <h2 className="font-display text-[16px] font-semibold text-text-primary truncate">{title}</h2>}
              {subtitle && <p className="text-[12px] text-text-muted truncate mt-0.5">{subtitle}</p>}
            </div>
            {onClose && (
              <button onClick={onClose} className="icon-btn w-8 h-8 flex-shrink-0" aria-label="Đóng hộp thoại">
                <Icon name="X" size={16} />
              </button>
            )}
          </div>
        )}
        <div className={fullBleed ? "flex-1 min-h-0" : "flex-1 min-h-0 overflow-auto"}>{children}</div>
        {footer && (
          <div className="flex-shrink-0 border-t px-5 py-3" style={{ borderColor: "var(--border-color)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
