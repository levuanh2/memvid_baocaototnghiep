import { describe, it, expect } from "vitest";
import {
  PANELS, clampWidth, widthFromDrag, isDrawerMode, defaultCollapsed,
  readStored, writeStored, DRAWER_MAX, COMFORT_MIN, effectiveMax,
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
    expect(clampWidth("right", 350)).toBe(350);
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

  // Spec requirement: right panel default ~360, min 320, max min(480px, 40vw).
  it("cột phải: min 320, max tuyệt đối 480", () => {
    expect(PANELS.right.min).toBe(320);
    expect(PANELS.right.max).toBe(480);
    expect(PANELS.right.initial).toBe(360);
  });

  it("trần cột phải là min(480, 40vw) khi biết bề rộng màn hình", () => {
    expect(effectiveMax("right", 1920)).toBe(480); // 40vw=768 > 480 tuyệt đối -> 480 thắng
    expect(effectiveMax("right", 1000)).toBe(400); // 40vw=400 < 480 -> 40vw thắng
    expect(clampWidth("right", 9999, 1000)).toBe(400);
  });

  it("min luôn thắng khi 40vw hẹp hơn cả sàn 320 (biên 768px, chế độ không-ngăn-kéo)", () => {
    // 40% of 768 = 307.2, dưới sàn 320px -- panel không được hẹp hơn 320
    // dù điều đó có nghĩa là vượt trần vw một chút.
    expect(effectiveMax("right", 768)).toBeLessThan(PANELS.right.min);
    expect(clampWidth("right", 9999, 768)).toBe(PANELS.right.min);
    expect(clampWidth("right", 100, 768)).toBe(PANELS.right.min);
  });

  it("không truyền viewportWidth thì dùng trần tuyệt đối như trước (không phá API cũ)", () => {
    expect(clampWidth("right", 9999)).toBe(PANELS.right.max);
  });
});

describe("widthFromDrag", () => {
  it("kéo sang phải làm cột trái rộng ra", () => {
    expect(widthFromDrag("left", 252, 40)).toBe(292);
    expect(widthFromDrag("left", 252, -40)).toBe(212);
  });

  it("cột phải đảo dấu — kéo sang trái mới làm nó rộng ra", () => {
    expect(widthFromDrag("right", 400, -40)).toBe(440);
    expect(widthFromDrag("right", 400, 40)).toBe(360);
  });

  it("kéo quá tay vẫn bị kẹp", () => {
    expect(widthFromDrag("left", 252, 5000)).toBe(PANELS.left.max);
    expect(widthFromDrag("right", 400, 5000)).toBe(PANELS.right.min);
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

  it("bề rộng lưu từ phiên màn rộng bị kẹp lại NGAY khi đọc trên viewport hẹp hơn", () => {
    // Saved 480px on a wide (1920px) session; reloading at 1000px (40vw=400)
    // must re-clamp to 400 from the very first read, not wait for a resize.
    const st = fakeStorage();
    st.setItem("memvidx.panels.v1", JSON.stringify({ width: { left: 300, right: 480 }, collapsed: { left: false, right: false } }));
    expect(readStored(st, 1000).width.right).toBe(400);
    // Same stored value, wide viewport -> stays at the saved 480 (within the absolute max).
    expect(readStored(st, 1920).width.right).toBe(480);
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
