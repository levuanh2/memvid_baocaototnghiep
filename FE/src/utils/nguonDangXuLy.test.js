// Audit vòng 8 FE#17 — tài liệu đang xử lý biến mất khi thu cột trái hoặc F5.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nguonConDangXuLy, nhoNguon, quenNguon } from "./nguonDangXuLy";

// Bộ test chạy trên node, không có jsdom — cùng khuôn với `auth/tokenStore.test.js`.
function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const realLS = globalThis.localStorage;
afterEach(() => { globalThis.localStorage = realLS; });

describe("nguonDangXuLy", () => {
  beforeEach(() => { globalThis.localStorage = memLocalStorage(); });

  it("nhớ được nguồn vừa upload để dựng lại thẻ sau F5", () => {
    nhoNguon({ sourceId: "s1", filename: "bai_giang.pdf" });
    const ds = nguonConDangXuLy();
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ sourceId: "s1", filename: "bai_giang.pdf" });
  });

  it("xử lý xong thì quên đi, không dựng lại thẻ ma", () => {
    nhoNguon({ sourceId: "s1", filename: "a.pdf" });
    nhoNguon({ sourceId: "s2", filename: "b.pdf" });
    quenNguon("s1");
    expect(nguonConDangXuLy().map((x) => x.sourceId)).toEqual(["s2"]);
  });

  it("nhớ lại cùng một nguồn không tạo bản trùng", () => {
    nhoNguon({ sourceId: "s1", filename: "a.pdf" });
    nhoNguon({ sourceId: "s1", filename: "a.pdf" });
    expect(nguonConDangXuLy()).toHaveLength(1);
  });

  it("quá hạn thì bỏ — máy tắt giữa chừng không để lại thẻ đứng mãi", () => {
    const luc = Date.now();
    nhoNguon({ sourceId: "s1", filename: "a.pdf" }, luc);
    expect(nguonConDangXuLy(luc + 60_000)).toHaveLength(1);
    expect(nguonConDangXuLy(luc + 7 * 60 * 60 * 1000)).toHaveLength(0);
  });

  it("localStorage hỏng hoặc rác thì trả rỗng, không ném", () => {
    localStorage.setItem("memvid.nguon_dang_xu_ly", "{khong-phai-json");
    expect(nguonConDangXuLy()).toEqual([]);
    localStorage.setItem("memvid.nguon_dang_xu_ly", '{"a":1}');
    expect(nguonConDangXuLy()).toEqual([]);
  });

  it("thiếu sourceId thì bỏ qua, không ghi rác", () => {
    nhoNguon({ sourceId: "", filename: "a.pdf" });
    nhoNguon({});
    expect(nguonConDangXuLy()).toEqual([]);
  });
});
