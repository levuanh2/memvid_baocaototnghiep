// Audit vòng 8 FE#5/#6 — lưu nháp hỏng thì lô đáp án mất vĩnh viễn, còn giao diện vẫn
// ghi "N/M đã trả lời", rồi lần nộp sau gửi đi một sổ đã rỗng.
import { describe, expect, it } from "vitest";
import { taoSoNhap } from "./soNhap";

describe("taoSoNhap", () => {
  it("lấy ra là sổ trống lại — không gửi trùng lô", () => {
    const s = taoSoNhap();
    s.dat("q1", "A");
    s.dat("q2", "B");
    expect(s.layDeGui()).toEqual({ q1: "A", q2: "B" });
    expect(s.coGi()).toBe(false);
    expect(s.layDeGui()).toEqual({});
  });

  it("gửi hỏng, trả lại thì lô còn nguyên cho lần sau", () => {
    const s = taoSoNhap();
    s.dat("q1", "A");
    const lo = s.layDeGui();
    s.traLai(lo);                       // giả lập saveAnswers ném
    expect(s.coGi()).toBe(true);
    expect(s.layDeGui()).toEqual({ q1: "A" });
  });

  it("trả lại KHÔNG đè lên câu người dùng vừa đổi trong lúc gửi", () => {
    const s = taoSoNhap();
    s.dat("q1", "A");
    const lo = s.layDeGui();
    s.dat("q1", "C");                   // đổi ý trong lúc request còn bay
    s.traLai(lo);
    expect(s.layDeGui()).toEqual({ q1: "C" });
  });

  it("trả lại giữ được cả câu cũ lẫn câu mới", () => {
    const s = taoSoNhap();
    s.dat("q1", "A");
    const lo = s.layDeGui();
    s.dat("q2", "B");
    s.traLai(lo);
    expect(s.layDeGui()).toEqual({ q1: "A", q2: "B" });
  });

  it("đếm được bao nhiêu câu chưa lên server", () => {
    const s = taoSoNhap();
    expect(s.demCho()).toBe(0);
    s.dat("q1", "A");
    s.dat("q2", "B");
    s.dat("q1", "C");
    expect(s.demCho()).toBe(2);
  });

  it("traLai(undefined) không nổ", () => {
    const s = taoSoNhap();
    s.dat("q1", "A");
    s.traLai(undefined);
    expect(s.layDeGui()).toEqual({ q1: "A" });
  });
});
