import { describe, expect, it } from "vitest";
import {
  QUERY_SSE_ERR_FALLBACK, stripInvisible, ensureErrMsg, pickQueryDisplayText, sseErrorToMessage,
} from "./queryText";

describe("stripInvisible", () => {
  it("bỏ ký tự zero-width/BOM, giữ chữ thường", () => {
    expect(stripInvisible("A​B﻿C")).toBe("ABC");
  });
  it("null/undefined -> chuỗi rỗng", () => {
    expect(stripInvisible(null)).toBe("");
    expect(stripInvisible(undefined)).toBe("");
  });
});

describe("ensureErrMsg", () => {
  it("có nội dung thật -> giữ nguyên (đã trim)", () => {
    expect(ensureErrMsg("  Lỗi thật  ")).toBe("Lỗi thật");
  });
  it("rỗng/toàn ký tự vô hình -> lùi về fallback truyền vào", () => {
    expect(ensureErrMsg("​​", "Dự phòng")).toBe("Dự phòng");
  });
  it("rỗng và fallback cũng rỗng -> mặc định chung", () => {
    expect(ensureErrMsg("", "")).toBe(QUERY_SSE_ERR_FALLBACK);
    expect(ensureErrMsg(null, null)).toBe(QUERY_SSE_ERR_FALLBACK);
  });
});

describe("pickQueryDisplayText", () => {
  it("ưu tiên streamedText nếu có", () => {
    expect(pickQueryDisplayText({ payload: { answer: "X" } }, "  Đã stream  ")).toBe("Đã stream");
  });
  it("không có stream -> payload.answer", () => {
    expect(pickQueryDisplayText({ payload: { answer: "Trả lời" } }, "")).toBe("Trả lời");
  });
  it("không có answer -> payload.error", () => {
    expect(pickQueryDisplayText({ payload: { error: "Hỏng" } }, "")).toBe("Hỏng");
  });
  it("không có payload -> jobResult.answer trực tiếp", () => {
    expect(pickQueryDisplayText({ answer: "Trực tiếp" }, "")).toBe("Trực tiếp");
  });
  it("không có gì cả -> chuỗi rỗng", () => {
    expect(pickQueryDisplayText(null, "")).toBe("");
    expect(pickQueryDisplayText({}, undefined)).toBe("");
  });
});

describe("sseErrorToMessage", () => {
  it("chuỗi thật -> giữ nguyên đã trim/dọn ký tự vô hình", () => {
    expect(sseErrorToMessage("  Lỗi SSE​  ")).toBe("Lỗi SSE");
  });
  it("số/boolean -> ép chuỗi", () => {
    expect(sseErrorToMessage(404)).toBe("404");
    expect(sseErrorToMessage(false)).toBe("false");
  });
  it("null hoặc object lạ -> fallback", () => {
    expect(sseErrorToMessage(null, "Dự phòng")).toBe("Dự phòng");
    expect(sseErrorToMessage({ weird: true }, "Dự phòng")).toBe("Dự phòng");
  });
});
