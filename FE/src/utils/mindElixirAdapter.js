// Adapter record v2 ↔ mind-elixir. Pure — không import mind-elixir (chỉ shape data).
// Sidecar: mind-elixir KHÔNG cam kết bảo toàn field lạ qua operations → note/chunk_refs/kind
// sống ở Map riêng, merge lại lúc save.
import { normalizeMindmapRecord } from "./mindmapNormalize";
import { stripMarkdown } from "./stripMarkdown";
import {
  assignBranchDirections, BRANCH_COLORS, compactTopic, generationProfileFor, layoutVersionFor,
} from "./mindmapLayout";

// Phase 4, Task 3 — hierarchy phải "đọc được độ sâu mà không cần đọc số".
// mind-elixir tự phân biệt root(0)/main(1) qua THEME's --root-*/--main-*
// cssVar; khoảng trống thật là idea(2)/detail(3+) — trước đây DÙNG CHUNG
// đúng một cặp --color/--bgcolor, không phân biệt được. `style` là field
// THẬT của node-elixir (verified node_modules/mind-elixir/dist/types —
// NodeObj.style: {fontSize, fontWeight, color, ...}, áp trực tiếp lên
// phần tử topic) — không phải hack nội bộ thư viện.
function levelStyle(level) {
  if (level >= 4) return { fontSize: "12px", fontWeight: "400" };
  if (level === 3) return { fontSize: "12.5px", fontWeight: "400" };
  if (level === 2) return { fontSize: "13.5px", fontWeight: "500" };
  return undefined; // root/section: THEME cssVar đã đủ, không ghi đè
}

export const REL_LABELS = {
  relates_to: "liên quan", leads_to: "dẫn tới", causes: "gây ra",
  supports: "bổ trợ", contrasts: "đối lập", contains: "bao hàm",
};

// --mm-relation (định nghĩa trong mindmap.css, flip theo html.dark) chứ KHÔNG phải
// --accent: seal đỏ dành riêng cho provenance/active/error, không dùng trang trí quan hệ.
const ARROW_STYLE = {
  stroke: "var(--mm-relation)", strokeWidth: 2, strokeDasharray: "6 4",
  labelColor: "var(--mm-relation)", opacity: 0.9,
};

// Ngược của REL_LABELS: nhãn tiếng Việt → type, để arrow user vẽ/reconnect vẫn giữ
// đúng semantic type nếu label còn khớp (thay vì luôn rớt về relates_to).
const LABEL_TO_TYPE = Object.fromEntries(
  Object.entries(REL_LABELS).map(([type, label]) => [label, type])
);

