import { useId, useState } from "react";
import { Icon } from "./Icon";

/**
 * Khối gập trong cột bên.
 *
 * Dùng nút + vùng nội dung tự quản thay vì `<details>`: cần khoá mở/đóng nhớ
 * được và cần phần đầu khối vẫn dính khi cuộn — `<summary>` không làm được cả
 * hai mà không phải chống lại kiểu hiển thị mặc định của trình duyệt.
 */
export default function Disclosure({ title, count, defaultOpen = true, children, dense = false, onToggle }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <section className="disclosure">
      <h3 className="disclosure__head">
        <button
          type="button"
          className="disclosure__toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => {
            const next = !v;
            onToggle?.(next);
            return next;
          })}
        >
          <Icon
            name="ArrowRight"
            size={12}
            className={`disclosure__caret${open ? " disclosure__caret--open" : ""}`}
          />
          <span className="disclosure__title">{title}</span>
          {count != null && <span className="disclosure__count">{count}</span>}
        </button>
      </h3>
      {open && (
        <div id={id} className={`disclosure__body${dense ? " disclosure__body--dense" : ""}`}>
          {children}
        </div>
      )}
    </section>
  );
}
