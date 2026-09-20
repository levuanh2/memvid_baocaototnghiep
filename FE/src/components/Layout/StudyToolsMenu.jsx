import { useEffect, useRef } from "react";
import { Icon } from "../ui/Icon";

const TOOLS = [
  { key: "tutor", label: "Gia sư AI", detail: "Hỏi và luyện tập", icon: "Sparkles" },
  { key: "timeline", label: "Dòng thời gian", detail: "Xem sự kiện theo thứ tự", icon: "Clock" },
  { key: "insights", label: "Kiến thức", detail: "Khám phá khái niệm liên quan", icon: "Network" },
];

export default function StudyToolsMenu({ open, onClose, onSelect }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
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
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className="study-tools-menu" role="menu" aria-label="Công cụ học">
      <div className="study-tools-menu__head">
        <div>
          <span className="study-tools-menu__eyebrow">StudyMap</span>
          <strong className="study-tools-menu__title">Công cụ học</strong>
        </div>
      </div>
      {TOOLS.map((tool) => (
        <button key={tool.key} type="button" role="menuitem" className="study-tools-menu__item" onClick={() => { onSelect?.(tool.key); onClose?.(); }}>
          <span className="study-tools-menu__item-icon"><Icon name={tool.icon} size={16} /></span>
          <span className="study-tools-menu__item-copy"><strong className="study-tools-menu__item-title">{tool.label}</strong><small className="study-tools-menu__item-meta">{tool.detail}</small></span>
          <Icon name="ChevronRight" size={14} className="study-tools-menu__arrow" aria-hidden />
        </button>
      ))}
    </div>
  );
}
