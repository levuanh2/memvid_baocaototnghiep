import { describe, expect, it } from "vitest";
import { danhSachHanhDong, xayRecap } from "./tutorActions";
import { TRANG_THAI_RONG } from "./tutorMemory";

const CTX_RONG = { selectedDocument: null, selectedTopic: null, selectedEntity: null };

describe("tutorActions — danhSachHanhDong (thuần)", () => {
  it("chưa chọn tài liệu → cả năm nút đều tắt", () => {
    const ds = danhSachHanhDong(CTX_RONG);
    expect(ds).toHaveLength(5);
    expect(ds.every((a) => a.enabled === false)).toBe(true);
  });

  it("đã chọn tài liệu, chưa chọn tiêu điểm → prompt dùng bản chung", () => {
    const ds = danhSachHanhDong({ selectedDocument: "doc-1", selectedTopic: null, selectedEntity: null });
    expect(ds.every((a) => a.enabled === true)).toBe(true);
    const explain = ds.find((a) => a.key === "explain");
    expect(explain.prompt).toBe("Giải thích ý chính của tài liệu này, dễ hiểu, có ví dụ.");
  });

  it("có thực thể → tiêu điểm ưu tiên thực thể hơn chủ đề, prompt nhắc đúng tên", () => {
    const ds = danhSachHanhDong({ selectedDocument: "doc-1", selectedTopic: "Định thời", selectedEntity: "CPU" });
    expect(ds.find((a) => a.key === "explain").prompt).toContain('"CPU"');
    expect(ds.find((a) => a.key === "quiz").prompt).toContain('"CPU"');
  });

  it("mindmap/summary là lệnh mở tab artifact, không phải prompt chat", () => {
    const ds = danhSachHanhDong({ selectedDocument: "doc-1" });
    expect(ds.find((a) => a.key === "mindmap")).toMatchObject({ artifact: "mindmap" });
    expect(ds.find((a) => a.key === "summary")).toMatchObject({ artifact: "summary" });
  });
});

describe("tutorActions — xayRecap (thuần)", () => {
  it("phiên chưa xem gì → null (không hiện nút)", () => {
    expect(xayRecap(TRANG_THAI_RONG)).toBeNull();
    expect(xayRecap(null)).toBeNull();
  });

  it("có dữ liệu → gộp đúng ba nhóm theo thứ tự chủ đề/khái niệm/câu hỏi", () => {
    const mem = {
      openedTopics: [{ value: "Định thời" }],
      selectedEntities: [{ value: "CPU" }],
      recentQuestions: [{ id: "q1", text: "CPU là gì?" }],
    };
    const recap = xayRecap(mem);
    expect(recap).toContain("chủ đề đã xem: Định thời");
    expect(recap).toContain("khái niệm đã xem: CPU");
    expect(recap).toContain("câu hỏi đã hỏi: CPU là gì?");
  });

  it("chỉ có một nhóm vẫn ra câu hợp lệ, không có dấu · thừa", () => {
    const recap = xayRecap({ openedTopics: [{ value: "X" }], selectedEntities: [], recentQuestions: [] });
    expect(recap).toContain("chủ đề đã xem: X");
    expect(recap).not.toContain("·");
  });
});
