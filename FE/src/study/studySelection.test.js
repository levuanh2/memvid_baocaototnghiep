import { describe, expect, it } from "vitest";

import {
  chonDoc, chonEntity, chonEvidence, chonNode, chonQuestion, chonSummary, chonTopic,
  datLearningMode, HISTORY_KINDS, SELECTION_SOURCES, TRANG_THAI_RONG, xoaLichSu, xoaLuaChon,
} from "./studySelection";

const GIO = Date.parse("2026-09-10T12:00:00Z");

describe("studySelection — trạng thái CHỌN dùng chung, thuần, không React", () => {
  it("trạng thái rỗng có đủ mười một trường, không trường nào khác", () => {
    expect(TRANG_THAI_RONG).toEqual({
      selectedDocument: null, selectedTopic: null, selectedEntity: null,
      selectedSummary: null, selectedNode: null, selectedQuestion: null, selectedEvidence: null,
      learningMode: null, selectionSource: null, timestamp: null, history: [],
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
    expect(s2).toEqual({
      ...s1, selectedTopic: "Định thời", selectionSource: "knowledge", timestamp: GIO + 1,
      history: [{ kind: "topic", id: "Định thời", label: "Định thời", source: "knowledge", at: GIO + 1 }],
    });

    const s3 = chonEntity(s2, "CPU", { source: "summary", now: GIO + 2 });
    expect(s3.selectedEntity).toBe("CPU");
    expect(s3.history).toHaveLength(2);
    expect(s3.history[1]).toEqual({ kind: "entity", id: "CPU", label: "CPU", source: "summary", at: GIO + 2 });

    const s4 = chonSummary(s3, "s2", { source: "summary", now: GIO + 3 });
    expect(s4.selectedSummary).toBe("s2");
    expect(s4.history).toHaveLength(3);

    const s5 = chonNode(s4, "node-7", { source: "mindmap", now: GIO + 4, label: "Kiến trúc CPU" });
    expect(s5.selectedNode).toBe("node-7");
    expect(s5.history[3]).toEqual({ kind: "node", id: "node-7", label: "Kiến trúc CPU", source: "mindmap", at: GIO + 4 });

    const s6 = chonQuestion(s5, "explain-cpu", { source: "question", now: GIO + 5 });
    expect(s6.selectedQuestion).toBe("explain-cpu");
    expect(s6.history).toHaveLength(5);

    const s7 = chonEvidence(s6, "bai-1::3", { source: "chat", now: GIO + 6, label: "bai_1.txt · đoạn 3" });
    expect(s7.selectedEvidence).toBe("bai-1::3");
    expect(s7.history).toHaveLength(6);
    expect(s7.history[5]).toEqual({ kind: "evidence", id: "bai-1::3", label: "bai_1.txt · đoạn 3", source: "chat", at: GIO + 6 });

    // learningMode KHÔNG phải một "lựa chọn nội dung" — không đụng selectionSource/timestamp/history.
    const s8 = datLearningMode(s7, "tutor");
    expect(s8).toEqual({ ...s7, learningMode: "tutor" });
  });

  it("thiếu opts (source/now) thì source = null, timestamp = thời điểm gọi thật (Date.now()), label tụt về id", () => {
    const truoc = Date.now();
    const sau = chonTopic(TRANG_THAI_RONG, "X");
    expect(sau.selectionSource).toBeNull();
    expect(sau.timestamp).toBeGreaterThanOrEqual(truoc);
    expect(sau.history[0]).toMatchObject({ kind: "topic", id: "X", label: "X", source: null });
  });

  it("chọn lại đúng ID vừa chọn vẫn ghi một mục nhật ký MỚI — nhật ký ghi hành động, không phải giá trị đang chọn", () => {
    const s1 = chonTopic(TRANG_THAI_RONG, "X", { now: GIO });
    const s2 = chonTopic(s1, "X", { now: GIO + 1 });
    expect(s2.history).toHaveLength(2);
    expect(s2.history[0].at).toBe(GIO);
    expect(s2.history[1].at).toBe(GIO + 1);
  });

  it("nhật ký cắt còn 50 mục MỚI NHẤT khi vượt trần (FIFO)", () => {
    let s = TRANG_THAI_RONG;
    for (let i = 0; i < 55; i += 1) {
      s = chonTopic(s, `t${i}`, { now: GIO + i });
    }
    expect(s.history).toHaveLength(50);
    expect(s.history[0].id).toBe("t5");     // 5 mục đầu (t0..t4) đã bị đẩy ra
    expect(s.history[49].id).toBe("t54");
  });

  it("SELECTION_SOURCES liệt kê đúng sáu bề mặt, không thiếu không thừa", () => {
    expect(SELECTION_SOURCES).toEqual([
      "mindmap", "summary", "knowledge", "question", "continue_learning", "chat",
    ]);
  });

  it("HISTORY_KINDS liệt kê đúng sáu loại mục nhật ký", () => {
    expect(HISTORY_KINDS).toEqual(["topic", "entity", "summary", "node", "question", "evidence"]);
  });

  it("đổi selectedDocument xoá MỌI lựa chọn khác của tài liệu cũ VÀ nhật ký, GIỮ learningMode, VẪN đóng dấu source/timestamp cho chính nó", () => {
    const truoc = {
      selectedDocument: "doc-1", selectedTopic: "Định thời", selectedEntity: "CPU",
      selectedSummary: "s2", selectedNode: "node-7", selectedQuestion: "explain-cpu",
      selectedEvidence: "bai-1::3",
      learningMode: "reader", selectionSource: "knowledge", timestamp: GIO - 100,
      history: [{ kind: "topic", id: "Định thời", label: "Định thời", source: "knowledge", at: GIO - 100 }],
    };
    const sau = chonDoc(truoc, "doc-2", { source: "mindmap", now: GIO });
    expect(sau).toEqual({
      ...TRANG_THAI_RONG, selectedDocument: "doc-2", learningMode: "reader",
      selectionSource: "mindmap", timestamp: GIO,
    });
    expect(sau.history).toEqual([]);
  });

  it("chọn LẠI cùng tài liệu là no-op (không tạo object mới, không đổi source/timestamp/history cũ)", () => {
    const truoc = { ...TRANG_THAI_RONG, selectedDocument: "doc-1", selectedTopic: "X" };
    expect(chonDoc(truoc, "doc-1", { source: "mindmap", now: GIO })).toBe(truoc);
  });

  it("xoaLuaChon chỉ xoá đúng khoá được yêu cầu, không đụng selectedDocument/learningMode/selectionSource/timestamp/history", () => {
    const truoc = {
      selectedDocument: "doc-1", selectedTopic: "X", selectedEntity: "Y",
      selectedSummary: "s1", selectedNode: "n1", selectedQuestion: "q1", selectedEvidence: "e1",
      learningMode: "focus", selectionSource: "summary", timestamp: GIO, history: [],
    };
    expect(xoaLuaChon(truoc, "selectedTopic")).toEqual({ ...truoc, selectedTopic: null });
    expect(xoaLuaChon(truoc, "selectedEvidence")).toEqual({ ...truoc, selectedEvidence: null });
    expect(xoaLuaChon(truoc, "selectedDocument")).toBe(truoc);   // bảo vệ, không xoá
    expect(xoaLuaChon(truoc, "learningMode")).toBe(truoc);       // bảo vệ, không xoá
    expect(xoaLuaChon(truoc, "selectionSource")).toBe(truoc);    // bảo vệ, không xoá qua đây
    expect(xoaLuaChon(truoc, "history")).toBe(truoc);            // bảo vệ — dùng xoaLichSu
    expect(xoaLuaChon(truoc, "khong-ton-tai")).toBe(truoc);      // khoá lạ → no-op
  });

  // Feature Pack A — hành động RIÊNG, ngữ nghĩa khác xoaLuaChon (xoá một MẢNG,
  // không phải một con trỏ lựa chọn).
  describe("xoaLichSu", () => {
    it("xoá toàn bộ nhật ký, không đụng bất kỳ selectedX nào đang có", () => {
      const truoc = {
        ...TRANG_THAI_RONG, selectedDocument: "doc-1", selectedTopic: "X",
        history: [{ kind: "topic", id: "X", label: "X", source: null, at: GIO }],
      };
      const sau = xoaLichSu(truoc);
      expect(sau.history).toEqual([]);
      expect(sau.selectedDocument).toBe("doc-1");
      expect(sau.selectedTopic).toBe("X");
    });

    it("nhật ký đã rỗng là no-op (không tạo object mới)", () => {
      const truoc = { ...TRANG_THAI_RONG, selectedDocument: "doc-1" };
      expect(xoaLichSu(truoc)).toBe(truoc);
    });
  });
});
