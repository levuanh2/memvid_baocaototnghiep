import { describe, expect, it } from "vitest";
import { hangDoiOnTap, taiLieuDaOnXong } from "./reviewQueue";

const doc = (id, mastery) => ({ document_id: id, knowledge: { readiness: { mastery } } });

describe("hangDoiOnTap", () => {
  it("mastery thấp → Hôm nay, trung bình → Ngày mai, cao → Sau", () => {
    const q = hangDoiOnTap([doc("a", 10), doc("b", 55), doc("c", 90)]);
    expect(q.homNay.map((d) => d.document_id)).toEqual(["a"]);
    expect(q.ngayMai.map((d) => d.document_id)).toEqual(["b"]);
    expect(q.sau.map((d) => d.document_id)).toEqual(["c"]);
  });

  it("mỗi nhóm sắp mastery thấp nhất lên đầu", () => {
    const q = hangDoiOnTap([doc("a", 30), doc("b", 5)]);
    expect(q.homNay.map((d) => d.document_id)).toEqual(["b", "a"]);
  });

  it("thiếu mastery → coi như 0 (Hôm nay), không lỗi", () => {
    const q = hangDoiOnTap([{ document_id: "x", knowledge: {} }]);
    expect(q.homNay.map((d) => d.document_id)).toEqual(["x"]);
  });

  it("danh sách rỗng → ba nhóm rỗng, không lỗi", () => {
    const q = hangDoiOnTap([]);
    expect(q).toEqual({ homNay: [], ngayMai: [], sau: [], hoanThanh: [] });
  });

  it("hoanThanh chỉ phản chiếu tham số truyền vào, không tự lọc lại", () => {
    const done = [doc("z", 100)];
    expect(hangDoiOnTap([], done).hoanThanh).toBe(done);
  });
});

describe("taiLieuDaOnXong", () => {
  it("chỉ lấy tài liệu có ai.review.ready", () => {
    const docs = [
      { document_id: "a", ai: { review: { ready: true } } },
      { document_id: "b", ai: { review: { ready: false } } },
      { document_id: "c" },
    ];
    expect(taiLieuDaOnXong(docs).map((d) => d.document_id)).toEqual(["a"]);
  });
});
