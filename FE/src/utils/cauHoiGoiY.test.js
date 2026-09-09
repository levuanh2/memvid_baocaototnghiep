import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  bieuTuongDanhMuc, DANH_MUC, duongDiCauHoi, nhanDanhMuc, nhomTheoDanhMuc,
  trangThaiRongCauHoi,
} from "./cauHoiGoiY";

const NHAN = [
  "Giải thích", "Định nghĩa", "Tóm tắt", "Kiểm tra tôi", "So sánh", "Trình tự",
  "Cấu trúc", "Cách hoạt động", "Ưu & nhược",
];
const DOC = { document_id: "doc id", source_stem: "Nguồn học", ai: { quiz: { latest_quiz_id: "quiz id" } } };
const QUESTIONS = [
  { id: "a", category: "Explain", text: "Giải thích A", target: "chat", reason: { source: "topic", value: "A" }, confidence: 1 },
  { id: "b", category: "QuizMe", text: "Kiểm tra A", target: "quiz", reason: { source: "weak_mastery", value: "A" }, confidence: 0.8 },
  { id: "c", category: "Explain", text: "Giải thích B", target: "chat", reason: { source: "topic", value: "B" }, confidence: 0.6 },
  { id: "d", category: "Architecture", text: "Liên hệ A", target: "studymap", reason: { source: "relation", value: "supports" }, confidence: 0.5 },
];

function registryIcons() {
  const source = readFileSync(new URL("../components/ui/Icon.jsx", import.meta.url), "utf8");
  const match = source.match(/const ICONS = \{([\s\S]*?)\n\};/);
  return new Set(match[1].match(/\b[A-Z][A-Za-z0-9]*\b/g));
}

describe("câu hỏi gợi ý", () => {
  it("labels all nine categories and preserves an unknown raw value", () => {
    expect(DANH_MUC.map(nhanDanhMuc)).toEqual(NHAN);
    expect(nhanDanhMuc("Other")).toBe("Other");
    expect(nhanDanhMuc(null)).toBe("");
  });

  it("uses only icons registered by the real Icon registry", () => {
    const registered = registryIcons();
    for (const category of [...DANH_MUC, "Other", null]) {
      expect(registered.has(bieuTuongDanhMuc(category))).toBe(true);
    }
  });

  it("groups in backend first-seen order, preserves question order, and omits empties", () => {
    const groups = nhomTheoDanhMuc(QUESTIONS);
    expect(groups.map((group) => group.category)).toEqual(["Explain", "QuizMe", "Architecture"]);
    expect(groups[0].cauHoi.map((question) => question.id)).toEqual(["a", "c"]);
    expect(groups.some((group) => group.category === "Compare")).toBe(false);
  });

  it("routes all valid targets through duongDi and rejects invalid targets", () => {
    expect(duongDiCauHoi({ target: "chat" }, DOC)).toBe("/app?source=Ngu%E1%BB%93n%20h%E1%BB%8Dc");
    expect(duongDiCauHoi({ target: "quiz" }, DOC)).toBe("/app/study/quiz/quiz%20id");
    expect(duongDiCauHoi({ target: "studymap" }, DOC)).toBe("/app/study/map/doc%20id");
    expect(duongDiCauHoi({ target: "other" }, DOC)).toBeNull();
    expect(duongDiCauHoi({ target: "chat" }, null)).toBeNull();
  });

  it("distinguishes loading, genuinely empty, and populated states", () => {
    expect(trangThaiRongCauHoi([], { dangTai: true }).loai).toBe("dang_tai");
    const empty = trangThaiRongCauHoi(null);
    expect(empty.loai).toBe("rong");
    expect(empty.goiY).toContain("lập chỉ mục");
    expect(trangThaiRongCauHoi(QUESTIONS).loai).toBe("co");
  });

  it("tolerates null and malformed inputs on every function", () => {
    expect(nhomTheoDanhMuc(null)).toEqual([]);
    expect(nhomTheoDanhMuc([null, "bad", {}])).toEqual([]);
    expect(duongDiCauHoi(null, DOC)).toBeNull();
    expect(trangThaiRongCauHoi({}).loai).toBe("rong");
  });

  it("returns new data without mutating question arrays or nested reasons", () => {
    const before = JSON.stringify(QUESTIONS);
    const groups = nhomTheoDanhMuc(QUESTIONS);
    groups[0].cauHoi[0].reason.value = "changed";
    expect(JSON.stringify(QUESTIONS)).toBe(before);
  });
});
