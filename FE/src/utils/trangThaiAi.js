// Ba trạng thái AI — hợp nhất payload máy chủ với job đang chạy ở MÁY NÀY.
//
// Vì sao phần này nằm ở client: bảng `jobs` không lưu nguồn của job, nên máy chủ
// KHÔNG gắn được một job tóm tắt đang chạy với một tài liệu. Nó chỉ trả `ready` hoặc
// `not_generated`. Nhưng `activeSummaryJob` / `activeMindmapJob` đã lưu sẵn
// `{jobId, sources, startedAt}` từ trước — `sources` chính là stem. Bằng chứng
// DƯƠNG có sẵn, chỉ cần đọc.
//
// Luật bất di bất dịch: **vắng mặt KHÔNG BAO GIỜ tạo ra GENERATING.** Kho tóm tắt
// nằm trong DATA_DIR và bị xoá mỗi lần deploy hoặc mỗi lần dịch vụ ngủ (~15 phút),
// nên nếu chỗ trống được đọc là "đang tạo" thì màn hình sẽ nói dối phần lớn thời
// gian, và người dùng ngồi chờ một việc chưa từng bắt đầu.
import { loadActiveSummaryJob } from "./activeSummaryJob";
import { loadActiveMindmapJob } from "./activeMindmapJob";

export const READY = "ready";
export const GENERATING = "generating";
export const NOT_GENERATED = "not_generated";

// Job chạy quá lâu gần như chắc chắn là tiến trình đã chết (Render Free ngủ sau
// ~15 phút và giết mọi thread đang chạy). Không có trần này thì một mục localStorage
// mồ côi giữ thẻ ở "đang tạo…" vĩnh viễn — cùng lớp lỗi với thẻ ma của cột trái.
export const HAN_JOB_MS = 30 * 60 * 1000;

/** {stem: true} cho các job còn hiệu lực. Mục hỏng/quá hạn bị bỏ, không ném. */
export function stemDangChay(job, { now = Date.now(), hanMs = HAN_JOB_MS } = {}) {
  const out = new Set();
  if (!job || typeof job.jobId !== "string" || !job.jobId) return out;
  const batDau = Number(job.startedAt) || 0;
  if (batDau && now - batDau > hanMs) return out;
  for (const s of Array.isArray(job.sources) ? job.sources : []) {
    const stem = String(s || "").trim().toLowerCase();
    if (stem) out.add(stem);
  }
  return out;
}

/**
 * Nâng cấp MỘT trạng thái phù du. `ready` không bao giờ bị hạ xuống: đã có bản tóm
 * tắt mở được thì việc đang tạo bản mới không được giấu bản cũ đi.
 */
export function hopNhat(trangThaiMayChu, dangChay) {
  if (trangThaiMayChu === READY) return READY;
  return dangChay ? GENERATING : NOT_GENERATED;
}

/** Đọc hai kho job một lần cho cả danh sách — không đọc lại theo từng thẻ. */
export function docJobDangChay({ now = Date.now() } = {}) {
  let tomTat = null;
  let soDo = null;
  try { tomTat = loadActiveSummaryJob(); } catch { tomTat = null; }
  try { soDo = loadActiveMindmapJob(); } catch { soDo = null; }
  return {
    summary: stemDangChay(tomTat, { now }),
    mindmap: stemDangChay(soDo, { now }),
  };
}

/**
 * Trạng thái AI cuối cùng của một tài liệu.
 *
 * `studymap` KHÔNG được nâng cấp ở đây: nó ở Postgres, `knowledge_maps.status` đã
 * có `processing`, nên máy chủ là nguồn đúng và duy nhất.
 */
export function trangThaiAi(doc, jobs) {
  const ai = doc?.ai || {};
  const stem = String(doc?.source_stem || "").trim().toLowerCase();
  const j = jobs || { summary: new Set(), mindmap: new Set() };

  return {
    extraction: ai.extraction || NOT_GENERATED,
    embedding: ai.embedding || NOT_GENERATED,
    index: ai.index || NOT_GENERATED,
    chat_ready: ai.chat_ready || NOT_GENERATED,
    summary: hopNhat(ai.summary?.state, stem && j.summary.has(stem)),
    mindmap: hopNhat(ai.mindmap?.state, stem && j.mindmap.has(stem)),
    studymap: ai.studymap?.state || NOT_GENERATED,
    quiz: ai.quiz?.ready ? READY : NOT_GENERATED,
    review: ai.review?.ready ? READY : NOT_GENERATED,
  };
}

// ── Chip hiển thị ───────────────────────────────────────────────────────────
// KHÔNG có chip Flashcards: tính năng chưa tồn tại, và một affordance cho thứ chưa
// có chính là tính năng ma.
export const CHIP = [
  { khoa: "index", nhan: "Đã lập chỉ mục", nhanDangChay: "Đang lập chỉ mục…" },
  { khoa: "summary", nhan: "Tóm tắt", nhanDangChay: "Đang tóm tắt…" },
  { khoa: "mindmap", nhan: "Sơ đồ tư duy", nhanDangChay: "Đang dựng sơ đồ…" },
  { khoa: "studymap", nhan: "Bản đồ học tập", nhanDangChay: "Đang dựng bản đồ…" },
  { khoa: "quiz", nhan: "Quiz", nhanDangChay: null },
  { khoa: "review", nhan: "Ôn tập", nhanDangChay: null },
];

/**
 * Chip để render. `count` chỉ đi kèm quiz/ôn tập và chỉ khi > 0 — "Quiz (0)" là
 * một cách viết dài dòng của "chưa có quiz".
 */
export function chipHienThi(doc, jobs) {
  const tt = trangThaiAi(doc, jobs);
  const ai = doc?.ai || {};
  return CHIP.map(({ khoa, nhan, nhanDangChay }) => {
    const trangThai = tt[khoa];
    const soLuong = khoa === "quiz" ? ai.quiz?.count
      : khoa === "review" ? ai.review?.count : null;
    return {
      khoa,
      trangThai,
      soLuong: soLuong > 0 ? soLuong : null,
      nhan: trangThai === GENERATING && nhanDangChay ? nhanDangChay : nhan,
    };
  });
}
