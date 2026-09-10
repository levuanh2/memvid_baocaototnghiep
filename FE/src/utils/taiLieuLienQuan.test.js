import { describe, expect, it } from "vitest";

import { taiLieuLienQuan } from "./taiLieuLienQuan";

const chuDe = (...ten) => ten.map((name) => ({ name }));

const DOC = {
  document_id: "d1",
  collection_id: "c1",
  tags: ["AI", "Exam"],
  knowledge: { topics: chuDe("Định thời", "Hàng đợi") },
};

const CHI_MUC_BST = new Map([
  ["c1", { collection_id: "c1", name: "Hệ điều hành" }],
  ["c2", { collection_id: "c2", name: "Mạng máy tính" }],
]);

describe("tài liệu liên quan", () => {
  it("matches a shared topic and reports it as structured metadata, not a label string", () => {
    const other = { document_id: "d2", tags: [], knowledge: { topics: chuDe("Định thời") } };
    const [item] = taiLieuLienQuan(DOC, [DOC, other]);
    expect(item.doc.document_id).toBe("d2");
    expect(item.reason).toEqual([{ source: "topic", value: "Định thời" }]);
  });

  it("matches topics diacritic- and case-insensitively", () => {
    const other = { document_id: "d2", tags: [], knowledge: { topics: chuDe("dinh THOI") } };
    const [item] = taiLieuLienQuan(DOC, [DOC, other]);
    expect(item.reason[0]).toEqual({ source: "topic", value: "dinh THOI" });
  });

  it("matches a shared collection and resolves its name via chiMucBst", () => {
    const other = { document_id: "d2", collection_id: "c1", tags: [], knowledge: {} };
    const [item] = taiLieuLienQuan(DOC, [DOC, other], { chiMucBst: CHI_MUC_BST });
    expect(item.reason).toEqual([{ source: "collection", value: "Hệ điều hành" }]);
  });

  it("skips the collection signal entirely when chiMucBst is not given (no raw id leaks as a value)", () => {
    const other = { document_id: "d2", collection_id: "c1", tags: [], knowledge: {} };
    expect(taiLieuLienQuan(DOC, [DOC, other])).toEqual([]);
  });

  it("matches a shared tag case-insensitively", () => {
    const other = { document_id: "d2", tags: ["ai"], knowledge: {} };
    const [item] = taiLieuLienQuan(DOC, [DOC, other]);
    expect(item.reason).toEqual([{ source: "tag", value: "ai" }]);
  });

  it("excludes the current document itself", () => {
    expect(taiLieuLienQuan(DOC, [DOC])).toEqual([]);
  });

  it("excludes documents with zero shared signal instead of forcing a weak match", () => {
    const unrelated = { document_id: "d2", collection_id: "c9", tags: ["Other"],
      knowledge: { topics: chuDe("Không liên quan") } };
    expect(taiLieuLienQuan(DOC, [DOC, unrelated], { chiMucBst: CHI_MUC_BST })).toEqual([]);
  });

  it("ranks more shared signals higher and respects toiDa", () => {
    const nhieu = { document_id: "nhieu", collection_id: "c1", tags: ["AI"],
      knowledge: { topics: chuDe("Định thời") } };
    const it_ = { document_id: "it", tags: ["AI"], knowledge: {} };
    const cung_it = { document_id: "cung-it", tags: ["Exam"], knowledge: {} };
    const ket_qua = taiLieuLienQuan(DOC, [DOC, it_, nhieu, cung_it],
      { chiMucBst: CHI_MUC_BST, toiDa: 2 });
    expect(ket_qua).toHaveLength(2);
    expect(ket_qua[0].doc.document_id).toBe("nhieu");
  });

  it("caps the reason list per related document without dropping the ranking signal", () => {
    const nhieuThe = { document_id: "d2", collection_id: "c1",
      tags: ["a", "b", "c", "d", "e"], knowledge: {} };
    const [item] = taiLieuLienQuan(DOC, [DOC, nhieuThe], { chiMucBst: CHI_MUC_BST });
    expect(item.reason.length).toBeLessThanOrEqual(4);
    expect(item.reason[0]).toEqual({ source: "collection", value: "Hệ điều hành" });
  });

  it("never mutates the incoming documents array or its elements", () => {
    const documents = [DOC, { document_id: "d2", collection_id: "c1", tags: ["AI"], knowledge: {} },
      { document_id: "d3", tags: [], knowledge: {} }];
    const before = JSON.stringify(documents);
    const beforeOrder = documents.map((d) => d.document_id);
    taiLieuLienQuan(DOC, documents, { chiMucBst: CHI_MUC_BST, toiDa: 1 });
    expect(documents.map((d) => d.document_id)).toEqual(beforeOrder);
    expect(JSON.stringify(documents)).toBe(before);
  });

  it("tolerates null and malformed inputs", () => {
    expect(taiLieuLienQuan(null, [DOC])).toEqual([]);
    expect(taiLieuLienQuan(DOC, null)).toEqual([]);
    expect(taiLieuLienQuan(DOC, [null, {}, { document_id: "d2" }])).toEqual([]);
    expect(taiLieuLienQuan({ document_id: "d1" }, [{ document_id: "d2" }])).toEqual([]);
  });
});
