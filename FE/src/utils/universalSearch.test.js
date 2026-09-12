import { describe, expect, it } from "vitest";
import { normalize, tokenize, score, match, sort, DIEM, lyDoKhop } from "./universalSearch";

const doc = (over) => ({
  document_id: "d1", display_name: null, title: "Tài liệu",
  knowledge: { topics: [], entities: [] }, tags: [], ...over,
});

describe("normalize / tokenize", () => {
  it("bỏ dấu tiếng Việt, kể cả đ", () => {
    expect(normalize("Định thời CPU")).toBe("dinh thoi cpu");
  });
  it("tokenize chuẩn hoá rồi tách theo khoảng trắng", () => {
    expect(tokenize("  Hệ  Điều Hành ")).toEqual(["he", "dieu", "hanh"]);
  });
});

describe("score — thứ tự xếp hạng đúng đặc tả", () => {
  it("khớp đúng tiêu đề > khớp đầu > khớp giữa", () => {
    const dung = doc({ title: "Linux" });
    const dau = doc({ title: "Linux Kernel" });
    const giua = doc({ title: "Giới thiệu Linux" });
    expect(score(dung, ["linux"]).hang).toBe("TIEU_DE_DUNG");
    expect(score(dau, ["linux"]).hang).toBe("TIEU_DE_DAU");
    expect(score(giua, ["linux"]).hang).toBe("TIEU_DE_CHUA");
    expect(score(dung, ["linux"]).diem).toBeGreaterThan(score(dau, ["linux"]).diem);
    expect(score(dau, ["linux"]).diem).toBeGreaterThan(score(giua, ["linux"]).diem);
  });

  it("chủ đề > thực thể > thẻ > bộ sưu tập > meta AI", () => {
    const chuDe = doc({ knowledge: { topics: [{ name: "CPU" }], entities: [] } });
    const thucThe = doc({ knowledge: { topics: [], entities: ["CPU"] } });
    const the = doc({ tags: ["cpu"] });
    const meta = doc({ ai: { summary: { preview: "nói về cpu" } } });
    expect(score(chuDe, ["cpu"]).hang).toBe("CHU_DE");
    expect(score(thucThe, ["cpu"]).hang).toBe("THUC_THE");
    expect(score(the, ["cpu"]).hang).toBe("THE");
    expect(score(meta, ["cpu"]).hang).toBe("META_AI");
    expect(score(chuDe, ["cpu"]).diem).toBeGreaterThan(score(thucThe, ["cpu"]).diem);
    expect(score(thucThe, ["cpu"]).diem).toBeGreaterThan(score(the, ["cpu"]).diem);
    expect(score(the, ["cpu"]).diem).toBeGreaterThan(score(meta, ["cpu"]).diem);
  });

  it("bộ sưu tập cần opts.tenBoSuuTap", () => {
    const d = doc({ collection_id: "c1" });
    expect(score(d, ["dieu"], { tenBoSuuTap: "Hệ điều hành" }).hang).toBe("BO_SUU_TAP");
    expect(score(d, ["dieu"], {})).toBeNull();
  });

  it("nhiều từ là AND — thiếu một từ là loại (null)", () => {
    const d = doc({ title: "Hệ điều hành", knowledge: { topics: [{ name: "CPU" }], entities: [] } });
    expect(score(d, ["he", "cpu"])).not.toBeNull();
    expect(score(d, ["he", "khongco"])).toBeNull();
  });

  it("hạng cao nhất thắng khi một token khớp nhiều trường", () => {
    // "linux" khớp cả tiêu đề (contains) lẫn chủ đề — phải lấy tiêu đề (cao hơn).
    const d = doc({ title: "Giới thiệu Linux", knowledge: { topics: [{ name: "Linux" }], entities: [] } });
    expect(score(d, ["linux"]).hang).toBe("TIEU_DE_CHUA");
  });

  it("truy vấn rỗng -> null", () => {
    expect(score(doc(), [])).toBeNull();
  });
});

describe("match", () => {
  it("true/false đúng theo score", () => {
    expect(match(doc({ title: "Linux" }), ["linux"])).toBe(true);
    expect(match(doc({ title: "Linux" }), ["windows"])).toBe(false);
  });
});

describe("sort", () => {
  it("điểm cao trước", () => {
    const a = { doc: doc({ document_id: "a" }), diem: DIEM.THE };
    const b = { doc: doc({ document_id: "b" }), diem: DIEM.TIEU_DE_DUNG };
    expect(sort([a, b]).map((x) => x.doc.document_id)).toEqual(["b", "a"]);
  });
  it("đồng điểm -> mở gần đây hơn trước", () => {
    const a = { doc: doc({ document_id: "a", last_opened_at: "2026-01-01T00:00:00Z" }), diem: 50 };
    const b = { doc: doc({ document_id: "b", last_opened_at: "2026-02-01T00:00:00Z" }), diem: 50 };
    expect(sort([a, b]).map((x) => x.doc.document_id)).toEqual(["b", "a"]);
  });
  it("đồng điểm, đồng mốc mở -> A-Z", () => {
    const a = { doc: doc({ document_id: "a", title: "Zebra" }), diem: 50 };
    const b = { doc: doc({ document_id: "b", title: "Apple" }), diem: 50 };
    expect(sort([a, b]).map((x) => x.doc.document_id)).toEqual(["b", "a"]);
  });
  it("không sửa mảng gốc", () => {
    const arr = [{ doc: doc(), diem: 1 }, { doc: doc(), diem: 2 }];
    const ra = sort(arr);
    expect(ra).not.toBe(arr);
  });
});

describe("lyDoKhop", () => {
  it("trả nhãn tiếng Việt cho mọi hạng đã định nghĩa", () => {
    for (const hang of Object.keys(DIEM)) expect(lyDoKhop(hang)).toBeTruthy();
  });
  it("hạng lạ -> nhãn mặc định, không throw", () => {
    expect(lyDoKhop("KHONG_TON_TAI")).toBe("Khớp");
  });
});
