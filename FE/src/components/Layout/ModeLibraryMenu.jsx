import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../ui/Icon";

const ago = (value) => {
  if (!value) return "Chưa rõ thời điểm";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return "Chưa rõ thời điểm";
  if (seconds < 60) return "vừa xong";
  if (seconds < 3600) return Math.floor(seconds / 60) + " phút trước";
  if (seconds < 86400) return Math.floor(seconds / 3600) + " giờ trước";
  return Math.floor(seconds / 86400) + " ngày trước";
};

export default function ModeLibraryMenu({
  mode,
  items = [],
  selectedId,
  onSelect,
  onCreate,
  creating = false,
  selectedSources = [],
  onClose,
}) {
  const ref = useRef(null);
  const [query, setQuery] = useState("");
  const searchable = items.length > 4;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => String(item.title || item.name || "").toLowerCase().includes(q));
  }, [items, query]);
  const isMindmap = mode === "mindmap";
  const title = isMindmap ? "Sơ đồ tư duy" : "Tóm tắt";
  const createLabel = isMindmap ? "Tạo sơ đồ mới" : "Tạo bản tóm tắt";

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target)) onClose?.();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="mode-library-menu" role="dialog" aria-label={title}>
      <div className="mode-library-menu__head">
        <div>
          <span className="mode-library-menu__eyebrow">Thư viện</span>
          <h2>{title}</h2>
        </div>
        <button type="button" className="icon-btn w-9 h-9" onClick={onClose} aria-label="Đóng thư viện">
          <Icon name="X" size={16} />
        </button>
      </div>

      {searchable && (
        <label className="mode-library-menu__search">
          <Icon name="Search" size={14} aria-hidden />
          <span className="sr-only">Tìm {title.toLowerCase()}</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={"Tìm trong " + title.toLowerCase() + "…"} />
        </label>
      )}

      <div className="mode-library-menu__list" role="listbox" aria-label={title}>
        {filtered.length === 0 ? (
          <p className="mode-library-menu__empty">Chưa có {isMindmap ? "sơ đồ" : "bản tóm tắt"} phù hợp.</p>
        ) : filtered.map((item) => {
          const selected = item.id === selectedId;
          const sourceCount = Array.isArray(item.sources) ? item.sources.length : 0;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={selected}
              className={"mode-library-menu__item" + (selected ? " is-selected" : "")}
              onClick={() => { onSelect?.(item); onClose?.(); }}
            >
              <span className="mode-library-menu__item-icon"><Icon name={isMindmap ? "Network" : "ScrollText"} size={15} /></span>
              <span className="mode-library-menu__item-copy">
                <strong title={item.title || title}>{item.title || title}</strong>
                <small>{sourceCount ? sourceCount + " tài liệu" : "Tài liệu nguồn"} · {ago(item.created_at || item.createdAt || item.updated_at)}</small>
              </span>
              {selected && <Icon name="Check" size={16} className="mode-library-menu__check" aria-hidden />}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="mode-library-menu__create"
        onClick={() => { onCreate?.(); onClose?.(); }}
        disabled={creating || selectedSources.length === 0}
        title={selectedSources.length === 0 ? "Chọn ít nhất một tài liệu trước" : createLabel}
      >
        <Icon name="Plus" size={15} />
        <span>{creating ? "Đang tạo…" : createLabel}</span>
        {creating && <span className="mode-library-menu__status">đang xử lý</span>}
      </button>
    </div>
  );
}
