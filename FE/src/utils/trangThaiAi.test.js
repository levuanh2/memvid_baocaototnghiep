import { describe, it, expect, beforeEach, vi } from "vitest";

// Bộ test chạy ở env NODE (không jsdom) — `localStorage` không tồn tại sẵn, và
// nó phải được dựng TRƯỚC import vì module đọc kho job ngay khi nạp. Cùng khuôn
// với `activeMindmapJob.test.js`.
const _kho = new Map();
globalThis.localStorage = {
  getItem: (k) => (_kho.has(k) ? _kho.get(k) : null),
  setItem: (k, v) => _kho.set(k, String(v)),
  removeItem: (k) => _kho.delete(k),
  clear: () => _kho.clear(),
};
import {
  stemDangChay, hopNhat, trangThaiAi, chipHienThi, docJobDangChay,
  READY, GENERATING, NOT_GENERATED, HAN_JOB_MS,
} from "./trangThaiAi";
import { ACTIVE_SUMMARY_JOB_KEY } from "./activeSummaryJob";
import { ACTIVE_JOB_KEY } from "./activeMindmapJob";

const doc = (over = {}) => ({
  document_id: "d1", source_stem: "bai_giang_pdf",
  ai: {
    extraction: "ready", embedding: "ready", index: "ready", chat_ready: "ready",
    summary: { state: "not_generated" }, mindmap: { state: "not_generated" },
    studymap: { state: "not_generated" },
    quiz: { ready: false, count: 0 }, review: { ready: false, count: 0 },
    ...(over.ai || {}),
  },
  ...over,
});

const khongJob = { summary: new Set(), mindmap: new Set() };

describe("stemDangChay", () => {
  const gio = Date.parse("2026-09-09T12:00:00Z");

  it("trả các stem của job còn hiệu lực", () => {
    const s = stemDangChay({ jobId: "j1", sources: ["a", "B"], startedAt: gio - 1000 },
                           { now: gio });
    expect([...s]).toEqual(["a", "b"]);
  });

  it("bỏ job quá hạn — mục localStorage mồ côi không được giữ thẻ ở 'đang tạo' mãi", () => {
    // Render Free ngủ sau ~15 phút và giết mọi thread. Không có trần này thì một
    // job đã chết giữ thẻ ở "đang tạo…" vĩnh viễn.
    const s = stemDangChay({ jobId: "j1", sources: ["a"], startedAt: gio - HAN_JOB_MS - 1 },
                           { now: gio });
    expect(s.size).toBe(0);
  });

  it("còn trong hạn thì giữ", () => {
    const s = stemDangChay({ jobId: "j1", sources: ["a"], startedAt: gio - HAN_JOB_MS + 1 },
                           { now: gio });
    expect(s.size).toBe(1);
  });

  it.each([null, undefined, {}, { jobId: "" }, { jobId: 5, sources: ["a"] },
           { jobId: "j", sources: "khong-phai-mang" }])(
    "dữ liệu hỏng %j trả tập rỗng, không ném", (job) => {
      expect(() => stemDangChay(job)).not.toThrow();
      expect(stemDangChay(job).size).toBe(0);
    });

  it("không có startedAt thì coi như còn hiệu lực", () => {
    expect(stemDangChay({ jobId: "j", sources: ["a"] }).size).toBe(1);
  });
});

describe("hopNhat — luật ba trạng thái", () => {
  it("VẮNG MẶT không bao giờ tạo ra GENERATING", () => {
    // Luật trung tâm. Kho tóm tắt bị xoá mỗi lần deploy, nên nếu chỗ trống được đọc
    // là "đang tạo" thì màn hình nói dối phần lớn thời gian và người dùng ngồi chờ
    // một việc chưa từng bắt đầu.
    expect(hopNhat("not_generated", false)).toBe(NOT_GENERATED);
    expect(hopNhat(undefined, false)).toBe(NOT_GENERATED);
    expect(hopNhat(null, false)).toBe(NOT_GENERATED);
  });

  it("GENERATING chỉ đến từ bằng chứng dương là một job đang chạy", () => {
    expect(hopNhat("not_generated", true)).toBe(GENERATING);
  });

  it("READY không bao giờ bị hạ xuống GENERATING", () => {
    // Đã có bản tóm tắt mở được thì việc đang tạo bản mới không được giấu bản cũ.
    expect(hopNhat("ready", true)).toBe(READY);
  });
});

