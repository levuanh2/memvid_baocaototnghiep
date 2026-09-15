import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "./relativeTime";

describe("formatRelativeTime", () => {
  it("under 10s reads as vừa xong", () => {
    expect(formatRelativeTime(1000, 6000)).toBe("vừa xong");
  });
  it("seconds band", () => {
    expect(formatRelativeTime(0, 45000)).toBe("45 giây trước");
  });
  it("minutes band", () => {
    expect(formatRelativeTime(0, 5 * 60000)).toBe("5 phút trước");
  });
  it("hours band", () => {
    expect(formatRelativeTime(0, 3 * 3600000)).toBe("3 giờ trước");
  });
  it("never returns negative for a clock that moved backward", () => {
    expect(formatRelativeTime(5000, 1000)).toBe("vừa xong");
  });
});
