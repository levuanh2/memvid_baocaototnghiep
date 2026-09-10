import { describe, expect, it } from "vitest";
import {
  baoPhuArtifact, hoanThanhTongThe, chuDeChuaDanhGia, taiLieuItMo, taiLieuChuaXong,
  thoiLuongDocUocTinh, insightThuVien,
} from "./learningAnalytics";

const doc = (over) => ({
  document_id: "d1", ai: { index: "ready", summary: {}, mindmap: {}, quiz: {}, review: {} },
  knowledge: { topics: [] }, char_count: 100, open_count: 0, reading_minutes: 5,
  ...over,
});

describe("baoPhuArtifact / hoanThanhTongThe", () => {
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
    expect(hoanThanhTongThe([doc({ ai: { index: "processing" } })])).toBe(0);
  });

  it("hoanThanhTongThe là trung bình bốn coverage", () => {
    const docs = [doc({
      ai: {
        index: "ready", summary: { state: "ready" }, mindmap: { state: "ready" },
        quiz: { ready: false }, review: { ready: false },
      },
    })];
    // summary 100, mindmap 100, quiz 0, review 0 → trung bình 50
    expect(hoanThanhTongThe(docs)).toBe(50);
  });
});

describe("chuDeChuaDanhGia", () => {
  it("chỉ lấy chủ đề mastery === null, bỏ qua chủ đề đã có điểm", () => {
    const docs = [doc({
      knowledge: { topics: [{ name: "X", mastery: null }, { name: "Y", mastery: 0.8 }] },
    })];
    const out = chuDeChuaDanhGia(docs);
    expect(out).toEqual([{ name: "X", documentId: "d1", taiLieu: undefined }]);
  });

  it("gioiHan cắt đúng số lượng", () => {
    const docs = [doc({
      knowledge: { topics: Array.from({ length: 10 }, (_, i) => ({ name: `T${i}`, mastery: null })) },
    })];
    expect(chuDeChuaDanhGia(docs, { gioiHan: 3 })).toHaveLength(3);
  });
});

describe("taiLieuItMo", () => {
  it("lọc theo ngưỡng open_count, sắp ít mở nhất lên đầu", () => {
    const docs = [
      doc({ document_id: "a", open_count: 5 }),
      doc({ document_id: "b", open_count: 0 }),
      doc({ document_id: "c", open_count: 1 }),
    ];
    const out = taiLieuItMo(docs, { nguongLan: 1 });
    expect(out.map((d) => d.document_id)).toEqual(["b", "c"]);
  });

  it("bỏ qua tài liệu chưa lập chỉ mục", () => {
    const docs = [doc({ ai: { index: "processing" }, open_count: 0 })];
    expect(taiLieuItMo(docs)).toEqual([]);
  });
});

describe("taiLieuChuaXong", () => {
  it("chỉ lấy tài liệu ĐÃ mở với readiness trong khoảng (20, 80)", () => {
    const docs = [
      doc({ document_id: "a", last_opened_at: "2026-01-01", knowledge: { readiness: { total: 50 } } }),
      doc({ document_id: "b", last_opened_at: "2026-01-01", knowledge: { readiness: { total: 10 } } }), // dưới trần
      doc({ document_id: "c", last_opened_at: "2026-01-01", knowledge: { readiness: { total: 90 } } }), // trên trần
      doc({ document_id: "d", last_opened_at: null, knowledge: { readiness: { total: 50 } } }),          // chưa mở
    ];
    expect(taiLieuChuaXong(docs).map((d) => d.document_id)).toEqual(["a"]);
  });
});

describe("thoiLuongDocUocTinh", () => {
  it("cộng dồn reading_minutes CHỈ của tài liệu đã mở", () => {
    const docs = [
      doc({ document_id: "a", last_opened_at: "2026-01-01", reading_minutes: 10 }),
      doc({ document_id: "b", last_opened_at: null, reading_minutes: 100 }),
    ];
    expect(thoiLuongDocUocTinh(docs)).toBe(10);
  });
});

describe("insightThuVien", () => {
  it("chủ đề học nhiều nhất = trọng số tổng cao nhất qua toàn thư viện", () => {
    const docs = [
      doc({ document_id: "a", knowledge: { topics: [{ name: "X", weight: 3 }] } }),
      doc({ document_id: "b", knowledge: { topics: [{ name: "Y", weight: 1 }, { name: "X", weight: 2 }] } }),
    ];
    const ins = insightThuVien(docs);
    expect(ins.chuDeHocNhieuNhat).toBe("X");
    expect(ins.chuDeItHocNhat).toBe("Y");
  });

  it("tài liệu lớn nhất / hoạt động nhất chọn đúng theo char_count/open_count", () => {
    const docs = [
      doc({ document_id: "a", char_count: 100, open_count: 1 }),
      doc({ document_id: "b", char_count: 999, open_count: 9 }),
    ];
    const ins = insightThuVien(docs);
    expect(ins.taiLieuLonNhat.document_id).toBe("b");
    expect(ins.taiLieuHoatDongNhat.document_id).toBe("b");
  });

  it("danh sách rỗng không lỗi, mọi trường về giá trị an toàn", () => {
    const ins = insightThuVien([]);
    expect(ins.chuDeHocNhieuNhat).toBeNull();
    expect(ins.taiLieuLonNhat).toBeNull();
    expect(ins.luotQuizDaCham).toBe(0);
    expect(ins.baoPhuTomTat).toBe(0);
  });
});
