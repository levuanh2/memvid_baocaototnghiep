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

  // Chốt giới hạn đã ghi trong comment ở đầu file: BE khai báo `last_chat`
  // trong `tri_thuc.py::EVENTS` nhưng KHÔNG nơi nào gán nó — chặng "chat" vì
  // vậy KHÔNG THỂ đạt kể cả khi mọi chặng khác đã có mốc thật. Test này giữ
  // hành vi đó ổn định: nếu BE sau này bắt đầu ghi `last_chat`, timeline sẽ tự
  // mang mốc đó và chặng chuyển sang đạt — không cần sửa gì ở module này.
  it("chặng 'chat' KHÔNG đạt dù mọi chặng khác đã đạt — BE chưa từng ghi mốc last_chat", () => {
    const doc = { knowledge: { timeline: [
      { event: "uploaded", at: "2026-01-01T00:00:00Z" },
      { event: "summary", at: "2026-01-02T00:00:00Z" },
      { event: "mindmap", at: "2026-01-03T00:00:00Z" },
      { event: "quiz_created", at: "2026-01-04T00:00:00Z" },
      { event: "quiz_graded", at: "2026-01-05T00:00:00Z" },
      { event: "review_created", at: "2026-01-06T00:00:00Z" },
    ], topics: [{ name: "X" }] } };
    const h = hanhTrinhHoc(doc);
    expect(h.find((c) => c.key === "chat").dat).toBe(false);
    expect(h.filter((c) => c.key !== "chat").every((c) => c.dat)).toBe(true);
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
