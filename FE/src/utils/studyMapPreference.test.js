import { describe, expect, it } from "vitest";

import { docPrefs, writeDocPref } from "./studyMapPreference";

/** localStorage giả — cùng khuôn với hooks/panelLayout.test.js. */
function fakeStorage({ throws = false } = {}) {
  const map = new Map();
  return {
    getItem: (k) => { if (throws) throw new Error("bi chan"); return map.get(k) ?? null; },
    setItem: (k, v) => { if (throws) throw new Error("het cho"); map.set(k, v); },
    _map: map,
  };
}

describe("studyMapPreference", () => {
  it("chưa lưu gì thì trả layout mặc định", () => {
    expect(docPrefs(fakeStorage(), "d1")).toEqual({ layout: "tree-horizontal" });
  });

  it("ghi rồi đọc lại đúng layout đã chọn", () => {
    const s = fakeStorage();
    writeDocPref(s, "d1", { layout: "tree-vertical" });
    expect(docPrefs(s, "d1")).toEqual({ layout: "tree-vertical" });
  });

  it("mỗi tài liệu có tuỳ chọn riêng, không lẫn nhau", () => {
    const s = fakeStorage();
    writeDocPref(s, "d1", { layout: "tree-vertical" });
    writeDocPref(s, "d2", { layout: "tree-curved" });
    expect(docPrefs(s, "d1").layout).toBe("tree-vertical");
    expect(docPrefs(s, "d2").layout).toBe("tree-curved");
  });

  it("ghi patch không xoá trường khác đã lưu của CÙNG tài liệu", () => {
    const s = fakeStorage();
    writeDocPref(s, "d1", { layout: "tree-vertical" });
    writeDocPref(s, "d1", { presentation: true });
    const raw = JSON.parse(s._map.get("memvidx.study_map.v1"));
    expect(raw.d1).toEqual({ layout: "tree-vertical", presentation: true });
  });

  it("giá trị layout hỏng/lạ trong storage rơi về mặc định, không ném", () => {
    const s = fakeStorage();
    s._map.set("memvidx.study_map.v1", JSON.stringify({ d1: { layout: "khong-ton-tai" } }));
    expect(docPrefs(s, "d1").layout).toBe("tree-horizontal");
  });

  it("JSON hỏng trong storage rơi về mặc định, không ném", () => {
    const s = fakeStorage();
    s._map.set("memvidx.study_map.v1", "{ khong phai json");
    expect(docPrefs(s, "d1")).toEqual({ layout: "tree-horizontal" });
  });

  it("storage ném lỗi (cửa sổ riêng tư) không làm vỡ đọc hay ghi", () => {
    const s = fakeStorage({ throws: true });
    expect(() => writeDocPref(s, "d1", { layout: "tree-vertical" })).not.toThrow();
    expect(docPrefs(s, "d1")).toEqual({ layout: "tree-horizontal" });
  });

  it("thiếu documentId thì không ghi gì, không ném", () => {
    const s = fakeStorage();
    expect(() => writeDocPref(s, null, { layout: "tree-vertical" })).not.toThrow();
    expect(s._map.size).toBe(0);
  });
});
