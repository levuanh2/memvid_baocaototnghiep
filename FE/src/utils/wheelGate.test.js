// Bản đồ nhúng nuốt con lăn → trang trông "chết cứng".
//
// `react-d3-tree` gắn d3-zoom lên <svg>; d3-zoom nghe `wheel` rồi preventDefault. Canvas
// sơ đồ cao min(70vh, 640px) nên con trỏ gần như luôn nằm trên nó — mọi cú lăn bị lấy
// mất để phóng cây, và trang không bao giờ cuộn dù StudyShell có overflow-y-auto.
import { describe, expect, it } from "vitest";
import { nenChanLan } from "./wheelGate";

describe("nenChanLan", () => {
  it("lăn thường trên bản đồ → CHẶN d3, trả cuộn về cho trang", () => {
    expect(nenChanLan({ ctrlKey: false, metaKey: false })).toBe(true);
  });

  it("Ctrl + lăn → để d3 phóng bản đồ", () => {
    expect(nenChanLan({ ctrlKey: true, metaKey: false })).toBe(false);
  });

  it("Cmd + lăn (macOS) → để d3 phóng", () => {
    expect(nenChanLan({ ctrlKey: false, metaKey: true })).toBe(false);
  });

  it("sự kiện rỗng thì mặc định trả cuộn cho trang, không nổ", () => {
    expect(nenChanLan(null)).toBe(true);
    expect(nenChanLan(undefined)).toBe(true);
    expect(nenChanLan({})).toBe(true);
  });
});
