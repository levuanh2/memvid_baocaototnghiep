// Registry tường minh thay `import * as Lucide` — wildcard + lookup động chặn
// tree-shaking, kéo TOÀN BỘ lucide-react (~600 icon) vào bundle chính. Mọi tên
// icon trong app đều là string literal trong source (không có tên từ BE), nên
// registry liệt kê đủ. Thêm icon mới → thêm import + 1 dòng vào ICONS
// (tên lạ → warn DEV + render null, y hệt hành vi cũ với typo).
import {
  AlertCircle, AlignJustify, Archive, ArchiveRestore, ArrowLeft, ArrowRight, BadgeCheck, Ban, BookOpen,
  Check, ChevronDown, ChevronUp, CircleDashed, Clock, Download, Eraser, EyeOff, Filter,
  Expand, FileStack, FileText, FolderOpen, HelpCircle, Image, ImagePlus, Info, KeyRound, Keyboard, Library, LogOut, Maximize, Menu,
  MessageCircleQuestion, MessageSquare, MessageSquareText, MessagesSquare, Moon,
  MoreVertical, MousePointerClick, Network, PanelRight, Pencil, Plus, Quote, RotateCcw, Rows3, Scan, ScrollText,
  Search, Send, Spline, Square, Sun, Target, Trash2, TrendingDown, TriangleAlert, Unlink, Upload, UserRound, X,
  Sparkles, Star, Tag, Pin, Zap, ZoomIn, ZoomOut,
} from "lucide-react";

const ICONS = {
  AlertCircle, AlignJustify, Archive, ArchiveRestore, ArrowLeft, ArrowRight, BadgeCheck, Ban, BookOpen,
  Check, ChevronDown, ChevronUp, CircleDashed, Clock, Download, Eraser, EyeOff, Filter,
  Expand, FileStack, FileText, FolderOpen, HelpCircle, Image, ImagePlus, Info, KeyRound, Keyboard, Library, LogOut, Maximize, Menu,
  MessageCircleQuestion, MessageSquare, MessageSquareText, MessagesSquare, Moon,
  MoreVertical, MousePointerClick, Network, PanelRight, Pencil, Plus, Quote, RotateCcw, Rows3, Scan, ScrollText,
  Search, Send, Spline, Square, Sun, Target, Trash2, TrendingDown, TriangleAlert, Unlink, Upload, UserRound, X,
  Sparkles, Star, Tag, Pin, Zap, ZoomIn, ZoomOut,
};

/**
 * Thin wrapper over lucide-react so every icon shares one stroke weight and
 * default size — replaces the emoji-as-icon grab-bag (🧠📂📝🔊…) with a
 * consistent line set. Usage: <Icon name="Search" size={16} />
 */
export function Icon({ name, size = 16, strokeWidth = 1.75, className = "", ...rest }) {
  const Cmp = ICONS[name];
  if (!Cmp) {
    if (import.meta.env?.DEV) console.warn(`[Icon] unknown icon: ${name}`);
    return null;
  }
  return <Cmp size={size} strokeWidth={strokeWidth} className={className} aria-hidden {...rest} />;
}

export default Icon;
