// Feature Pack D (Personal Knowledge Graph & Knowledge Evolution) — every
// function here is a PURE reader over data that already exists: `history[]`
// (StudyContext, Feature Pack A) and the current MindMap's node list
// (`useMindMapController.js`'s `allNodes`, added this pack). No persistence,
// no fabricated numbers — every count below is a real tally over real
// entries. THUẦN, same convention as mindmapGraph.js/keyboardShortcuts.js:
// no DOM, no React, so this is unit-testable without mounting anything.
//
// Honest scope note (epic's own "never fabricate" rule): the epic's example
// Knowledge Evolution labels include "Mastered" and "Forgotten". Neither is
// implemented as a literal category — there is no correctness/retention
// signal anywhere in reachable frontend state (no quiz result, no spaced-
// repetition schedule flows into `history[]`; it only records WHAT was
// looked at and WHEN, never whether it was understood). Labelling something
// "Mastered" from visit-count alone would be exactly the fabrication the
// epic's IMPORTANT section forbids. What ships instead — "Mới khám phá"
// (recently discovered), "Ôn đi ôn lại" (frequently revisited), "Cần xem
// lại" (needs review) — are the three categories recency+frequency alone can
// honestly support. See docs/FEATURE_PACK_D_REPORT.md's Knowledge model
// section for the full reasoning.

/** Nhãn/icon theo `kind` — MỘT bảng tra dùng chung cho ResearchTimeline.jsx,
 * CommandPalette.jsx, và KnowledgeDashboard.jsx (trước đây mỗi nơi tự có một
 * bản sao giống hệt nhau; gộp lại đây, ba nơi cùng import). */
export const KIND_META = {
  topic: { icon: "Tag", label: "Chủ đề" },
  entity: { icon: "BookOpen", label: "Thực thể" },
  summary: { icon: "ScrollText", label: "Tóm tắt" },
  node: { icon: "Network", label: "Sơ đồ" },
  question: { icon: "MessageCircleQuestion", label: "Câu hỏi" },
  evidence: { icon: "Quote", label: "Bằng chứng" },
};

// Ngưỡng phân loại — hằng số đặt tên, không phải số ma thuật rải rác. Chọn
// dựa trên bản chất của `history`: một phiên KHÔNG lưu qua lần tải lại
// trang, nên "cũ" ở đây nghĩa là "sớm trong phiên đang mở", không phải nhiều
// ngày như một hệ ôn tập ngắt quãng (spaced repetition) thật sẽ cần.
const DISCOVERED_WINDOW_MS = 5 * 60 * 1000;    // 5 phút gần nhất của phiên
const NEEDS_REVIEW_AGE_MS = 10 * 60 * 1000;    // xem 1 lần, đã hơn 10 phút, chưa quay lại
const FREQUENT_MIN_COUNT = 2;

/** MỘT chỗ chuẩn hoá node id trước khi so khớp — cùng lý do
 * `mindmapGraph.js::findNodeByChunk` đã làm `String(chunkId ?? "")`: id của
 * mind-elixir/StudyMap có thể tới dưới dạng số hoặc chuỗi tuỳ nguồn, so sánh
 * trực tiếp qua `Set.has`/`Map.get` mà không ép kiểu trước sẽ âm thầm không
 * khớp. `partitionNodesByVisit`/`nodeHeatmap` đều gọi qua hàm này, không tự
 * ép kiểu riêng lẻ ở hai chỗ khác nhau. */
const nodeKey = (id) => String(id ?? "");

/**
 * Gộp `history[]` (mỗi lần chọn MỘT mục nhật ký, kể cả chọn lại đúng ID) về
 * MỘT mục nhật ký duy nhất mỗi (kind,id) — `count` = số lần thật đã ghi,
 * `firstAt`/`lastAt` = mốc thật đầu/cuối. Không đụng `history` gốc, không
 * lưu bản sao lâu dài — tính lại mỗi lần gọi, cùng kỷ luật StudyContext đã
 * đặt ra cho chính `history` (không phải kho dữ liệu thứ hai).
 */
export function dedupeHistory(history) {
  const by = new Map();
  for (const e of history || []) {
    // Chỉ ép kiểu id cho kind "node" — node id có thể tới dưới dạng số hoặc
    // chuỗi tuỳ nguồn (mind-elixir/StudyMap). Các kind khác (topic/entity/
    // question/evidence/summary) vốn đã là chuỗi thật từ nguồn của chúng —
    // ép thêm ở đó không đổi gì, chỉ node mới cần.
    const key = e.kind === "node" ? `node::${nodeKey(e.id)}` : `${e.kind}::${e.id}`;
    const cur = by.get(key);
    if (!cur) {
      by.set(key, { kind: e.kind, id: e.id, label: e.label, source: e.source, firstAt: e.at, lastAt: e.at, count: 1 });
    } else {
      cur.count += 1;
      cur.lastAt = e.at;
      cur.label = e.label; // nhãn mới nhất thắng — cùng kỷ luật `ghiLuaChon` đã có
    }
  }
  return [...by.values()];
}

/**
 * Phân loại MỘT mục đã gộp — trả về `null` khi không thuộc nhóm nào đáng nói
 * (mới xem một lần, chưa đủ lâu để gọi là "cần xem lại", cũng chưa đủ mới để
 * gọi là "mới khám phá") — im lặng còn trung thực hơn là ép vào một nhãn.
 */
export function classifyEntry(entry, now) {
  if (entry.count >= FREQUENT_MIN_COUNT) return "frequent";
  if (now - entry.firstAt <= DISCOVERED_WINDOW_MS) return "discovered";
  if (now - entry.lastAt >= NEEDS_REVIEW_AGE_MS) return "needs-review";
  return null;
}

