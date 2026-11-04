// V4.1 W5-1: labels state their effect (audit 03 Library P2, Review guide P2).
import { describe, expect, it } from "vitest";
import documentList from "../pages/study/DocumentList.jsx?raw";
import reviewGuide from "../pages/study/ReviewGuide.jsx?raw";

describe("Library and review-guide microcopy", () => {
  it("density toggle has one constant name; demo button says what it opens", () => {
    expect(documentList).toContain('aria-pressed={matDo === "compact"}');
    expect(documentList).toMatch(/\n\s*Xem gọn\n/);
    expect(documentList).not.toMatch(/"Gọn" : "Đủ"/);
    expect(documentList).toContain("/> Mở thử tài liệu");
  });
  it("review guide regenerate button names the plan", () => {
    expect(reviewGuide).toContain("} Tạo lại kế hoạch");
    expect(reviewGuide).not.toMatch(/\/> Viết lại\n/);
  });
});
