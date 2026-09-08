import { describe, it, expect } from "vitest";
import { duongDi, tiepTucHoc, thoiGianTuongDoi, BE_MAT } from "./tiepTucHoc";

const doc = (over = {}) => ({
  document_id: "doc-1", source_stem: "bai_giang_pdf", title: "bai giang.pdf",
  last_opened_at: "2026-09-09T11:00:00Z", last_workspace: "mindmap",
  ai: { quiz: { ready: false, count: 0, latest_quiz_id: null },
        review: { ready: false, count: 0, latest_attempt_id: null } },
  ...over,
});

const GIO = Date.parse("2026-09-09T12:00:00Z");

describe("duongDi — mọi bề mặt được hỗ trợ", () => {
  it("tóm tắt, sơ đồ tư duy và hỏi đáp đều về Workspace kèm nguồn chọn sẵn", () => {
    // Cả ba là modal của `/app`, không phải route riêng. `?source=` chọn sẵn nguồn
    // để câu hỏi kế tiếp đã đúng phạm vi.
    for (const bm of ["summary", "mindmap", "chat"]) {
      expect(duongDi(doc(), bm)).toBe("/app?source=bai_giang_pdf");
    }
  });

  it("thiếu stem thì về /app trần, không dựng URL hỏng", () => {
    expect(duongDi(doc({ source_stem: null }), "chat")).toBe("/app");
    expect(duongDi(doc({ source_stem: "  " }), "chat")).toBe("/app");
  });

  it("bản đồ học tập có route riêng theo document_id", () => {
    expect(duongDi(doc(), "studymap")).toBe("/app/study/map/doc-1");
  });

  it("quiz đi thẳng vào bài mới nhất khi đã có", () => {
    const d = doc({ ai: { quiz: { ready: true, count: 2, latest_quiz_id: "q-9" },
                          review: { ready: false, count: 0, latest_attempt_id: null } } });
    expect(duongDi(d, "quiz")).toBe("/app/study/quiz/q-9");
  });

  it("chưa có quiz thì về màn tạo, đã chọn sẵn tài liệu", () => {
    expect(duongDi(doc(), "quiz")).toBe("/app/study/quiz/new?document=doc-1");
  });

  it("ôn tập đi tới attempt mới nhất", () => {
    const d = doc({ ai: { quiz: { ready: true, count: 1, latest_quiz_id: "q-1" },
                          review: { ready: true, count: 1, latest_attempt_id: "a-7" } } });
    expect(duongDi(d, "review")).toBe("/app/study/review/a-7");
  });

  it("chưa có attempt thì KHÔNG dựng route ôn tập với id sai", () => {
    // Một route ôn tập trỏ vào attempt sai còn tệ hơn là không đi.
    expect(duongDi(doc(), "review")).toBe("/app/study/map/doc-1");
  });

  it("bề mặt lạ hoặc null lùi về tài liệu, không bao giờ trả route hỏng", () => {
    for (const bm of ["flashcards", "", null, undefined, 42]) {
      expect(duongDi(doc(), bm)).toBe("/app/study/map/doc-1");
    }
  });

  it("thiếu document_id trả null", () => {
    expect(duongDi({}, "summary")).toBeNull();
    expect(duongDi(null, "summary")).toBeNull();
  });

  it("mã hoá id và stem có ký tự đặc biệt", () => {
    const d = doc({ document_id: "a/b?c", source_stem: "x y&z" });
    expect(duongDi(d, "studymap")).toBe("/app/study/map/a%2Fb%3Fc");
    expect(duongDi(d, "chat")).toBe("/app?source=x%20y%26z");
  });
});

describe("tiepTucHoc", () => {
  it("dựng thẻ đầy đủ", () => {
    const t = tiepTucHoc(doc(), { now: GIO });
    expect(t.beMat).toBe("mindmap");
    expect(t.nhanBeMat).toBe("Sơ đồ tư duy");
    expect(t.duongDi).toBe("/app?source=bai_giang_pdf");
    expect(t.nhanThoiGian).toBe("1 giờ trước");
  });

  it("chưa mở bao giờ → null, để mục biến mất hẳn", () => {
    // Thẻ "Tiếp tục học" trống với người chưa học gì là chỗ giữ chỗ, và chỗ giữ chỗ
    // dạy người dùng bỏ qua khu vực đó.
    expect(tiepTucHoc(doc({ last_opened_at: null }), { now: GIO })).toBeNull();
    expect(tiepTucHoc({}, { now: GIO })).toBeNull();
    expect(tiepTucHoc(null, { now: GIO })).toBeNull();
  });

  it.each(Object.keys(BE_MAT))("bề mặt %s có nhãn và đường đi", (bm) => {
    const t = tiepTucHoc(doc({ last_workspace: bm }), { now: GIO });
    expect(t.beMat).toBe(bm);
    expect(t.nhanBeMat).toBe(BE_MAT[bm]);
    expect(t.duongDi).toBeTruthy();
  });

  it("last_workspace lạ vẫn resume được, chỉ mất nhãn bề mặt", () => {
    const t = tiepTucHoc(doc({ last_workspace: "khong-ton-tai" }), { now: GIO });
    expect(t.beMat).toBeNull();
    expect(t.nhanBeMat).toBe("Tài liệu");
    expect(t.duongDi).toBe("/app/study/map/doc-1");
  });

  it("last_workspace null vẫn resume được", () => {
    const t = tiepTucHoc(doc({ last_workspace: null }), { now: GIO });
    expect(t.duongDi).toBe("/app/study/map/doc-1");
  });
});

describe("thoiGianTuongDoi", () => {
  it.each([
    ["2026-09-09T11:59:30Z", "vừa xong"],
    ["2026-09-09T11:30:00Z", "30 phút trước"],
    ["2026-09-09T09:00:00Z", "3 giờ trước"],
    ["2026-09-08T12:00:00Z", "hôm qua"],
    ["2026-09-04T12:00:00Z", "5 ngày trước"],
    ["2026-07-01T12:00:00Z", "2 tháng trước"],
    ["2024-09-09T12:00:00Z", "2 năm trước"],
  ])("%s → %s", (iso, mong) => {
    expect(thoiGianTuongDoi(iso, GIO)).toBe(mong);
  });

  it("mốc ở tương lai (lệch đồng hồ) đọc là 'vừa xong', không phải số âm", () => {
    expect(thoiGianTuongDoi("2026-09-09T13:00:00Z", GIO)).toBe("vừa xong");
  });

  it("mốc hỏng trả null — không hiện gì còn hơn hiện 'NaN phút trước'", () => {
    expect(thoiGianTuongDoi("khong-phai-ngay", GIO)).toBeNull();
    expect(thoiGianTuongDoi(null, GIO)).toBeNull();
    expect(thoiGianTuongDoi(undefined, GIO)).toBeNull();
  });
});
