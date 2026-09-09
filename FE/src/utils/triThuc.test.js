import { describe, expect, it } from "vitest";

import {
  chuDeNoiBat, coTriThuc, mucTrongThe, nhanSanSang, nhanTrangThaiHoc,
  timTheoTriThuc, yChinh,
} from "./triThuc";

const DOC = {
  document_id: "doc-1",
  reading_minutes: 4,
  ai: { summary: { preview: "Một tóm tắt thật" }, index: "ready" },
  knowledge: {
    takeaways: ["Ý một", "Ý hai"],
    topics: [
      { name: "Mạnh", weight: 3, mastery: 0.9, status: "strong" },
      { name: "Yếu", weight: 1, mastery: 0.2, status: "weak" },
    ],
    keywords: ["Định thời"],
    entities: ["Alice"],
    readiness: { total: 70, mastery_available: false, missing: ["quiz", "index"] },
    learning_status: "in_progress",
  },
};

describe("tri thức trên thẻ", () => {
  it("tolerates a missing knowledge block on every public helper", () => {
    expect(coTriThuc(null)).toBe(false);
    expect(yChinh({})).toEqual([]);
    expect(chuDeNoiBat(null)).toEqual([]);
    expect(nhanSanSang(null)).toEqual({ phanTram: 0, nhan: "Chưa sẵn sàng", thieu: [] });
    expect(mucTrongThe(null)).toEqual([]);
    expect(timTheoTriThuc({}, "topic")).toBe(false);
    expect(timTheoTriThuc(null, "")).toBe(true);
  });

  it("keeps knowledge usable only when it contains renderable data", () => {
    expect(coTriThuc({ knowledge: {} })).toBe(false);
    expect(coTriThuc(DOC)).toBe(true);
    expect(yChinh(DOC, { gioiHan: 1 })).toEqual(["Ý một"]);
  });

  it("puts weak topics first without folding mastery into weight", () => {
    const topics = chuDeNoiBat(DOC);
    expect(topics.map((topic) => topic.name)).toEqual(["Yếu", "Mạnh"]);
    expect(topics[0]).toMatchObject({ weight: 1, yeu: true });
  });

  it("labels known learning states and leaves an unknown state visible", () => {
    expect(nhanTrangThaiHoc("mastered")).toBe("Đã nắm vững");
    expect(nhanTrangThaiHoc("other")).toBe("other");
  });

  it("does not present unassessed mastery as a real zero", () => {
    const readiness = nhanSanSang(DOC.knowledge.readiness);
    expect(readiness.phanTram).toBe(70);
    expect(readiness.nhan).toContain("chưa đánh giá mức độ nắm vững");
    expect(readiness.thieu).toEqual(["Quiz", "Lập chỉ mục"]);
  });

  it("omits card sections with no supporting data", () => {
    expect(mucTrongThe({ document_id: "only-action" })).toEqual(["hanhDong"]);
    expect(mucTrongThe(DOC)).toEqual(["yChinh", "tomTat", "chuDe", "chip", "sieuDuLieu", "hanhDong"]);
  });

  it("finds Vietnamese topics without accents", () => {
    expect(timTheoTriThuc(DOC, "dinh thoi")).toBe(true);
    expect(timTheoTriThuc(DOC, "khong co")).toBe(false);
  });

  it("never mutates the caller's document", () => {
    const before = JSON.stringify(DOC);
    coTriThuc(DOC);
    yChinh(DOC);
    chuDeNoiBat(DOC);
    nhanSanSang(DOC.knowledge.readiness);
    mucTrongThe(DOC);
    timTheoTriThuc(DOC, "alice");
    expect(JSON.stringify(DOC)).toBe(before);
  });
});
