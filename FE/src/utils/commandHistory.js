// Lịch sử Command Palette — 10 tìm kiếm gần nhất, 10 lệnh gần nhất. THUẦN,
// localStorage CHỈ đọc/ghi ở nơi gọi truyền `storage` vào (test không cần DOM).
// Cùng khuôn với `hooks/panelLayout.js`: đọc lúc khởi tạo, ghi khi đổi, hỏng
// (đầy/bị chặn ở cửa sổ riêng tư) thì coi như rỗng — không ném lỗi làm vỡ UI.
const KHOA = "memvidx.palette.history.v1";
const TRAN = 10;

export const TRANG_THAI_RONG = { timKiem: [], lenh: [] };

export function docLichSu(storage) {
  try {
    const raw = storage?.getItem(KHOA);
    if (!raw) return TRANG_THAI_RONG;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return TRANG_THAI_RONG;
    return {
      timKiem: Array.isArray(parsed.timKiem) ? parsed.timKiem.filter((x) => typeof x === "string").slice(0, TRAN) : [],
      lenh: Array.isArray(parsed.lenh) ? parsed.lenh.filter((x) => x && typeof x.id === "string").slice(0, TRAN) : [],
    };
  } catch {
    return TRANG_THAI_RONG;
  }
}

export function ghiLichSu(storage, state) {
  try {
    storage?.setItem(KHOA, JSON.stringify(state));
  } catch {
    /* đầy hoặc bị chặn — lịch sử không nhớ được qua lần sau, UI vẫn chạy */
  }
}

/** Đẩy một chuỗi tìm kiếm lên đầu, gộp trùng, cắt còn TRAN. Chuỗi rỗng là no-op
 * (không đáng nhớ "đã tìm rỗng"). */
export function themTimKiem(state, query) {
  const q = String(query || "").trim();
  if (!q) return state;
  return { ...state, timKiem: [q, ...state.timKiem.filter((x) => x !== q)].slice(0, TRAN) };
}

/** Đẩy một lệnh lên đầu theo `id` (gộp trùng theo id, không theo nhãn — đổi
 * nhãn hiển thị của cùng một lệnh không nên tạo thêm một dòng lịch sử). */
export function themLenh(state, id, label) {
  if (!id) return state;
  const muc = { id, label: label || id, luc: Date.now() };
  return { ...state, lenh: [muc, ...state.lenh.filter((x) => x.id !== id)].slice(0, TRAN) };
}
