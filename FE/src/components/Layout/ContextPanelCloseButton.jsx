// Header control of the right context panel. In the MindMap detail overlay (and
// the drawer) it closes the panel; in the persistent rail it collapses it. The
// accessible name must say which, so the close action is announced as a close.
// 40x40 hit target (the glyph stays 16px).
import { Icon } from "../ui/Icon";

export default function ContextPanelCloseButton({ collapsible = true, onClose }) {
  const collapseProps = collapsible
    ? { "aria-expanded": "true", "aria-controls": "context-inspector" }
    : {};
  return (
    <button
      type="button"
      onClick={onClose}
      className="icon-btn w-10 h-10"
      aria-label={collapsible ? "Thu gọn bộ kiểm tra ngữ cảnh" : "Đóng chi tiết nhánh"}
      title={collapsible ? "Thu gọn" : "Đóng"}
      {...collapseProps}
    >
      <Icon name="X" size={16} />
    </button>
  );
}
