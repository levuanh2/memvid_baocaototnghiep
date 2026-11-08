// V4.1 W1-2 (owner decisions): header menu is "Công cụ học"; every upload
// entry point says "Tải tài liệu lên". Older wording must not come back.
import { describe, expect, it } from "vitest";

const sources = import.meta.glob(["../**/*.{js,jsx}", "!../**/*.test.*", "!../dev/**"], {
  query: "?raw", import: "default", eager: true,
});

describe("tools and upload labels", () => {
  it("source has no retired labels", () => {
    const retired = ["Mở công cụ StudyMap", '"Thêm tài liệu"', 'nhan: "Tải tài liệu",', 'hanhDong: "Tải tài liệu",', "/> Tải tài liệu</>", "<span>StudyMap</span>"];
    const hits = Object.entries(sources).flatMap(([file, text]) =>
      retired.filter((old) => text.includes(old)).map((old) => `${file}: ${old}`));
    expect(hits).toEqual([]);
  });
});
