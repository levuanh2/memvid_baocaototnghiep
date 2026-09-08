import { describe, it, expect, beforeEach } from "vitest";

// Env node — `localStorage` phải dựng TRƯỚC import (cùng khuôn activeMindmapJob.test.js).
const _kho = new Map();
globalThis.localStorage = {
  getItem: (k) => (_kho.has(k) ? _kho.get(k) : null),
  setItem: (k, v) => _kho.set(k, String(v)),
  removeItem: (k) => _kho.delete(k),
  clear: () => _kho.clear(),
};
import { giaiDoanInsight, noiDungInsight, daDong, dongInsight, GIAI_DOAN } from "./aiInsight";

const doc = (over = {}) => ({
  document_id: "d1", title: "bai giang.pdf", display_name: null,
  status: "completed", ingest_status: "ready", progress: 1.0,
  page_count: 42, chunk_count: 310, error: null,
  capabilities: { chunk_query: true, memory_query: true },
  ai: { index: "ready",
        summary: { state: "not_generated", preview: null, ai_overview: null },
        mindmap: { state: "not_generated" }, studymap: { state: "not_generated" } },
  ...over,
});

const dangXuLy = (progress) => doc({
  status: "processing", ingest_status: "processing", progress,
  capabilities: {}, ai: { ...doc().ai, index: "not_generated" },
});

describe("giaiDoanInsight", () => {
  it("đang tải lên khi request còn bay hoặc chưa có tài liệu", () => {
    expect(giaiDoanInsight(null, { dangTai: true })).toBe(GIAI_DOAN.DANG_TAI);
    expect(giaiDoanInsight(null)).toBe(GIAI_DOAN.DANG_TAI);
    expect(giaiDoanInsight(doc(), { dangTai: true })).toBe(GIAI_DOAN.DANG_TAI);
  });

  it("đang đọc nội dung khi progress < 0.3", () => {
    expect(giaiDoanInsight(dangXuLy(0.1))).toBe(GIAI_DOAN.DANG_DOC);
    expect(giaiDoanInsight(dangXuLy(0))).toBe(GIAI_DOAN.DANG_DOC);
  });

  it("đang lập chỉ mục khi progress >= 0.3 mà chưa truy vấn được", () => {
    expect(giaiDoanInsight(dangXuLy(0.3))).toBe(GIAI_DOAN.DANG_LAP_CHI_MUC);
    expect(giaiDoanInsight(dangXuLy(0.75))).toBe(GIAI_DOAN.DANG_LAP_CHI_MUC);
  });

  it("sẵn sàng khi chunk_query bật", () => {
    expect(giaiDoanInsight(doc())).toBe(GIAI_DOAN.SAN_SANG);
  });

  it("có tóm tắt CHỈ khi tóm tắt thật sự tồn tại", () => {
    const d = doc({ ai: { ...doc().ai,
                          summary: { state: "ready", preview: "x", ai_overview: ["a"] } } });
    expect(giaiDoanInsight(d)).toBe(GIAI_DOAN.CO_TOM_TAT);
  });

  it("hỏng thắng mọi giai đoạn khác", () => {
    expect(giaiDoanInsight(doc({ ingest_status: "error" }))).toBe(GIAI_DOAN.HONG);
    expect(giaiDoanInsight(doc({ status: "failed" }))).toBe(GIAI_DOAN.HONG);
  });
});

