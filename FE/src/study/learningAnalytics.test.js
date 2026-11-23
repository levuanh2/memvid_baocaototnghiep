import { describe, expect, it } from "vitest";
import { baoPhuArtifact } from "./learningAnalytics";

const doc = (over) => ({
  document_id: "d1", ai: { index: "ready", summary: {}, mindmap: {}, quiz: {}, review: {} },
  knowledge: { topics: [] }, char_count: 100, open_count: 0, reading_minutes: 5,
  ...over,
});

describe("baoPhuArtifact", () => {
  it("chỉ đếm tài liệu ĐÃ lập chỉ mục ở mẫu số", () => {
    const docs = [
      doc({ document_id: "a", ai: { index: "ready", summary: { state: "ready" }, mindmap: {}, quiz: {}, review: {} } }),
      doc({ document_id: "b", ai: { index: "processing" } }),   // chưa index, loại khỏi mẫu số
    ];
    const bp = baoPhuArtifact(docs);
    expect(bp.tongSoDaLapChiMuc).toBe(1);
    expect(bp.summary).toEqual({ co: 1, tong: 1, phanTram: 100 });
  });

  it("không có tài liệu nào đã lập chỉ mục → mọi phần trăm là 0, không NaN", () => {
    const bp = baoPhuArtifact([doc({ ai: { index: "processing" } })]);
    expect(bp.summary.phanTram).toBe(0);
  });
});
