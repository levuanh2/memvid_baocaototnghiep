import { describe, expect, it } from "vitest";
import { timTaiLieu, timBoSuuTap, timChuDe, timThucThe, timKiemToanCuc } from "./paletteSearch";

const doc = (over) => ({
  document_id: "d1", title: "Tài liệu", knowledge: { topics: [], entities: [] },
  tags: [], ai: {}, ...over,
});
const col = (id, name) => ({ collection_id: id, name });

describe("timTaiLieu", () => {
  it("rỗng -> mảng rỗng, không lỗi", () => {
    expect(timTaiLieu([doc()], "", new Map())).toEqual([]);
  });

  it("tự nhiên: sắp theo điểm", () => {
    const a = doc({ document_id: "a", title: "CPU chi tiết" });
    const b = doc({ document_id: "b", title: "CPU" });
    const ra = timTaiLieu([a, b], "cpu", new Map());
    expect(ra.map((x) => x.doc.document_id)).toEqual(["b", "a"]); // đúng tiêu đề trước
  });

  it("nâng cao: has:summary lọc đúng", () => {
    const a = doc({ document_id: "a", ai: { summary: { state: "ready" } } });
    const b = doc({ document_id: "b" });
    const ra = timTaiLieu([a, b], "has:summary", new Map());
    expect(ra.map((x) => x.doc.document_id)).toEqual(["a"]);
  });

  it("dùng tên bộ sưu tập từ collectionsById", () => {
    const a = doc({ document_id: "a", collection_id: "c1", title: "X" });
    const collectionsById = new Map([["c1", { name: "Hệ điều hành" }]]);
    const ra = timTaiLieu([a], "dieu hanh", collectionsById);
    expect(ra).toHaveLength(1);
  });
});

describe("timBoSuuTap", () => {
  it("khớp theo tên, không phân biệt dấu/hoa thường", () => {
    const cs = [col("1", "Hệ điều hành"), col("2", "Mạng máy tính")];
    expect(timBoSuuTap(cs, "he dieu").map((c) => c.collection_id)).toEqual(["1"]);
  });
  it("truy vấn nâng cao -> không tìm bộ sưu tập theo tên (đó là để LỌC tài liệu)", () => {
    expect(timBoSuuTap([col("1", "topic test")], "topic:x")).toEqual([]);
  });
});

describe("timChuDe / timThucThe", () => {
  const docs = [
    doc({ document_id: "a", knowledge: { topics: [{ name: "CPU" }], entities: ["Linux"] } }),
    doc({ document_id: "b", knowledge: { topics: [{ name: "CPU" }, { name: "GPU" }], entities: ["Linux"] } }),
  ];
  it("gộp duy nhất, đếm đúng số tài liệu", () => {
    const cd = timChuDe(docs, "cpu");
    expect(cd).toEqual([{ ten: "CPU", soTaiLieu: 2 }]);
    const tt = timThucThe(docs, "linux");
    expect(tt).toEqual([{ ten: "Linux", soTaiLieu: 2 }]);
  });
  it("nhiều kết quả -> đếm nhiều hơn lên trước", () => {
    const cd = timChuDe(docs, "");
    expect(cd).toEqual([]); // rỗng -> rỗng, giống timTaiLieu
  });
});

describe("timKiemToanCuc", () => {
  it("gộp bốn nhóm, mỗi nhóm cắt gioiHan", () => {
    const docs = Array.from({ length: 12 }, (_, i) => doc({ document_id: `d${i}`, title: `CPU ${i}` }));
    const kq = timKiemToanCuc(docs, [], "cpu", { gioiHan: 5 });
    expect(kq.documents).toHaveLength(5);
    expect(kq.collections).toEqual([]);
    expect(kq.topics).toEqual([]);
    expect(kq.entities).toEqual([]);
  });

  it("rỗng -> bốn mảng rỗng", () => {
    const kq = timKiemToanCuc([doc()], [col("1", "X")], "");
    expect(kq).toEqual({ documents: [], collections: [], topics: [], entities: [] });
  });
});
