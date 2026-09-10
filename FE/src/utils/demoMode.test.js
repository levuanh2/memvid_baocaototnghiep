import { describe, expect, it } from "vitest";
import { chonTaiLieuDemo, beMatDemoDauTien } from "./demoMode";

const doc = (over) => ({
  document_id: "d1", ai: { index: "ready" }, knowledge: { readiness: { total: 0 } },
  ...over,
});

describe("chonTaiLieuDemo", () => {
  it("thư viện rỗng → null, không bịa demo", () => {
    expect(chonTaiLieuDemo([])).toBeNull();
    expect(chonTaiLieuDemo(undefined)).toBeNull();
  });

  it("mọi tài liệu chưa lập chỉ mục → null", () => {
    const docs = [doc({ ai: { index: "processing" } }), doc({ document_id: "d2", ai: { index: "failed" } })];
    expect(chonTaiLieuDemo(docs)).toBeNull();
  });

  it("chọn đúng tài liệu điểm cao nhất (nhiều bề mặt AI sẵn sàng hơn)", () => {
    const ngheo = doc({ document_id: "ngheo" });
    const giau = doc({
      document_id: "giau",
      ai: { index: "ready", summary: { state: "ready" }, mindmap: { state: "ready" },
            quiz: { ready: true }, review: { ready: true } },
      knowledge: { readiness: { total: 80 } },
    });
    expect(chonTaiLieuDemo([ngheo, giau]).document_id).toBe("giau");
  });

  it("đã lập chỉ mục nhưng ZERO artifact/readiness nào → vẫn null (điểm 0, không > 0)", () => {
    expect(chonTaiLieuDemo([doc()])).toBeNull();
  });
});

describe("beMatDemoDauTien", () => {
  it("có tóm tắt sẵn sàng → mở tóm tắt trước", () => {
    expect(beMatDemoDauTien({ ai: { summary: { state: "ready" } } })).toBe("summary");
  });

  it("không có tóm tắt → về bản đồ học tập", () => {
    expect(beMatDemoDauTien({ ai: { mindmap: { state: "ready" } } })).toBe("studymap");
    expect(beMatDemoDauTien({})).toBe("studymap");
  });
});
