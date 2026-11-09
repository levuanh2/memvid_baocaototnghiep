import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Modal from "../ui/Modal";
import { Icon } from "../ui/Icon";
import { learningActionReadiness } from "../../utils/libraryActionMatrix";

const LEARNING_TOOLS = [
  ["summary", "Tóm tắt", "ScrollText"],
  ["mindmap", "Sơ đồ tư duy", "Network"],
  ["studymap", "Bản đồ kiến thức", "GitBranch"],
  ["quiz", "Quiz", "BadgeCheck"],
  ["review", "Ôn tập", "BookOpen"],
  ["chat", "Hỏi AI", "MessageSquare"],
  ["details", "Chi tiết", "Info"],
];

const MANAGEMENT_ACTIONS = [
  ["rename", "Đổi tên", "Pencil"],
  ["favorite", "Yêu thích", "Star"],
  ["pin", "Ghim", "Pin"],
  ["archive", "Lưu trữ", "Archive"],
];

function ToolButtons({ doc, onChoose, onManage, menu = false }) {
  const tools = LEARNING_TOOLS.map(([surface, label, icon]) => ({
    surface, label, icon, ...learningActionReadiness(doc, surface),
  }));
  const hasUnavailableTools = tools.some((tool) => !tool.ready);
  return (
    <>
      <div className="document-tools__group" aria-label="Công cụ học">
        {tools.map(({ surface, label, icon, ready, reason }) => (
          <button key={surface} type="button" role={menu ? "menuitem" : undefined}
            data-learning-tool data-surface={surface} disabled={!ready} title={reason || undefined}
            aria-label={ready ? label : `${label}. ${reason}`} onClick={() => ready && onChoose(surface)}>
            <Icon name={icon} size={15} /> {label}
          </button>
        ))}
        {hasUnavailableTools && (
          <p className="document-tools__readiness-note">Công cụ bị mờ cần lập chỉ mục hoặc một kết quả đã có.</p>
        )}
      </div>
      <div className="document-tools__group document-tools__group--manage" aria-label="Quản lý tài liệu">
        {MANAGEMENT_ACTIONS.map(([action, fallback, icon]) => {
          const labels = {
            favorite: doc.favorite ? "Bỏ yêu thích" : fallback,
            pin: doc.pinned ? "Bỏ ghim" : fallback,
            archive: doc.archived_at ? "Bỏ lưu trữ" : fallback,
          };
          return (
            <button key={action} type="button" role={menu ? "menuitem" : undefined}
              data-management-action data-action={action} onClick={() => onManage(action)}>
              <Icon name={action === "archive" && doc.archived_at ? "ArchiveRestore" : icon} size={15} />
              {labels[action] || fallback}
            </button>
          );
        })}
      </div>
    </>
  );
}

export function DesktopDocumentTools({ open, doc, onChoose, onManage, onClose, triggerRef }) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState({ placement: "below", maxHeight: null });
  useEffect(() => {
    if (open) menuRef.current?.querySelector("button")?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      triggerRef?.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose, triggerRef]);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const menu = menuRef.current;
      const trigger = triggerRef?.current;
      if (!menu || !trigger) return;
      const menuRect = menu.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      const availableBelow = window.innerHeight - triggerRect.bottom - 8;
      const availableAbove = triggerRect.top - 8;
      const placement = menuRect.height > availableBelow && availableAbove > availableBelow ? "above" : "below";
      const maxHeight = Math.max(120, placement === "above" ? availableAbove : availableBelow);
      setPosition((current) => (
        current.placement === placement && current.maxHeight === maxHeight
          ? current
          : { placement, maxHeight }
      ));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, triggerRef]);
  if (!open) return null;
  const closeAndRestore = () => {
    onClose();
    triggerRef?.current?.focus();
  };
  return (
    <>
      <button className="document-tools__dismiss" aria-label="Đóng công cụ tài liệu" onClick={closeAndRestore} />
      <div ref={menuRef} className={`document-tools document-tools--desktop is-${position.placement}`}
        style={position.maxHeight ? { maxHeight: `${position.maxHeight}px` } : undefined} role="menu">
        <ToolButtons doc={doc} menu onChoose={onChoose} onManage={onManage} />
      </div>
    </>
  );
}

export default function DocumentToolsSheet({ open, doc, onChoose, onManage, onClose, triggerRef, fallbackFocusRef }) {
  useEffect(() => {
    if (!open) return undefined;
    const appRoot = document.getElementById("root");
    const rootWasInert = appRoot?.hasAttribute("inert");
    const previousOverflow = document.body.style.overflow;
    if (!rootWasInert) appRoot?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    return () => {
      if (!rootWasInert) appRoot?.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const trigger = triggerRef?.current;
    const fallback = fallbackFocusRef?.current;
    return () => queueMicrotask(() => {
      if (!document.contains(trigger)) fallback?.focus();
    });
  }, [open, triggerRef, fallbackFocusRef]);
  return (
    <Modal open={open} title={`Công cụ · ${doc.title || doc.display_name || "Tài liệu"}`}
      onClose={onClose} maxWidth={520} className="document-tools-sheet">
      <div className="document-tools document-tools--sheet">
        <ToolButtons doc={doc} onChoose={onChoose} onManage={onManage} />
      </div>
    </Modal>
  );
}
