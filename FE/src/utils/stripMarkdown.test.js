import { describe, expect, it } from "vitest";
import { stripMarkdown } from "./stripMarkdown";

describe("stripMarkdown", () => {
  it("removes bold markers, keeps the text", () => {
    expect(stripMarkdown("**Định nghĩa quan trọng**")).toBe("Định nghĩa quan trọng");
  });

  it("removes mammoth-style double-underscore bold", () => {
    expect(stripMarkdown("__Cảnh báo__")).toBe("Cảnh báo");
  });

  it("removes heading markers", () => {
    expect(stripMarkdown("## Tiêu đề")).toBe("Tiêu đề");
    expect(stripMarkdown("### 1.1 Chi tiết")).toBe("1.1 Chi tiết");
  });

  it("removes raw HTML tags without dropping their text content", () => {
    expect(stripMarkdown("<li>Mục danh sách</li>")).toBe("Mục danh sách");
    expect(stripMarkdown("<strong>Nhấn mạnh</strong>")).toBe("Nhấn mạnh");
  });

  it("removes inline code backticks", () => {
    expect(stripMarkdown("Dùng `git status` để xem")).toBe("Dùng git status để xem");
  });

  it("keeps link text, drops the URL", () => {
    expect(stripMarkdown("Xem [tài liệu](https://example.com)")).toBe("Xem tài liệu");
  });

  it("removes list markers at line start", () => {
    expect(stripMarkdown("- Mục một")).toBe("Mục một");
  });

  it("handles mixed markdown in one string", () => {
    expect(stripMarkdown("## **Tiêu đề** với `code` và [link](x)")).toBe("Tiêu đề với code và link");
  });

  it("collapses internal whitespace/newlines from removed markers", () => {
    expect(stripMarkdown("Dòng một\n\nDòng hai")).toBe("Dòng một Dòng hai");
  });

  it("is a safe no-op on plain text", () => {
    expect(stripMarkdown("Văn bản bình thường không có ký hiệu gì")).toBe(
      "Văn bản bình thường không có ký hiệu gì"
    );
  });

  it("never throws on null/undefined/empty", () => {
    expect(stripMarkdown(null)).toBe("");
    expect(stripMarkdown(undefined)).toBe("");
    expect(stripMarkdown("")).toBe("");
  });
});
