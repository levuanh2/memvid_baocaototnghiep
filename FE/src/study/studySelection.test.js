import { describe, expect, it } from "vitest";

import {
  chonDoc, chonEntity, chonNode, chonQuestion, chonSummary, chonTopic,
  datLearningMode, SELECTION_SOURCES, TRANG_THAI_RONG, xoaLuaChon,
} from "./studySelection";

const GIO = Date.parse("2026-09-10T12:00:00Z");

describe("studySelection — trạng thái CHỌN dùng chung, thuần, không React", () => {
  it("trạng thái rỗng có đủ chín trường, không trường nào khác", () => {
    expect(TRANG_THAI_RONG).toEqual({
      selectedDocument: null, selectedTopic: null, selectedEntity: null,
      selectedSummary: null, selectedNode: null, selectedQuestion: null,
      learningMode: null, selectionSource: null, timestamp: null,
    });
  });

  it("mỗi hàm chọn đổi đúng MỘT trường nội dung, cộng selectionSource+timestamp, giữ nguyên state gốc", () => {
    const s0 = TRANG_THAI_RONG;
    const s1 = chonDoc(s0, "doc-1", { source: "mindmap", now: GIO });
    expect(s1).not.toBe(s0);
    expect(s0.selectedDocument).toBeNull();          // gốc không bị sửa
    expect(s1).toEqual({
      ...TRANG_THAI_RONG, selectedDocument: "doc-1", selectionSource: "mindmap", timestamp: GIO,
    });

    const s2 = chonTopic(s1, "Định thời", { source: "knowledge", now: GIO + 1 });
    expect(s2).toEqual({ ...s1, selectedTopic: "Định thời", selectionSource: "knowledge", timestamp: GIO + 1 });

    const s3 = chonEntity(s2, "CPU", { source: "summary", now: GIO + 2 });
    expect(s3).toEqual({ ...s2, selectedEntity: "CPU", selectionSource: "summary", timestamp: GIO + 2 });

    const s4 = chonSummary(s3, "s2", { source: "summary", now: GIO + 3 });
    expect(s4).toEqual({ ...s3, selectedSummary: "s2", selectionSource: "summary", timestamp: GIO + 3 });

    const s5 = chonNode(s4, "node-7", { source: "mindmap", now: GIO + 4 });
    expect(s5).toEqual({ ...s4, selectedNode: "node-7", selectionSource: "mindmap", timestamp: GIO + 4 });

    const s6 = chonQuestion(s5, "explain-cpu", { source: "question", now: GIO + 5 });
    expect(s6).toEqual({ ...s5, selectedQuestion: "explain-cpu", selectionSource: "question", timestamp: GIO + 5 });

    // learningMode KHÔNG phải một "lựa chọn nội dung" — không đụng selectionSource/timestamp.
    const s7 = datLearningMode(s6, "tutor");
    expect(s7).toEqual({ ...s6, learningMode: "tutor" });
  });

  it("thiếu opts (source/now) thì source = null, timestamp = thời điểm gọi thật (Date.now())", () => {
    const truoc = Date.now();
    const sau = chonTopic(TRANG_THAI_RONG, "X");
    expect(sau.selectionSource).toBeNull();
    expect(sau.timestamp).toBeGreaterThanOrEqual(truoc);
  });

  it("SELECTION_SOURCES liệt kê đúng năm bề mặt, không thiếu không thừa", () => {
    expect(SELECTION_SOURCES).toEqual([
      "mindmap", "summary", "knowledge", "question", "continue_learning",
    ]);
  });

  it("đổi selectedDocument xoá MỌI lựa chọn khác của tài liệu cũ, GIỮ learningMode, VẪN đóng dấu source/timestamp cho chính nó", () => {
    const truoc = {
      selectedDocument: "doc-1", selectedTopic: "Định thời", selectedEntity: "CPU",
      selectedSummary: "s2", selectedNode: "node-7", selectedQuestion: "explain-cpu",
      learningMode: "reader", selectionSource: "knowledge", timestamp: GIO - 100,
    };
    const sau = chonDoc(truoc, "doc-2", { source: "mindmap", now: GIO });
    expect(sau).toEqual({
      ...TRANG_THAI_RONG, selectedDocument: "doc-2", learningMode: "reader",
      selectionSource: "mindmap", timestamp: GIO,
    });
  });

  it("chọn LẠI cùng tài liệu là no-op (không tạo object mới, không đổi source/timestamp cũ)", () => {
    const truoc = { ...TRANG_THAI_RONG, selectedDocument: "doc-1", selectedTopic: "X" };
    expect(chonDoc(truoc, "doc-1", { source: "mindmap", now: GIO })).toBe(truoc);
  });

  it("xoaLuaChon chỉ xoá đúng khoá được yêu cầu, không đụng selectedDocument/learningMode/selectionSource/timestamp", () => {
    const truoc = {
      selectedDocument: "doc-1", selectedTopic: "X", selectedEntity: "Y",
      selectedSummary: "s1", selectedNode: "n1", selectedQuestion: "q1",
      learningMode: "focus", selectionSource: "summary", timestamp: GIO,
    };
    expect(xoaLuaChon(truoc, "selectedTopic")).toEqual({ ...truoc, selectedTopic: null });
    expect(xoaLuaChon(truoc, "selectedDocument")).toBe(truoc);   // bảo vệ, không xoá
    expect(xoaLuaChon(truoc, "learningMode")).toBe(truoc);       // bảo vệ, không xoá
    expect(xoaLuaChon(truoc, "selectionSource")).toBe(truoc);    // bảo vệ, không xoá qua đây
    expect(xoaLuaChon(truoc, "khong-ton-tai")).toBe(truoc);      // khoá lạ → no-op
  });
});
