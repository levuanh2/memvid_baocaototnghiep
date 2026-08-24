import { describe, it, expect } from "vitest";
import {
  PANELS, clampWidth, widthFromDrag, isDrawerMode, defaultCollapsed,
  readStored, writeStored, DRAWER_MAX, COMFORT_MIN,
} from "./panelLayout";

/** localStorage giả, có thể bắt ném lỗi như cửa sổ riêng tư. */
function fakeStorage({ throws = false } = {}) {
  const map = new Map();
  return {
    getItem: (k) => { if (throws) throw new Error("bi chan"); return map.get(k) ?? null; },
    setItem: (k, v) => { if (throws) throw new Error("het cho"); map.set(k, v); },
    _map: map,
  };
}

describe("clampWidth", () => {
  it("kẹp trong khoảng của từng cột", () => {
    expect(clampWidth("left", 50)).toBe(PANELS.left.min);
    expect(clampWidth("left", 9999)).toBe(PANELS.left.max);
    expect(clampWidth("right", 300)).toBe(300);
  });

  it("giá trị vô nghĩa rơi về mặc định, không NaN", () => {
    expect(clampWidth("left", NaN)).toBe(PANELS.left.initial);
    expect(clampWidth("left", "rác")).toBe(PANELS.left.initial);
    expect(clampWidth("left", undefined)).toBe(PANELS.left.initial);
  });

  it("làm tròn về số nguyên pixel", () => {
    expect(clampWidth("left", 260.6)).toBe(261);
  });

  it("cột lạ thì trả nguyên giá trị", () => {
    expect(clampWidth("giua", 123)).toBe(123);
  });
});

describe("widthFromDrag", () => {
  it("kéo sang phải làm cột trái rộng ra", () => {
    expect(widthFromDrag("left", 252, 40)).toBe(292);
    expect(widthFromDrag("left", 252, -40)).toBe(212);
  });

  it("cột phải đảo dấu — kéo sang trái mới làm nó rộng ra", () => {
    expect(widthFromDrag("right", 326, -40)).toBe(366);
    expect(widthFromDrag("right", 326, 40)).toBe(286);
  });

  it("kéo quá tay vẫn bị kẹp", () => {
    expect(widthFromDrag("left", 252, 5000)).toBe(PANELS.left.max);
    expect(widthFromDrag("right", 326, 5000)).toBe(PANELS.right.min);
  });
});

describe("isDrawerMode", () => {
  it("dưới 768px là ngăn kéo", () => {
    expect(isDrawerMode(375)).toBe(true);
    expect(isDrawerMode(DRAWER_MAX - 1)).toBe(true);
    expect(isDrawerMode(DRAWER_MAX)).toBe(false);
    expect(isDrawerMode(1440)).toBe(false);
  });
});

describe("defaultCollapsed", () => {
  it("màn rộng mở sẵn cả hai cột", () => {
    expect(defaultCollapsed(COMFORT_MIN)).toEqual({ left: false, right: false });
    expect(defaultCollapsed(1920)).toEqual({ left: false, right: false });
  });

  it("màn hẹp thu cả hai về gáy — mở sẵn thì khung đọc không còn chỗ", () => {
    expect(defaultCollapsed(1024)).toEqual({ left: true, right: true });
    expect(defaultCollapsed(COMFORT_MIN - 1)).toEqual({ left: true, right: true });
  });

  it("không biết bề rộng thì thu gọn, an toàn hơn là bóp", () => {
    expect(defaultCollapsed(undefined)).toEqual({ left: true, right: true });
  });
});

describe("lưu và đọc lại", () => {
  it("đi một vòng giữ nguyên giá trị", () => {
    const st = fakeStorage();
    const state = { width: { left: 300, right: 400 }, collapsed: { left: true, right: false } };
    writeStored(st, state);
    expect(readStored(st)).toEqual(state);
  });

  it("bề rộng đã lưu vẫn bị kẹp — file cũ hoặc người dùng sửa tay", () => {
    const st = fakeStorage();
    st.setItem("memvidx.panels.v1", JSON.stringify({ width: { left: 9999, right: 10 } }));
    const out = readStored(st);
    expect(out.width.left).toBe(PANELS.left.max);
    expect(out.width.right).toBe(PANELS.right.min);
  });

  it("chưa có gì lưu thì trả null để dùng mặc định", () => {
    expect(readStored(fakeStorage())).toBeNull();
  });

  it("JSON hỏng trả null chứ không nổ", () => {
    const st = fakeStorage();
    st.setItem("memvidx.panels.v1", "{khong-phai-json");
    expect(readStored(st)).toBeNull();
  });

  it("storage bị chặn thì đọc trả null và ghi im lặng", () => {
    const st = fakeStorage({ throws: true });
    expect(readStored(st)).toBeNull();
    expect(() => writeStored(st, { width: {}, collapsed: {} })).not.toThrow();
  });

  it("không có storage cũng không nổ", () => {
    expect(readStored(null)).toBeNull();
    expect(() => writeStored(null, {})).not.toThrow();
  });
});
