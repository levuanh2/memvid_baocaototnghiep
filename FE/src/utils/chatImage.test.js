import { describe, it, expect } from "vitest";
import {
  pickImageFromClipboard,
  imageFileName,
  buildQuestionWithImage,
  IMAGE_TYPES,
} from "./chatImage";

const clip = (items) => ({ items });
const fileItem = (type, file) => ({ kind: "file", type, getAsFile: () => file });

describe("pickImageFromClipboard", () => {
  it("lấy ảnh đầu tiên trong clipboard", () => {
    const png = { name: "", type: "image/png" };
    const data = clip([
      { kind: "string", type: "text/plain", getAsFile: () => null },
      fileItem("image/png", png),
    ]);
    expect(pickImageFromClipboard(data)).toBe(png);
  });

  it("dán chữ thường thì trả null để trình duyệt xử lý như cũ", () => {
    const data = clip([{ kind: "string", type: "text/plain", getAsFile: () => null }]);
    expect(pickImageFromClipboard(data)).toBeNull();
  });

  it("bỏ qua file không phải ảnh", () => {
    const data = clip([fileItem("application/pdf", { name: "a.pdf" })]);
    expect(pickImageFromClipboard(data)).toBeNull();
  });

  it("không nổ khi clipboard rỗng hoặc thiếu", () => {
    expect(pickImageFromClipboard(null)).toBeNull();
    expect(pickImageFromClipboard({})).toBeNull();
    expect(pickImageFromClipboard(clip([]))).toBeNull();
  });

  it("bỏ qua item khai là ảnh nhưng không trả được file", () => {
    const data = clip([{ kind: "file", type: "image/png", getAsFile: () => null }]);
    expect(pickImageFromClipboard(data)).toBeNull();
  });
});

describe("imageFileName", () => {
  it("giữ tên thật khi có đuôi", () => {
    expect(imageFileName({ name: "de-bai.png", type: "image/png" })).toBe("de-bai.png");
  });

  it("ảnh dán không có tên thì sinh tên theo kiểu MIME", () => {
    expect(imageFileName({ name: "", type: "image/jpeg" })).toBe("anh-dan.jpg");
    expect(imageFileName({ name: "", type: "image/png" })).toBe("anh-dan.png");
  });

  it("kiểu lạ vẫn ra đuôi png để backend không trả 415", () => {
    expect(imageFileName({ name: "", type: "image/webp" })).toBe("anh-dan.png");
    expect(imageFileName(null)).toBe("anh-dan.png");
  });

  it("tên không có dấu chấm bị coi là thiếu đuôi", () => {
    expect(imageFileName({ name: "screenshot", type: "image/png" })).toBe("anh-dan.png");
  });
});

describe("buildQuestionWithImage", () => {
  it("ghép chữ đọc được xuống dưới câu hỏi, có nhãn rõ", () => {
    const q = buildQuestionWithImage("Câu này giải sao?", "Bài tập 3\nf(x) = x^2");
    expect(q.startsWith("Câu này giải sao?")).toBe(true);
    expect(q).toContain("[Nội dung đọc được từ ảnh đính kèm]");
    expect(q).toContain("f(x) = x^2");
  });

  it("không gõ gì thì tự sinh câu hỏi, tránh gửi q rỗng (400)", () => {
    const q = buildQuestionWithImage("   ", "Bài tập 3");
    expect(q.startsWith("Giải thích nội dung trong ảnh này.")).toBe(true);
    expect(q).toContain("Bài tập 3");
  });

  it("không có ảnh thì trả nguyên câu hỏi, không thêm nhãn", () => {
    expect(buildQuestionWithImage("Đạo hàm là gì?", "")).toBe("Đạo hàm là gì?");
    expect(buildQuestionWithImage("Đạo hàm là gì?", null)).toBe("Đạo hàm là gì?");
  });

  it("cả hai đều rỗng thì trả chuỗi rỗng — nút gửi đã chặn từ trước", () => {
    expect(buildQuestionWithImage("", "")).toBe("");
  });
});

describe("IMAGE_TYPES", () => {
  it("khớp formats.IMAGE của backend, lệch là 415", () => {
    expect(IMAGE_TYPES).toEqual(["image/png", "image/jpeg", "image/gif", "image/bmp"]);
  });
});
