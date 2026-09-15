// Feature Pack C (Keyboard-first Research Workspace) — single registry for
// every keyboard shortcut in the app, existing AND new, so ShortcutsOverlay.jsx
// (the discoverability surface) and the dispatchers below read from ONE list
// that cannot drift out of sync with itself. THUẦN like paletteKeyboard.js /
// mindmapViewport.js / chatFocus.js: no DOM, no React — callers supply the
// facts (event, activeElement) and get back an intent string, never act
// directly, so this stays testable under vitest's default `node` env.
//
// Ownership — every combination below has exactly ONE owner:
//   Ctrl/Cmd+K   → CommandPalette.jsx      (pre-existing, documented not rebound)
//   Ctrl/Cmd+/   → MainLayout.jsx          (pre-existing, documented not rebound)
//   "/"          → ChatArea.jsx            (pre-existing, documented not rebound)
//   Escape       → Modal.jsx / MainLayout.jsx (pre-existing, documented not rebound)
//   +/-/0/F      → mindmapViewport.js      (pre-existing, documented not rebound)
//   "?"          → MainLayout.jsx (NEW, this file's `globalShortcutAction`)
//   Alt+C/M/S/T  → MainLayout.jsx (NEW)
//   Alt+[ / Alt+]→ MainLayout.jsx (NEW)
//   c/u/d/[/]    → MainLayout.jsx (NEW, MindMap-tab-only, see `mindmapRelationAction`)
import { isInteractiveTarget } from "./chatFocus";

export const SHORTCUT_REGISTRY = [
  { id: "palette", keys: "Ctrl / Cmd + K", label: "Mở tìm kiếm (Command Palette)", category: "Toàn cục", isNew: false },
  { id: "tutor", keys: "Ctrl / Cmd + /", label: "Mở Gia sư AI", category: "Toàn cục", isNew: false },
  { id: "slash-compose", keys: "/", label: "Focus ô nhập chat", category: "Toàn cục", isNew: false },
  { id: "escape", keys: "Esc", label: "Đóng overlay/hộp thoại đang mở", category: "Toàn cục", isNew: false },
  { id: "help", keys: "?", label: "Xem toàn bộ phím tắt (bảng này)", category: "Toàn cục", isNew: true },
  { id: "nav-chat", keys: "Alt + C", label: "Chuyển sang Trò chuyện", category: "Điều hướng Workspace", isNew: true },
  { id: "nav-mindmap", keys: "Alt + M", label: "Chuyển sang Sơ đồ tư duy", category: "Điều hướng Workspace", isNew: true },
  { id: "nav-studymap", keys: "Alt + S", label: "Sang Bản đồ học tập (StudyMap)", category: "Điều hướng Workspace", isNew: true },
  { id: "nav-timeline", keys: "Alt + T", label: "Mở Dòng thời gian nghiên cứu", category: "Điều hướng Workspace", isNew: true },
  { id: "history-back", keys: "Alt + [", label: "Lùi về mục nghiên cứu trước", category: "Điều hướng Workspace", isNew: true },
  { id: "history-forward", keys: "Alt + ]", label: "Tới mục nghiên cứu tiếp theo", category: "Điều hướng Workspace", isNew: true },
  { id: "mm-center", keys: "C", label: "Căn giữa nhánh đang chọn", category: "Sơ đồ tư duy (khi tab này đang mở)", isNew: true },
  { id: "mm-parent", keys: "U", label: "Nhảy tới nhánh cha", category: "Sơ đồ tư duy (khi tab này đang mở)", isNew: true },
  { id: "mm-child", keys: "D", label: "Nhảy tới nhánh con đầu tiên", category: "Sơ đồ tư duy (khi tab này đang mở)", isNew: true },
  { id: "mm-prev-sibling", keys: "[", label: "Nhánh cùng cấp trước đó", category: "Sơ đồ tư duy (khi tab này đang mở)", isNew: true },
  { id: "mm-next-sibling", keys: "]", label: "Nhánh cùng cấp tiếp theo", category: "Sơ đồ tư duy (khi tab này đang mở)", isNew: true },
  { id: "cp-move", keys: "↑ ↓ · Tab", label: "Di chuyển giữa kết quả", category: "Command Palette", isNew: false },
  { id: "cp-open", keys: "Enter", label: "Mở mục đang chọn", category: "Command Palette", isNew: false },
  { id: "mm-zoom", keys: "+ · - · 0 · F", label: "Phóng to · thu nhỏ · về 100% · vừa khung", category: "Sơ đồ tư duy & StudyMap", isNew: false },
];

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Accessibility (mục 6) — không bao giờ "cướp" phím đang gõ ở đâu đó. */
function isTypingTarget(activeElement) {
  if (!activeElement) return false;
  if (activeElement.isContentEditable) return true;
  return EDITABLE_TAGS.has(String(activeElement.tagName || "").toUpperCase());
}