export function recordToMindElixir(record) {
  const norm = normalizeMindmapRecord(record);
  const sidecar = new Map();
  const layout = assignBranchDirections(norm.nodes);
  const byParent = new Map();
  const ids = new Set(norm.nodes.map((n) => n.id));
  let root = null;
  const orphans = []; // extra parentless nodes + dangling parent refs — rescued under root
  for (const n of norm.nodes) {
    sidecar.set(n.id, {
      note: n.note || (n.title && compactTopic(n.title) !== stripMarkdown(n.title) ? stripMarkdown(n.title) : ""),
      chunkRefs: n.chunkRefs || [], kind: n.kind,
      // Renderer V2 (Task 2/6) — EvidenceDrawer reads these via MindElixirView's
      // `selectNodes` listener; additive, never written back on save (mirrors
      // note/chunkRefs' own existing sidecar-only lifecycle).
      number: n.number || "", level: n.level || 0, enrichment: n.enrichment || [],
      // M2.5 (Provenance Adoption) — same sidecar-only lifecycle as the fields
      // above. `n.sourceStems` is already `undefined` (never `[]`) when
      // mindmapNormalize.js couldn't resolve it; that exact absence is
      // preserved here rather than defaulted, so useMindMapController's
      // `selected.sourceStems` stays undefined too, not a fabricated `[]`.
      sourceStems: n.sourceStems,
    });
    if (!root && (n.kind === "root" || n.parent == null)) { root = n; continue; }
    if (n.parent == null || !ids.has(n.parent)) { orphans.push(n); continue; }
    if (!byParent.has(n.parent)) byParent.set(n.parent, []);
    byParent.get(n.parent).push(n);
  }
  // Reparent orphans under root, AFTER its existing children — otherwise the tree
  // walk drops them and a load+save round-trip silently deletes those subtrees.
  if (root && orphans.length) {
    if (!byParent.has(root.id)) byParent.set(root.id, []);
    const kids = byParent.get(root.id);
    let next = kids.reduce((m, c) => Math.max(m, c.order ?? 0), -1) + 1;
    for (const n of orphans) kids.push({ ...n, order: next++ });
  }
  const toTree = (n, depth = 0, branchId = null) => {
    // Task 4 — number and citation-count are SEPARATE tags (own className,
    // own color) from the title text, not appended into one string; title
    // itself keeps its full original text (numbering included, per Phase 1's
    // contract) — only markdown SYNTAX is stripped, never structural content
    // (Task 1: mind-elixir sets `textContent`, not a markdown renderer — see
    // stripMarkdown.js's own docstring for why stripping, not rendering, is
    // the correct fix here, and why it's safe to persist back on save: it
    // only ever removes formatting noise, never a numbering/semantic field).
    const tags = [];
    if (n.number) tags.push({ text: n.number, className: "mm-tag-number" });
    if (n.chunkRefs?.length) tags.push({ text: `※ ${n.chunkRefs.length}`, className: "mm-tag-citations" });
    // M2.5 (Provenance Adoption, mục 3 — Cross-document MindMap) — subtle,
    // canvas-native signal reusing the exact tag mechanism citations/number
    // already use, not a map-wide recolor. Shared ONLY (2+ resolved source
    // stems, deterministic, never inferred from title similarity) — a
    // single-source node gets no tag (that's the default/majority case, no
    // need to flag it) and an unresolved node gets no tag either (absence of
    // data is not itself a state worth badging on every legacy node).
    if (n.sourceStems?.length > 1) tags.push({ text: `⇄ ${n.sourceStems.length}`, className: "mm-tag-shared" });
    const style = levelStyle(n.level);
    const currentBranchId = depth === 1 ? n.id : branchId;
    const direction = depth === 1 ? layout.directions.get(n.id) : undefined;
    const branchColor = currentBranchId ? layout.colors.get(currentBranchId) : undefined;
    return {
      id: n.id, topic: compactTopic(stripMarkdown(n.title)),
      ...(direction == null ? {} : { direction }),
      ...(branchColor ? { branchColor } : {}),
      ...(tags.length ? { tags } : {}),
      ...(style ? { style } : {}),
      children: (byParent.get(n.id) || [])
        .slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((child) => toTree(child, depth + 1, currentBranchId)),
    };
  };
  const nodeData = root
    ? toTree(root)
    : { id: "n0", topic: compactTopic(norm.title || "Sơ đồ tư duy"), children: [] };
  const arrows = (norm.relations || []).map((r, i) => ({
    id: `rel-${i}`, label: r.label || REL_LABELS[r.type] || "liên quan",
    from: r.source, to: r.target,
    delta1: { x: 80, y: -60 }, delta2: { x: -80, y: -60 },
    style: { ...ARROW_STYLE },
  }));
  return {
    mindData: {
      nodeData, arrows, direction: 2 /* MindElixir.SIDE */,
      schemaVersion: 2, layoutVersion: "side-balanced-v2", generationProfile: "learning-map-v2",
    },
    sidecar,
    meta: {
      schemaVersion: norm.schemaVersion,
      layoutVersion: layoutVersionFor(record),
      generationProfile: generationProfileFor(record),
      upgradeRequired: norm.upgradeRequired,
      branchWeights: layout.weights,
      branchDirections: layout.directions,
      branchColors: BRANCH_COLORS,
    },
  };
}

export function mindElixirToRecord(mindData, sidecar, baseRecord) {
  const nodes = [];
  const walk = (node, parent, depth, order) => {
    const side = sidecar.get(node.id);
    nodes.push({
      id: node.id, parent,
      kind: side?.kind || (depth === 0 ? "root" : depth === 1 ? "section" : "idea"),
      title: node.topic || "", note: side?.note || "",
      chunk_refs: side?.chunkRefs || [], order,
    });
    (node.children || []).forEach((c, i) => walk(c, node.id, depth + 1, i));
  };
  walk(mindData.nodeData, null, 0, 0);

  const baseType = new Map(
    (baseRecord.relations || []).map((r) => [`${r.source}→${r.target}`, r.type])
  );
  const relations = (mindData.arrows || []).map((a) => ({
    source: a.from, target: a.to,
    // Ưu tiên type gốc theo (source,target); arrow mới/reconnect thì suy từ nhãn
    // (LABEL_TO_TYPE) trước khi rớt về relates_to — codex #5.
    type: baseType.get(`${a.from}→${a.to}`) || LABEL_TO_TYPE[a.label] || "relates_to",
    label: a.label || "",
  }));

  return { ...baseRecord, title: mindData.nodeData.topic || baseRecord.title, nodes, relations };
}
