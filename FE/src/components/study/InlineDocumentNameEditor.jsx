import { useEffect, useRef, useState } from "react";
import { kiemTraTen } from "../../utils/doiTen";

/** Shared inline rename contract: Enter saves, Escape/outside cancels. */
export default function InlineDocumentNameEditor({
  initialValue, saving = false, onSave, onCancel, className = "min-w-0 flex-1",
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const outside = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) onCancel?.();
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [onCancel]);

  const submit = () => {
    const result = kiemTraTen(value, initialValue);
    if (result.khongDoi) return onCancel?.();
    if (!result.hopLe) return setError(result.loi);
    onSave?.(result.giaTri);
  };

  return (
    <div ref={boxRef} className={className}>
      <input ref={inputRef} value={value} disabled={saving}
        aria-label="Tên hiển thị của tài liệu"
        onChange={(event) => { setValue(event.target.value); setError(null); }}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); submit(); }
          if (event.key === "Escape") { event.preventDefault(); onCancel?.(); }
        }}
        className="w-full rounded-control px-2 py-1 text-body-lg font-semibold outline-none"
        style={{ background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--accent)" }} />
      <p className="mt-1 text-caption text-text-muted">
        {error
          ? <span style={{ color: "var(--err)" }} role="alert">{error}</span>
          : "Enter để lưu · Esc để huỷ · để trống để dùng lại tên tệp"}
      </p>
    </div>
  );
}
