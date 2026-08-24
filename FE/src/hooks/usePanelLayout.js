import { useCallback, useEffect, useRef, useState } from "react";
import {
  PANELS, clampWidth, widthFromDrag, isDrawerMode, defaultCollapsed,
  readStored, writeStored,
} from "./panelLayout";

// Không có window (test, render phía máy chủ) thì coi như màn rộng — mở sẵn cả
// hai cột là mặc định đúng cho màn hình để bàn.
const NO_WINDOW_WIDTH = 1440;
const viewport = () => (typeof window === "undefined" ? NO_WINDOW_WIDTH : window.innerWidth);

/**
 * Bề rộng + trạng thái đóng/mở của hai cột bên, nhớ qua các phiên.
 *
 * Kéo được xử lý bằng listener trên `window` chứ không phải trên tay cầm: con
 * trỏ chạy nhanh hơn re-render nên nó sẽ rời khỏi tay cầm giữa chừng và chuột
 * "tuột" khỏi thanh kéo.
 */
export function usePanelLayout() {
  // Đọc trạng thái đã lưu NGAY trong initializer, không phải trong useEffect.
  //
  // Bản trước nạp bằng effect và tự xoá dữ liệu của chính nó: StrictMode gọi
  // effect hai lần, effect ghi chạy ngay sau effect đọc nên nó ghi đè bằng giá
  // trị mặc định trước khi setState kịp có hiệu lực, rồi lượt đọc thứ hai đọc
  // lại đúng cái mặc định vừa ghi. Đây là SPA thuần Vite, không có render phía
  // máy chủ, nên chạm localStorage lúc khởi tạo là an toàn.
  const stored = useRef(undefined);
  if (stored.current === undefined) {
    stored.current = readStored(typeof window === "undefined" ? null : window.localStorage);
  }

  const [drawer, setDrawer] = useState(() => isDrawerMode(viewport()));
  const [width, setWidth] = useState(() => stored.current?.width ?? {
    left: PANELS.left.initial,
    right: PANELS.right.initial,
  });
  const [collapsed, setCollapsed] = useState(
    () => stored.current?.collapsed ?? defaultCollapsed(viewport())
  );
  const [dragging, setDragging] = useState(null);
  const firstWrite = useRef(true);

  useEffect(() => {
    // Bỏ qua lượt ghi lúc gắn: nó chỉ chép lại đúng thứ vừa đọc.
    if (firstWrite.current) {
      firstWrite.current = false;
      return;
    }
    writeStored(typeof window === "undefined" ? null : window.localStorage, { width, collapsed });
  }, [width, collapsed]);

  useEffect(() => {
    const onResize = () => setDrawer(isDrawerMode(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toggle = useCallback((key) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setCollapsedFor = useCallback((key, value) => {
    setCollapsed((prev) => ({ ...prev, [key]: Boolean(value) }));
  }, []);

  const resetWidth = useCallback((key) => {
    setWidth((prev) => ({ ...prev, [key]: PANELS[key].initial }));
  }, []);

  const nudgeWidth = useCallback((key, deltaPx) => {
    setWidth((prev) => ({ ...prev, [key]: clampWidth(key, prev[key] + deltaPx) }));
  }, []);

  const startDrag = useCallback((key, event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width[key];
    setDragging(key);

    const onMove = (e) => {
      setWidth((prev) => ({ ...prev, [key]: widthFromDrag(key, startWidth, e.clientX - startX) }));
    };
    const onUp = () => {
      setDragging(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // Giữ con trỏ dạng kéo và chặn bôi đen chữ suốt thao tác — không có hai dòng
    // này thì kéo qua vùng chat sẽ bôi đen cả đoạn hội thoại.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  return {
    drawer, width, collapsed, dragging,
    toggle, setCollapsedFor, resetWidth, nudgeWidth, startDrag,
  };
}
