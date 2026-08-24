// Kích thước và trạng thái đóng/mở của hai cột bên. Phần thuần tính toán tách
// khỏi hook để test được mà không cần dựng React.
//
// Trước đây hai cột đứng cứng ở 252px và 326px từ breakpoint md trở lên: trên
// laptop 1280px khung đọc chỉ còn 702px và không có cách nào nới ra.

export const PANELS = {
  left:  { key: "left",  min: 200, max: 420, initial: 252, label: "Thư mục nguồn" },
  right: { key: "right", min: 260, max: 520, initial: 326, label: "Lề bằng chứng" },
};

// Dưới mốc này là chế độ ngăn kéo phủ lên nội dung (giữ nguyên hành vi cũ).
export const DRAWER_MAX = 768;
// Dưới mốc này, mở sẵn cả hai cột sẽ bóp khung đọc — mặc định thu về gáy sách.
export const COMFORT_MIN = 1280;

export function clampWidth(panelKey, width) {
  const spec = PANELS[panelKey];
  if (!spec) return width;
  const n = Number(width);
  if (!Number.isFinite(n)) return spec.initial;
  return Math.min(spec.max, Math.max(spec.min, Math.round(n)));
}

/** Kéo mép trái của cột phải sang trái làm nó RỘNG ra — nên dấu bị đảo. */
export function widthFromDrag(panelKey, startWidth, deltaX) {
  const signed = panelKey === "right" ? -deltaX : deltaX;
  return clampWidth(panelKey, startWidth + signed);
}

export function isDrawerMode(viewportWidth) {
  return Number(viewportWidth) < DRAWER_MAX;
}

/**
 * Trạng thái mặc định khi chưa có gì lưu. Màn hẹp thì thu cả hai về gáy: mở sẵn
 * ba cột trên 1024px để lại chưa tới 450px cho khung đọc, tệ hơn là không mở.
 */
export function defaultCollapsed(viewportWidth) {
  const w = Number(viewportWidth) || 0;
  if (w >= COMFORT_MIN) return { left: false, right: false };
  return { left: true, right: true };
}

const STORAGE_KEY = "memvidx.panels.v1";

/** Đọc trạng thái đã lưu. Hỏng, thiếu, hay bị chặn đều trả null để dùng mặc định. */
export function readStored(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      width: {
        left: clampWidth("left", parsed.width?.left ?? PANELS.left.initial),
        right: clampWidth("right", parsed.width?.right ?? PANELS.right.initial),
      },
      collapsed: {
        left: Boolean(parsed.collapsed?.left),
        right: Boolean(parsed.collapsed?.right),
      },
    };
  } catch {
    return null;   // localStorage bị chặn (cửa sổ riêng tư) — không phải lỗi
  }
}

export function writeStored(storage, state) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* hết chỗ hoặc bị chặn — bố cục vẫn chạy, chỉ là không nhớ qua lần sau */
  }
}
