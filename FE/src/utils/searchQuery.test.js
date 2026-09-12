import { describe, expect, it } from "vitest";
import { parseQuery, laTruyVanNangCao, evalQuery } from "./searchQuery";

const doc = (over) => ({
  document_id: "d1", title: "CPU và bộ nhớ", knowledge: { topics: [], entities: [] },
  tags: [], ai: {}, ...over,
});

describe("laTruyVanNangCao", () => {
  it("có AND/OR/NOT -> nâng cao", () => {
    expect(laTruyVanNangCao("cpu AND linux")).toBe(true);
    expect(laTruyVanNangCao("cpu OR gpu")).toBe(true);
    expect(laTruyVanNangCao("NOT archived")).toBe(true);
  });
  it("có field:value -> nâng cao", () => {
    expect(laTruyVanNangCao("topic:cpu")).toBe(true);
    expect(laTruyVanNangCao('has:summary')).toBe(true);
  });
  it("truy vấn tự nhiên thường -> không nâng cao", () => {
    expect(laTruyVanNangCao("cpu linux")).toBe(false);
    expect(laTruyVanNangCao("")).toBe(false);
  });
});

describe("parseQuery", () => {
  it("chỉ chữ thường -> một nhóm OR, mỗi từ một điều khoản", () => {
    const cay = parseQuery("cpu linux");
    expect(cay).toEqual([[{ negate: false, field: null, value: "cpu" }, { negate: false, field: null, value: "linux" }]]);
  });

  it("OR tách thành nhiều nhóm", () => {
    const cay = parseQuery("cpu OR gpu");
    expect(cay).toHaveLength(2);
    expect(cay[0]).toEqual([{ negate: false, field: null, value: "cpu" }]);
    expect(cay[1]).toEqual([{ negate: false, field: null, value: "gpu" }]);
  });

  it('field:"giá trị có khoảng trắng"', () => {
    const cay = parseQuery('topic:"dinh thoi"');
    expect(cay[0][0]).toMatchObject({ field: "topic", value: "dinh thoi" });
  });

  it("field bare word", () => {
    const cay = parseQuery("tag:important");
    expect(cay[0][0]).toMatchObject({ field: "tag", value: "important" });
  });

  it("field không hợp lệ -> coi như chữ thường", () => {
    const cay = parseQuery("khongco:x");
    expect(cay[0][0]).toMatchObject({ field: null });
  });

  it("NOT phủ định điều khoản theo sau", () => {
    const cay = parseQuery("NOT tag:archived");
    expect(cay[0][0]).toMatchObject({ field: "tag", value: "archived", negate: true });
  });

  it("tiền tố - cũng phủ định", () => {
    const cay = parseQuery("-tag:archived");
    expect(cay[0][0]).toMatchObject({ negate: true });
  });

  it("AND ngầm định bị bỏ qua như từ khoá, không thành điều khoản", () => {
    const cay = parseQuery("cpu AND linux");
    expect(cay).toEqual([[{ negate: false, field: null, value: "cpu" }, { negate: false, field: null, value: "linux" }]]);
  });
});

describe("evalQuery", () => {
  it("has:summary khớp tài liệu có tóm tắt sẵn sàng", () => {
    const d = doc({ ai: { summary: { state: "ready" } } });
    const cay = parseQuery("has:summary");
    expect(evalQuery(d, cay)).not.toBeNull();
    expect(evalQuery(doc(), cay)).toBeNull();
  });

  it("favorite:true / archived:false", () => {
    const d = doc({ favorite: true, archived_at: null });
    expect(evalQuery(d, parseQuery("favorite:true"))).not.toBeNull();
    expect(evalQuery(d, parseQuery("archived:false"))).not.toBeNull();
    expect(evalQuery(d, parseQuery("archived:true"))).toBeNull();
  });

  it("topic:\"X\" AND entity:\"Y\" NOT tag:archived", () => {
    const d = doc({
      knowledge: { topics: [{ name: "Định thời" }], entities: ["CPU"] },
      tags: [],
    });
    const cay = parseQuery('topic:"dinh thoi" entity:"CPU" NOT tag:archived');
    expect(evalQuery(d, cay)).not.toBeNull();
    const dArchived = { ...d, tags: ["archived"] };
    expect(evalQuery(dArchived, cay)).toBeNull();
  });

  it("OR — khớp MỘT trong hai nhóm là đủ", () => {
    const cay = parseQuery("topic:cpu OR topic:gpu");
    expect(evalQuery(doc({ knowledge: { topics: [{ name: "GPU" }], entities: [] } }), cay)).not.toBeNull();
  });

  it("không khớp nhóm nào -> null", () => {
    const cay = parseQuery("topic:khongton");
    expect(evalQuery(doc(), cay)).toBeNull();
  });

  it("chữ thường trộn với field vẫn AND đúng, điểm lấy từ hạng chữ thường", () => {
    const d = doc({ title: "Linux" });
    const cay = parseQuery("linux favorite:false");
    const kq = evalQuery(d, cay);
    expect(kq).not.toBeNull();
    expect(kq.hang).toBe("TIEU_DE_DUNG");
  });

  it("toàn field:value -> điểm bậc DIEU_KIEN", () => {
    const d = doc({ favorite: true });
    const kq = evalQuery(d, parseQuery("favorite:true"));
    expect(kq.hang).toBe("DIEU_KIEN");
  });

  it("collection: cần opts.tenBoSuuTap truyền vào", () => {
    const d = doc({ collection_id: "c1" });
    const cay = parseQuery('collection:"He dieu hanh"');
    expect(evalQuery(d, cay, { tenBoSuuTap: "Hệ điều hành" })).not.toBeNull();
    expect(evalQuery(d, cay, {})).toBeNull();
  });
});
