import { describe, expect, it } from "vitest";

import { tenFileXuat } from "./studyMapExport";

describe("tenFileXuat — phần THUẦN, tách khỏi lệnh gọi snapdom không test được ở đây", () => {
  it("ghép tiêu đề + ngày, không đuôi file (download() tự thêm) — giữ dấu tiếng Việt, khớp handleExportPng đã có", () => {
    expect(tenFileXuat("Hệ điều hành", { now: new Date("2026-09-09T00:00:00Z") }))
      .toBe("study-map-Hệ điều hành-20260909");
  });

  it("bỏ ký tự Windows cấm trong tên file", () => {
    expect(tenFileXuat('a/b\\c:d*e?f"g<h>i|j', { now: new Date("2026-01-01") }))
      .toBe("study-map-a_b_c_d_e_f_g_h_i_j-20260101");
  });

  it("thiếu tiêu đề rơi về tên chung, không để trống", () => {
    expect(tenFileXuat(null, { now: new Date("2026-01-01") })).toBe("study-map-study-map-20260101");
    expect(tenFileXuat("   ", { now: new Date("2026-01-01") })).toBe("study-map-study-map-20260101");
  });

  it("cắt tên quá dài, không để filename vô hạn", () => {
    const dai = "x".repeat(200);
    const ten = tenFileXuat(dai, { now: new Date("2026-01-01") });
    expect(ten.length).toBeLessThan(90);
  });
});