describe("trangThaiAi", () => {
  it("không có job thì mọi thứ theo máy chủ", () => {
    const tt = trangThaiAi(doc(), khongJob);
    expect(tt.summary).toBe(NOT_GENERATED);
    expect(tt.mindmap).toBe(NOT_GENERATED);
    expect(tt.index).toBe(READY);
  });

  it("job trùng stem nâng tóm tắt lên GENERATING", () => {
    const tt = trangThaiAi(doc(), { summary: new Set(["bai_giang_pdf"]),
                                    mindmap: new Set() });
    expect(tt.summary).toBe(GENERATING);
    expect(tt.mindmap).toBe(NOT_GENERATED);
  });

  it("job của stem KHÁC không ảnh hưởng", () => {
    const tt = trangThaiAi(doc(), { summary: new Set(["tai_lieu_khac"]),
                                    mindmap: new Set() });
    expect(tt.summary).toBe(NOT_GENERATED);
  });

  it("so khớp stem không phân biệt hoa thường", () => {
    const tt = trangThaiAi(doc({ source_stem: "BAI_GIANG_PDF" }),
                           { summary: new Set(["bai_giang_pdf"]), mindmap: new Set() });
    expect(tt.summary).toBe(GENERATING);
  });

  it("thiếu source_stem thì không nâng cấp gì", () => {
    const tt = trangThaiAi(doc({ source_stem: null }),
                           { summary: new Set([""]), mindmap: new Set() });
    expect(tt.summary).toBe(NOT_GENERATED);
  });

  it("studymap KHÔNG được client nâng cấp — máy chủ là nguồn duy nhất", () => {
    // `knowledge_maps.status` ở Postgres đã có 'processing', nên đây là chỗ duy
    // nhất bằng chứng nằm ở máy chủ và client không được đoán thêm.
    const dangDung = trangThaiAi(doc({ ai: { studymap: { state: "generating" } } }),
                                 khongJob);
    expect(dangDung.studymap).toBe(GENERATING);
    const chuaCo = trangThaiAi(doc(), { summary: new Set(["bai_giang_pdf"]),
                                        mindmap: new Set(["bai_giang_pdf"]) });
    expect(chuaCo.studymap).toBe(NOT_GENERATED);
  });

  it("quiz/ôn tập suy từ cờ ready", () => {
    const tt = trangThaiAi(doc({ ai: { quiz: { ready: true, count: 2 },
                                       review: { ready: false, count: 0 } } }), khongJob);
    expect(tt.quiz).toBe(READY);
    expect(tt.review).toBe(NOT_GENERATED);
  });

  it("thiếu hẳn khối ai thì mọi thứ NOT_GENERATED, không nổ", () => {
    expect(() => trangThaiAi({ document_id: "x" }, khongJob)).not.toThrow();
    expect(trangThaiAi({}, khongJob).summary).toBe(NOT_GENERATED);
    expect(trangThaiAi(null, khongJob).index).toBe(NOT_GENERATED);
  });

  it("thiếu tham số jobs vẫn chạy", () => {
    expect(() => trangThaiAi(doc(), null)).not.toThrow();
  });
});

describe("docJobDangChay — đọc localStorage", () => {
  beforeEach(() => localStorage.clear());

  it("đọc cả hai kho job", () => {
    localStorage.setItem(ACTIVE_SUMMARY_JOB_KEY,
      JSON.stringify({ jobId: "s1", sources: ["a"], startedAt: Date.now() }));
    localStorage.setItem(ACTIVE_JOB_KEY,
      JSON.stringify({ jobId: "m1", sources: ["b"], startedAt: Date.now() }));
    const j = docJobDangChay();
    expect(j.summary.has("a")).toBe(true);
    expect(j.mindmap.has("b")).toBe(true);
  });

  it("localStorage rỗng trả tập rỗng", () => {
    const j = docJobDangChay();
    expect(j.summary.size).toBe(0);
    expect(j.mindmap.size).toBe(0);
  });

  it("JSON hỏng không làm sập trang", () => {
    localStorage.setItem(ACTIVE_SUMMARY_JOB_KEY, "{khong-phai-json");
    expect(() => docJobDangChay()).not.toThrow();
    expect(docJobDangChay().summary.size).toBe(0);
  });

  it("localStorage ném (chế độ riêng tư) vẫn không sập", () => {
    const goc = globalThis.localStorage.getItem;
    globalThis.localStorage.getItem = vi.fn(() => { throw new Error("chặn"); });
    try {
      expect(() => docJobDangChay()).not.toThrow();
      expect(docJobDangChay().summary.size).toBe(0);
    } finally {
      globalThis.localStorage.getItem = goc;
    }
  });
});

describe("chipHienThi", () => {
  it("sáu chip, KHÔNG có Flashcards", () => {
    const chips = chipHienThi(doc(), khongJob);
    expect(chips.map((c) => c.khoa))
      .toEqual(["index", "summary", "mindmap", "studymap", "quiz", "review"]);
    // Không cột, không chip, không "sắp có". Một affordance cho thứ chưa tồn tại
    // chính là tính năng ma.
    expect(JSON.stringify(chips).toLowerCase()).not.toContain("flashcard");
  });

  it("nhãn đổi sang 'đang…' khi GENERATING", () => {
    const chips = chipHienThi(doc(), { summary: new Set(["bai_giang_pdf"]),
                                       mindmap: new Set() });
    const tt = chips.find((c) => c.khoa === "summary");
    expect(tt.trangThai).toBe(GENERATING);
    expect(tt.nhan).toBe("Đang tóm tắt…");
  });

  it("số lượng chỉ hiện khi > 0 — 'Quiz (0)' là cách viết dài của 'chưa có quiz'", () => {
    const khong = chipHienThi(doc(), khongJob).find((c) => c.khoa === "quiz");
    expect(khong.soLuong).toBeNull();

    const co = chipHienThi(doc({ ai: { quiz: { ready: true, count: 3 } } }), khongJob)
      .find((c) => c.khoa === "quiz");
    expect(co.soLuong).toBe(3);
  });

  it("chip không đếm được thì không có số", () => {
    const c = chipHienThi(doc(), khongJob).find((x) => x.khoa === "index");
    expect(c.soLuong).toBeNull();
  });
});
