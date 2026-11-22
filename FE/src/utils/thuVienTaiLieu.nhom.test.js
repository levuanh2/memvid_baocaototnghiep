import { describe, expect, it } from "vitest";
import { NHOM_THU_VIEN, canXuLy, demTheoNhom, taiLieuTheoNhom } from "./thuVienTaiLieu";

const ready = { index: "ready", summary: { state: "ready" }, mindmap: { state: "ready" }, quiz: { ready: true }, review: {} };
const doc = (id, extra = {}) => ({ document_id: id, title: id, created_at: "2026-10-01T00:00:00Z", ai: ready, ...extra });

const A = doc("a", { pinned: true, last_opened_at: "2026-11-10T00:00:00Z" });
const B = doc("b", { last_opened_at: "2026-11-12T00:00:00Z", ai: { ...ready, summary: { state: "not_generated" } } });
const C = doc("c", { created_at: "2026-11-12T00:00:00Z" });
const REVIEW = doc("r", { ai: { ...ready, quiz: { ready: true, graded_attempts: 1 }, review: { ready: false } } });
const FAILED = doc("f", { ingest_status: "error", status: "failed", ai: { index: "not_generated" } });
const PROCESSING = doc("p", { ingest_status: "processing", ai: { index: "not_generated" } });
const ALL = [B, C, A, REVIEW, FAILED, PROCESSING];
const ids = (list) => list.map((d) => d.document_id);

describe("Library views", () => {
  it("every view is a subset of the list, and no document appears twice in any view", () => {
    for (const [nhom] of NHOM_THU_VIEN) {
      const list = taiLieuTheoNhom(ALL, nhom);
      expect(new Set(ids(list)).size).toBe(list.length);
      for (const d of list) expect(ALL).toContain(d);
    }
  });

  it("'Tất cả' holds every document once, pinned first, otherwise in the given order", () => {
    expect(ids(taiLieuTheoNhom(ALL, "tat_ca"))).toEqual(["a", "b", "c", "r", "f", "p"]);
  });

  it("'Học gần đây' holds only opened documents", () => {
    expect(ids(taiLieuTheoNhom(ALL, "hoc_gan_day")).sort()).toEqual(["a", "b"]);
  });

  it("'Cần xử lý' holds failed documents and graded quizzes without a review guide, nothing else", () => {
    expect(ids(taiLieuTheoNhom(ALL, "can_xu_ly")).sort()).toEqual(["f", "r"]);
    expect(canXuLy(PROCESSING)).toBe(false);
    expect(canXuLy(A)).toBe(false);
    // A missing summary or quiz is not "needs attention": nearly every document has one.
    expect(canXuLy(B)).toBe(false);
  });

  it("counts match the views", () => {
    const counts = demTheoNhom(ALL);
    for (const [nhom] of NHOM_THU_VIEN) expect(counts[nhom]).toBe(taiLieuTheoNhom(ALL, nhom).length);
  });

  it("an unknown view falls back to 'Tất cả'", () => {
    expect(ids(taiLieuTheoNhom(ALL, "khong_co"))).toEqual(ids(taiLieuTheoNhom(ALL, "tat_ca")));
  });
});
