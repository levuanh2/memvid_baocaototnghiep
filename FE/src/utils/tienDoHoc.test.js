import { describe, expect, it } from "vitest";
import { baiLam, locKhaiNiem, moTaKhaiNiem, nhomTheoTaiLieu, tomTatTienDo } from "./tienDoHoc";

const c = (name, status, first, now, extra = {}) => ({
  concept_name: name, status, first_mastery_score: first, mastery_score: now,
  attempt_count: 2, document_id: "d1", last_attempt_id: "a1", ...extra,
});

describe("tomTatTienDo", () => {
  it("states counts, the weakest concept and the server average; never invents a number", () => {
    const concepts = [c("Cung cầu", "critical_gap", 0.2, 0.3), c("Độ co giãn", "mastered", 0.5, 0.9)];
    expect(tomTatTienDo({ average_percentage: 71.6, attempt_count_by_status: { in_progress: 2 } }, concepts))
      .toBe("Đã nắm tốt 1 trên 2 khái niệm. 1 khái niệm cần ôn, yếu nhất là “Cung cầu”. Trung bình 72% điểm trên các bài đã chấm xong. 2 bài đang làm dở.");
  });

  it("no average from the server: the sentence leaves it out instead of printing 0%", () => {
    const text = tomTatTienDo({ average_percentage: null }, [c("A", "mastered", 1, 1)]);
    expect(text).toBe("Đã nắm tốt 1 trên 1 khái niệm.");
    expect(text).not.toMatch(/0%/);
  });

  it("no concept yet: null (the page shows its empty state)", () => {
    expect(tomTatTienDo({ average_percentage: 80 }, [])).toBeNull();
  });
});

describe("moTaKhaiNiem", () => {
  it("shows first and latest mastery with the direction in words", () => {
    expect(moTaKhaiNiem(c("A", "review_needed", 0.4, 0.65))).toBe("Lần đầu 40% → nay 65% (tăng 25), 2 lần làm bài");
    expect(moTaKhaiNiem(c("A", "critical_gap", 0.6, 0.3, { attempt_count: 3 }))).toBe("Lần đầu 60% → nay 30% (giảm 30), 3 lần làm bài");
  });

  it("one attempt has no 'first vs now'", () => {
    expect(moTaKhaiNiem(c("A", "review_needed", 0.5, 0.5, { attempt_count: 1 }))).toBe("Mức nắm 50% sau 1 lần làm bài");
  });
});

describe("nhomTheoTaiLieu / locKhaiNiem", () => {
  it("groups by document with the library title; a removed document is named, not linked", () => {
    const groups = nhomTheoTaiLieu(
      [c("A", "critical_gap", 0, 0), c("B", "mastered", 1, 1, { document_id: "gone" }), c("C", "light_review", 0, 0.7)],
      [{ document_id: "d1", display_name: "Kinh tế vi mô" }],
    );
    expect(groups.map((g) => [g.documentId, g.ten, g.khaiNiem.map((x) => x.concept_name)])).toEqual([
      ["d1", "Kinh tế vi mô", ["A", "C"]],
      [null, "Tài liệu không còn trong thư viện", ["B"]],
    ]);
  });

  it("filters weak / mastered / all", () => {
    const all = [c("A", "critical_gap", 0, 0), c("B", "mastered", 1, 1)];
    expect(locKhaiNiem(all, "can-on").map((x) => x.concept_name)).toEqual(["A"]);
    expect(locKhaiNiem(all, "da-nam").map((x) => x.concept_name)).toEqual(["B"]);
    expect(locKhaiNiem(all, "tat-ca")).toHaveLength(2);
  });
});

describe("baiLam", () => {
  const a = (extra) => ({ attempt_id: "at1", quiz_id: "q1", quiz_type: "diagnostic", status: "graded", score: 3, max_score: 4, percentage: 75, ungraded_count: 0, ...extra });

  it("graded diagnostic: percent of points and raw score, links to its result", () => {
    expect(baiLam(a())).toMatchObject({ loai: "Kiểm tra", ketQua: "75% điểm · 3 / 4", den: "/app/study/result/at1", nhanDen: "Xem bài", tamTinh: false });
  });

  it("provisional (ungraded answers) says so", () => {
    expect(baiLam(a({ ungraded_count: 1 }))).toMatchObject({ ketQua: "Tạm tính 75% điểm · 3 / 4", tamTinh: true });
    expect(baiLam(a({ ungraded_count: 2, max_score: 0, score: 0, percentage: null })).ketQua).toBe("Chưa chấm được");
  });

  it("in progress diagnostic continues the quiz; practice opens the practice page", () => {
    expect(baiLam(a({ status: "in_progress", score: null }))).toMatchObject({ ketQua: "Đang làm dở", den: "/app/study/quiz/q1", nhanDen: "Làm tiếp" });
    expect(baiLam(a({ quiz_type: "practice" }))).toMatchObject({ loai: "Luyện tập", den: "/app/study/practice/q1" });
    expect(baiLam(a({ status: "submitted" })).ketQua).toBe("Đang chấm");
  });
});