/**
 * Khả năng "Jump" thật của một mục đã gộp — CÙNG luật ResearchTimeline.jsx
 * (Feature Pack A) đã đặt ra cho chính `history`, gộp về một chỗ để
 * KnowledgeDashboard.jsx dùng lại thay vì viết lần hai: question/evidence
 * luôn có đích; node cần còn trong sơ đồ đang mở (`canJumpNode`); topic/
 * entity/summary chưa có điểm nhảy thật nào trong giao diện hiện tại.
 */
export function canJumpEntry(entry, { canJumpNode } = {}) {
  if (entry.kind === "question" || entry.kind === "evidence") {
    return { kha_thi: true };
  }
  if (entry.kind === "node") {
    return canJumpNode?.(entry.id)
      ? { kha_thi: true }
      : { kha_thi: false, ly_do: "Không còn trong sơ đồ đang mở (đã đổi tài liệu, sơ đồ đã dựng lại, hoặc mục này đến từ StudyMap — StudyMap không có trong khung Trò chuyện)" };
  }
  return { kha_thi: false, ly_do: "Chưa có điểm để nhảy tới cho loại mục này" };
}

/** Knowledge Evolution (mục 1) — `history` → ba nhóm, mới nhất trước trong
 * mỗi nhóm. */
export function evolutionGroups(history, now) {
  const merged = dedupeHistory(history);
  const groups = { discovered: [], frequent: [], needsReview: [] };
  for (const e of merged) {
    const cat = classifyEntry(e, now);
    if (cat === "discovered") groups.discovered.push(e);
    else if (cat === "frequent") groups.frequent.push(e);
    else if (cat === "needs-review") groups.needsReview.push(e);
  }
  groups.discovered.sort((a, b) => b.firstAt - a.firstAt);
  groups.frequent.sort((a, b) => b.count - a.count);
  groups.needsReview.sort((a, b) => a.lastAt - b.lastAt); // lâu nhất trước
  return groups;
}

/** Review Suggestions (mục 5) — top N mục "cần xem lại", lâu nhất trước. */
export function reviewSuggestions(history, now, limit = 5) {
  return evolutionGroups(history, now).needsReview.slice(0, limit);
}

/**
 * Session Summary (mục 6) — đếm THẬT theo `kind`. "concepts" = chủ đề +
 * thực thể riêng biệt (topic/entity — đúng nghĩa "khái niệm" trong app này,
 * không lẫn với node sơ đồ hay trích dẫn). Node MindMap-canvas và node
 * StudyMap CỘNG chung vào `nodes` — cả hai bề mặt cùng ghi `kind:"node"`,
 * `source:"mindmap"` vào history (xem useMindMapController.js dòng 75 và
 * StudyMapView.jsx dòng 384) nên không tách được nguồn nào thật sự đã tạo
 * ra một mục cụ thể; tách giả ở đây sẽ là số liệu bịa, không tách trung
 * thực hơn.
 */
export function sessionSummary(history) {
  const merged = dedupeHistory(history);
  const distinctByKind = (kind) => merged.filter((e) => e.kind === kind).length;
  return {
    questions: distinctByKind("question"),
    evidence: distinctByKind("evidence"),
    concepts: distinctByKind("topic") + distinctByKind("entity"),
    nodes: distinctByKind("node"),
    summaries: distinctByKind("summary"),
    totalActions: (history || []).length,
  };
}

/**
 * Knowledge Graph Overlay (mục 2) — chia TOÀN BỘ node của sơ đồ đang mở
 * (`allNodes`, mỗi phần tử `{id,title,number,kind}` từ mindmapGraph.js) theo
 * đã-ghé/chưa-ghé, dựa trên `kind:"node"` trong `history`. Node có id không
 * còn tồn tại trong sơ đồ hiện tại (đổi tài liệu, dựng lại) tự động không
 * xuất hiện ở "unvisited" (không có trong `allNodes`), và cũng không đếm
 * nhầm — `partitionNodesByVisit` chỉ nhìn từ `allNodes` ra, không suy diễn
 * ngược từ history.
 */
export function partitionNodesByVisit(allNodes, history) {
  const visitedIds = new Set((history || []).filter((e) => e.kind === "node").map((e) => nodeKey(e.id)));
  const visited = [];
  const unvisited = [];
  for (const n of allNodes || []) (visitedIds.has(nodeKey(n.id)) ? visited : unvisited).push(n);
  return { visited, unvisited };
}

/** Knowledge Heatmap (mục 4) — cùng phép đếm `dedupeHistory` đã dùng cho
 * Knowledge Evolution, áp riêng lên tập node của sơ đồ đang mở. Ba nhóm:
 * hay dùng (>= 2 lần), ít dùng (1 lần), chưa từng mở (0 lần, có trong sơ đồ
 * nhưng không có trong history). */
export function nodeHeatmap(allNodes, history) {
  const counts = new Map();
  for (const e of history || []) {
    if (e.kind !== "node") continue;
    const k = nodeKey(e.id);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const frequent = [], rare = [], never = [];
  for (const n of allNodes || []) {
    const c = counts.get(nodeKey(n.id)) || 0;
    const withCount = { ...n, visitCount: c };
    if (c >= FREQUENT_MIN_COUNT) frequent.push(withCount);
    else if (c === 1) rare.push(withCount);
    else never.push(withCount);
  }
  frequent.sort((a, b) => b.visitCount - a.visitCount);
  return { frequent, rare, never };
}
