import { describe, expect, it } from "vitest";

import {
  chonDoc, chonEntity, chonNode, chonQuestion, chonSummary, chonTopic,
  datLearningMode, TRANG_THAI_RONG, xoaLuaChon,
} from "./studySelection";

describe("studySelection — trạng thái CHỌN dùng chung, thuần, không React", () => {
  it("trạng thái rỗng có đủ bảy trường, không trường nào khác", () => {
    expect(TRANG_THAI_RONG).toEqual({
      selectedDocument: null, selectedTopic: null, selectedEntity: null,
      selectedSummary: null, selectedNode: null, selectedQuestion: null,
      learningMode: null,
    });
  });

  it("mỗi hàm chọn chỉ đổi ĐÚNG một trường, giữ nguyên state gốc (bất biến)", () => {
    const s0 = TRANG_THAI_RONG;
    const s1 = chonDoc(s0, "doc-1");
    expect(s1).not.toBe(s0);
    expect(s0.selectedDocument).toBeNull();          // gốc không bị sửa
    expect(s1).toEqual({ ...TRANG_THAI_RONG, selectedDocument: "doc-1" });

    const s2 = chonTopic(s1, "Định thời");
    expect(s2).toEqual({ ...s1, selectedTopic: "Định thời" });

    const s3 = chonEntity(s2, "CPU");
    expect(s3).toEqual({ ...s2, selectedEntity: "CPU" });

    const s4 = chonSummary(s3, "s2");
    expect(s4).toEqual({ ...s3, selectedSummary: "s2" });

    const s5 = chonNode(s4, "node-7");
    expect(s5).toEqual({ ...s4, selectedNode: "node-7" });

    const s6 = chonQuestion(s5, "explain-cpu");
    expect(s6).toEqual({ ...s5, selectedQuestion: "explain-cpu" });

    const s7 = datLearningMode(s6, "tutor");
    expect(s7).toEqual({ ...s6, learningMode: "tutor" });
  });

  it("đổi selectedDocument xoá MỌI lựa chọn khác của tài liệu cũ, GIỮ learningMode", () => {
    const truoc = {
      selectedDocument: "doc-1", selectedTopic: "Định thời", selectedEntity: "CPU",
      selectedSummary: "s2", selectedNode: "node-7", selectedQuestion: "explain-cpu",
      learningMode: "reader",
    };
    const sau = chonDoc(truoc, "doc-2");
    expect(sau).toEqual({ ...TRANG_THAI_RONG, selectedDocument: "doc-2", learningMode: "reader" });
  });

  it("chọn LẠI cùng tài liệu là no-op (không tạo object mới, không xoá lựa chọn hiện có)", () => {
    const truoc = { ...TRANG_THAI_RONG, selectedDocument: "doc-1", selectedTopic: "X" };
    expect(chonDoc(truoc, "doc-1")).toBe(truoc);
  });

  it("xoaLuaChon chỉ xoá đúng khoá được yêu cầu, không đụng selectedDocument/learningMode", () => {
    const truoc = {
      selectedDocument: "doc-1", selectedTopic: "X", selectedEntity: "Y",
      selectedSummary: "s1", selectedNode: "n1", selectedQuestion: "q1",
      learningMode: "focus",
    };
    expect(xoaLuaChon(truoc, "selectedTopic")).toEqual({ ...truoc, selectedTopic: null });
    expect(xoaLuaChon(truoc, "selectedDocument")).toBe(truoc);   // bảo vệ, không xoá
    expect(xoaLuaChon(truoc, "learningMode")).toBe(truoc);       // bảo vệ, không xoá
    expect(xoaLuaChon(truoc, "khong-ton-tai")).toBe(truoc);      // khoá lạ → no-op
  });
});