describe("noiDungInsight — không bao giờ nói dối", () => {
  it("KHÔNG nói 'AI đã đọc xong' khi chưa có tóm tắt", () => {
    // Ràng buộc trung tâm của thẻ này. Ingest KHÔNG tự tạo tóm tắt, nên ngay sau
    // upload sẽ không có bản nào — nói ngược lại là bịa ra một việc chưa xảy ra.
    for (const d of [dangXuLy(0.1), dangXuLy(0.5), doc()]) {
      const n = noiDungInsight(d);
      expect(n.tieuDe).not.toContain("đã đọc xong");
      expect(n.yChinh).toEqual([]);
    }
  });

  it("giai đoạn sẵn sàng là LỜI MỜI tạo tóm tắt, không phải thông báo đã có", () => {
    const n = noiDungInsight(doc());
    expect(n.tieuDe).toBe("Đã sẵn sàng tra cứu");
    expect(n.hanhDong).toContain("tom_tat");
    expect(n.hanhDong).not.toContain("mo_tom_tat");
  });

  it("giai đoạn sẵn sàng chỉ nói con số THẬT đang có", () => {
    expect(noiDungInsight(doc()).moTa).toBe("42 trang · 310 đoạn");
    expect(noiDungInsight(doc({ page_count: null, chunk_count: null })).moTa).toBeNull();
  });

  it("có tóm tắt thì hiện tối đa 3 ý chính suy từ bản ghi thật", () => {
    const d = doc({ ai: { ...doc().ai,
                          summary: { state: "ready", preview: "Tổng quan.",
                                     ai_overview: ["một", "hai", "ba"] } } });
    const n = noiDungInsight(d);
    expect(n.tieuDe).toBe("AI đã đọc xong tài liệu này");
    expect(n.yChinh).toEqual(["một", "hai", "ba"]);
    expect(n.moTa).toBe("Tổng quan.");
    expect(n.hanhDong).toContain("mo_tom_tat");
  });

  it("có tóm tắt nhưng thiếu ai_overview thì không bịa ý chính", () => {
    const d = doc({ ai: { ...doc().ai,
                          summary: { state: "ready", preview: "x", ai_overview: null } } });
    expect(noiDungInsight(d).yChinh).toEqual([]);
  });

  it("mở sơ đồ chỉ xuất hiện khi có sơ đồ tư duy hoặc bản đồ học tập", () => {
    const chiTomTat = doc({ ai: { ...doc().ai,
      summary: { state: "ready", preview: "x", ai_overview: [] } } });
    expect(noiDungInsight(chiTomTat).hanhDong).not.toContain("mo_so_do");

    const coBanDo = doc({ ai: { ...doc().ai,
      summary: { state: "ready", preview: "x", ai_overview: [] },
      studymap: { state: "ready" } } });
    expect(noiDungInsight(coBanDo).hanhDong).toContain("mo_so_do");
  });

  it("hỏng thì hiện error_message THẬT của máy chủ", () => {
    // Nuốt thông báo thật rồi thay bằng câu chung chung là lấy mất đường duy nhất
    // để người dùng tự sửa.
    const d = doc({ ingest_status: "error", error: "Không đọc được nội dung file." });
    const n = noiDungInsight(d);
    expect(n.moTa).toBe("Không đọc được nội dung file.");
    expect(n.hanhDong).toContain("tai_lai");
  });

  it("hỏng mà không có chi tiết vẫn nói rõ là không rõ nguyên nhân", () => {
    expect(noiDungInsight(doc({ ingest_status: "error", error: null })).moTa)
      .toBe("Không rõ nguyên nhân.");
  });

  it("dùng display_name khi có, lùi về title rồi tới tên tệp đang tải", () => {
    expect(noiDungInsight(doc({ display_name: "Tên đặt" })).ten).toBe("Tên đặt");
    expect(noiDungInsight(doc()).ten).toBe("bai giang.pdf");
    expect(noiDungInsight(null, { dangTai: true, tenTep: "moi.pdf" }).ten).toBe("moi.pdf");
  });

  it("cờ dangChay chỉ bật ở các giai đoạn thực sự đang chạy", () => {
    expect(noiDungInsight(null, { dangTai: true }).dangChay).toBe(true);
    expect(noiDungInsight(dangXuLy(0.1)).dangChay).toBe(true);
    expect(noiDungInsight(doc()).dangChay).toBe(false);
    expect(noiDungInsight(doc({ ingest_status: "error" })).dangChay).toBe(false);
  });
});

describe("đóng thẻ — theo từng tài liệu", () => {
  beforeEach(() => localStorage.clear());

  it("đóng một tài liệu không đóng tài liệu khác", () => {
    dongInsight("d1");
    expect(daDong("d1")).toBe(true);
    expect(daDong("d2")).toBe(false);
  });

  it("id rỗng bị bỏ qua", () => {
    dongInsight("");
    dongInsight(null);
    expect(daDong("")).toBe(false);
    expect(daDong(null)).toBe(false);
  });

  it("chỉ giữ 50 mục gần nhất", () => {
    for (let i = 0; i < 60; i += 1) dongInsight(`d${i}`);
    expect(daDong("d59")).toBe(true);
    expect(daDong("d0")).toBe(false);
  });

  it("đóng lại tài liệu cũ thì đẩy nó lên đầu, không nhân bản", () => {
    dongInsight("a");
    dongInsight("b");
    dongInsight("a");
    expect(JSON.parse(localStorage.getItem("memvidx.insight.dismissed.v1")))
      .toEqual(["a", "b"]);
  });

  it("localStorage hỏng thì coi như chưa đóng, không nổ", () => {
    localStorage.setItem("memvidx.insight.dismissed.v1", "{khong-phai-json");
    expect(() => daDong("d1")).not.toThrow();
    expect(daDong("d1")).toBe(false);
  });
});