/**
 * Toàn cục — mục 3 (Workspace shortcuts) + "?" của mục 7 (Discoverability).
 *
 * Alt+Left/Right KHÔNG được dùng cho Back/Forward: đó là phím tắt back/forward
 * mà Chrome/Firefox trên Windows tự giữ ở tầng trình duyệt, JS trang không chặn
 * được đáng tin cậy — đúng trường hợp "IMPORTANT" của epic yêu cầu chọn phương
 * án an toàn thay thế. Alt+[ / Alt+] giữ đúng ý nghĩa (lùi/tới) mà không đụng
 * phím trình duyệt đã giữ.
 */
export function globalShortcutAction(event, { activeElement } = {}) {
  if (!event || isTypingTarget(activeElement)) return null;
  if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey) return "help";
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  switch (event.key) {
    case "c": case "C": return "nav-chat";
    case "m": case "M": return "nav-mindmap";
    case "s": case "S": return "nav-studymap";
    case "t": case "T": return "nav-timeline";
    case "[": return "history-back";
    case "]": return "history-forward";
    default: return null;
  }
}

/**
 * Sơ đồ tư duy — mục 4 + 5. Caller CHỈ được gọi hàm này khi
 * `workspaceMode === "mindmap"` VÀ activeElement không nằm trong `.me-container`
 * (canvas mind-elixir tự bắt ArrowUp/Down/Left/Right/Enter/Tab/Delete/Backspace
 * của riêng nó — xem MindElixirView.jsx dùng `editable: true`; container đó gọi
 * `preventDefault()` không điều kiện cho MỌI phím khi đang focus, nên một bộ
 * phím tắt thứ hai đè lên đúng những phím đó sẽ double-dispatch hoặc đụng độ
 * với thao tác sửa node thật đang có sẵn). Vì vậy tập phím ở đây CỐ Ý không
 * trùng bất kỳ phím nào mind-elixir đã dùng.
 *
 * Guard RỘNG HƠN `isTypingTarget`: phím trần (bare letter) không chỉ phải
 * tránh ô nhập, còn phải tránh MỌI điều khiển tương tác đang giữ focus bàn
 * phím (nút, link, [role="button"]/[role="menuitem"], ...) — một pill "Nhánh
 * cha" trong Knowledge Inspector đang được Tab tới mà gõ "d" lại nhảy node
 * khác là cướp phím ngay trên chính điều khiển người dùng đang thao tác.
 * `isInteractiveTarget` (chatFocus.js) đã liệt kê đúng tập đó.
 */
export function mindmapRelationAction(event, { activeElement } = {}) {
  if (!event || isInteractiveTarget(activeElement)) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case "c": case "C": return "center";
    case "u": case "U": return "parent";
    case "d": case "D": return "child";
    case "[": return "prev-sibling";
    case "]": return "next-sibling";
    default: return null;
  }
}
