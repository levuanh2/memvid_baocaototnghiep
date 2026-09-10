import { describe, expect, it } from "vitest";
import { hanhTrinhHoc, changGanNhat } from "./learningJourney";

describe("hanhTrinhHoc", () => {
  it("tám chặng cố định, đúng thứ tự, không thiếu không thừa", () => {
    const h = hanhTrinhHoc({ knowledge: { timeline: [], topics: [] } });
    expect(h.map((c) => c.key)).toEqual([
      "upload", "summary", "mindmap", "knowledge", "chat", "quiz_created", "quiz_graded", "review",
    ]);
    expect(h.every((c) => c.dat === false)).toBe(true);
  });

  it("chặng có event thật trong timeline thì đạt, giữ nguyên mốc thời gian", () => {
    const doc = { knowledge: { timeline: [{ event: "uploaded", at: "2026-01-01T00:00:00Z" },
                                          { event: "summary", at: "2026-01-02T00:00:00Z" }],
                                topics: [] } };
    const h = hanhTrinhHoc(doc);
    expect(h.find((c) => c.key === "upload")).toEqual({ key: "upload", nhan: "Tải lên", at: "2026-01-01T00:00:00Z", dat: true });
    expect(h.find((c) => c.key === "mindmap").dat).toBe(false);
  });

  it("chặng 'knowledge' suy từ topics, KHÔNG từ timeline", () => {
    const doc = { knowledge: { timeline: [], topics: [{ name: "X" }] } };
    const h = hanhTrinhHoc(doc);
    expect(h.find((c) => c.key === "knowledge")).toEqual({ key: "knowledge", nhan: "Tri thức", at: null, dat: true });
  });

  it("doc rỗng/thiếu knowledge không lỗi, mọi chặng chưa đạt", () => {
    expect(hanhTrinhHoc(null).every((c) => !c.dat)).toBe(true);
    expect(hanhTrinhHoc({}).every((c) => !c.dat)).toBe(true);
  });
});

describe("changGanNhat", () => {
  it("chọn đúng chặng có mốc thời gian MUỘN NHẤT", () => {
    const doc = { knowledge: { timeline: [
      { event: "uploaded", at: "2026-01-01T00:00:00Z" },
      { event: "summary", at: "2026-01-05T00:00:00Z" },
      { event: "mindmap", at: "2026-01-03T00:00:00Z" },
    ], topics: [] } };
    expect(changGanNhat(doc).key).toBe("summary");
  });

  it("chưa có mốc nào → null", () => {
    expect(changGanNhat({ knowledge: { timeline: [], topics: [] } })).toBeNull();
  });
});
