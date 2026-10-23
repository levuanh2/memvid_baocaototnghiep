// Deterministic Export Studio fixtures (Round 2, section 2) — used ONLY by
// fixtureHarness.jsx. No production API call, no auth, no randomness (every
// id/count is stable across runs — required for reproducible visual QA and
// file-artifact validation). Record shape matches
// FE/src/utils/mindElixirAdapter.js's `normalizeMindmapRecord` input
// exactly: {id, title, nodes: [{id, kind, title, parent, order, note,
// chunk_refs}], relations, schema_version}.
//
// Shape: 4 main branches (depth 1) x 3 sub-branches (depth 2) x 3 leaf ideas
// (depth 3) = 4 + 12 + 36 = 52, plus root = 53, plus 7 hand-placed extra
// leaves under specific sub-branches (for realistic uneven density and to
// round toward "~60 node") = 60, plus 1 dedicated Vietnamese-character-set
// gate node (Section 7) = 61 total. Vietnamese text throughout. A subset
// of nodes carry `note`/`chunk_refs` (citations); a handful of cross-branch
// `relations` connect leaves in different main branches.

const MAIN_BRANCHES = [
  "Kiến trúc hệ thống",
  "Bảo mật & xác thực",
  "Hiệu năng & mở rộng",
  "Trải nghiệm người dùng",
];
const SUB_TOPICS = ["Nguyên lý", "Triển khai thực tế", "Rủi ro & hạn chế"];
const LEAF_TOPICS = ["Định nghĩa", "Ví dụ cụ thể", "Ghi chú vận hành"];

function buildMap(mapId, title) {
  const nodes = [{ id: `${mapId}-root`, kind: "root", title, parent: null, order: 0 }];
  const relationCandidates = [];

  MAIN_BRANCHES.forEach((mainTopic, mi) => {
    const mainId = `${mapId}-m${mi}`;
    nodes.push({
      id: mainId, kind: "section", title: mainTopic, parent: `${mapId}-root`, order: mi,
      note: mi === 0 ? "Nhánh này bao gồm toàn bộ quyết định kiến trúc cốt lõi của hệ thống." : "",
    });
    SUB_TOPICS.forEach((subTopic, si) => {
      const subId = `${mainId}-s${si}`;
      nodes.push({
        id: subId, kind: "section", title: `${subTopic} — ${mainTopic}`, parent: mainId, order: si,
      });
      LEAF_TOPICS.forEach((leafTopic, li) => {
        const leafId = `${subId}-l${li}`;
        const hasCitation = (mi + si + li) % 3 === 0;
        nodes.push({
          id: leafId, kind: "idea", title: `${leafTopic}: ${subTopic.toLowerCase()}`, parent: subId, order: li,
          note: li === 1 ? `Ghi chú chi tiết cho "${leafTopic}" trong bối cảnh ${mainTopic.toLowerCase()}.` : "",
          chunk_refs: hasCitation ? [`c${mi}${si}${li}`] : [],
        });
        relationCandidates.push(leafId);
      });
    });
  });

  // 7 extra hand-placed leaves for an uneven, realistic density (rounds 53 -> 60).
  const extras = [
    [`${mapId}-m0-s0`, "Ràng buộc lịch sử còn giữ lại"],
    [`${mapId}-m0-s1`, "Kịch bản triển khai song song"],
    [`${mapId}-m1-s0`, "Chính sách xoay khoá định kỳ"],
    [`${mapId}-m1-s2`, "Log truy vết cho sự cố bảo mật"],
    [`${mapId}-m2-s1`, "Ngưỡng cảnh báo tài nguyên"],
    [`${mapId}-m3-s0`, "Phản hồi người dùng thử nghiệm"],
    [`${mapId}-m3-s2`, "Kiểm thử khả năng tiếp cận"],
  ];
  extras.forEach(([parent, title], i) => {
    nodes.push({ id: `${mapId}-extra${i}`, kind: "idea", title, parent, order: 99 + i });
  });

  // Section 7 (final hardening round): a dedicated node carrying the EXACT
  // representative Vietnamese character set the round specified, so real
  // export-format QA can assert it renders correctly rather than relying
  // on the incidental diacritics already scattered through the topics
  // above. Stable, predictable id for tests to target directly.
  nodes.push({
    id: `${mapId}-vn-gate`, kind: "idea", title: "ă â ê ô ơ ư đ Á Ế Ỗ Ờ Ữ",
    parent: `${mapId}-root`, order: 200,
  });

  // A handful of cross-branch relations (must connect nodes that actually exist).
  const relations = [
    { source: relationCandidates[1], target: relationCandidates[10], type: "relates_to" },
    { source: relationCandidates[4], target: relationCandidates[22], type: "leads_to" },
    { source: relationCandidates[13], target: relationCandidates[31], type: "causes" },
  ];

  return { id: mapId, title, nodes, relations, sources: [], schema_version: 2 };
}

export const FIXTURE_MAP_A = buildMap("fixture-map-a", "Bản đồ tư duy: Hệ thống StudyMap (Fixture A)");
export const FIXTURE_MAP_B = buildMap("fixture-map-b", "Bản đồ tư duy: Quy trình học tập (Fixture B)");

function buildScopeFreshnessMap(id, title, nodeCount) {
  return {
    id,
    title,
    nodes: [
      { id: `${id}-root`, kind: "root", title, parent: null, order: 0 },
      ...Array.from({ length: nodeCount - 1 }, (_, index) => ({
        id: `${id}-n${index}`,
        kind: "idea",
        title: `${title} — node ${index + 1}`,
        parent: `${id}-root`,
        order: index,
      })),
    ],
    relations: [],
    sources: [],
    schema_version: 2,
  };
}

// H3B.1 production-shape fixtures: exact counts from the stale-preview report.
export const FIXTURE_SCOPE_A = buildScopeFreshnessMap("scope-map-a", "H3B.1 Map A — 11 nodes", 11);
export const FIXTURE_SCOPE_B = buildScopeFreshnessMap("scope-map-b", "H3B.1 Map B — 57 nodes", 57);

/** Node ids to pre-collapse right after mount, so the fixture always has a real mix of expanded/collapsed branches (not just "everything open"). */
export const FIXTURE_COLLAPSED_NODE_IDS = {
  [FIXTURE_MAP_A.id]: [`${FIXTURE_MAP_A.id}-m2`, `${FIXTURE_MAP_A.id}-m2-s0`],
  [FIXTURE_MAP_B.id]: [`${FIXTURE_MAP_B.id}-m1`],
};

// PR A export-rendering fixture (fake data only). Used by the export-v3
// Playwright spec via ?map=export-v3. Long multi-line Vietnamese root title,
// four main branches (one with many leaves so it extends further than the
// viewport), a collapsed branch whose deepest node must still be exported.
const EXPORT_V3_ID = "export-v3";
function buildExportV3() {
  const nodes = [{
    id: `${EXPORT_V3_ID}-root`, kind: "root",
    title: "Bản đồ kiểm thử xuất file: tiêu đề tiếng Việt có dấu rất dài để kiểm tra xuống dòng và không cắt chữ ở mép",
    parent: null, order: 0,
  }];
  const mains = ["Nhánh trái thứ nhất", "Nhánh phải thứ nhất", "Nhánh trái thứ hai", "Nhánh phải thứ hai"];
  mains.forEach((t, mi) => {
    const mainId = `${EXPORT_V3_ID}-m${mi}`;
    nodes.push({ id: mainId, kind: "section", title: t, parent: `${EXPORT_V3_ID}-root`, order: mi });
    const leafCount = mi === 2 ? 14 : 3;
    for (let li = 0; li < leafCount; li++) {
      nodes.push({ id: `${mainId}-l${li}`, kind: "idea", title: `Ý ${li + 1} của ${t.toLowerCase()} — có dấu tiếng Việt`, parent: mainId, order: li });
    }
  });
  // Collapsed branch: a deep node under m1 that must still appear in a full export.
  nodes.push({ id: `${EXPORT_V3_ID}-m1-deep`, kind: "idea", title: "Node sâu trong nhánh đang thu gọn", parent: `${EXPORT_V3_ID}-m1-l0`, order: 0 });
  return { id: EXPORT_V3_ID, title: "Bản đồ kiểm thử xuất file", nodes, relations: [], sources: [], schema_version: 2 };
}
export const FIXTURE_EXPORT_V3 = buildExportV3();
export const FIXTURE_EXPORT_V3_COLLAPSED = { [FIXTURE_EXPORT_V3.id]: [`${FIXTURE_EXPORT_V3.id}-m1-l0`] };

// PR D depth-preset QA fixture (?map=depth). Same shape as
// MindElixirView.depthLevels.test.jsx's `dataFor()` fixture — 5 distinct
// depths (0..4), unbalanced (one branch 4 generations deep, two shallow
// branches) — so the 5 presets produce genuinely different node sets and
// the exact topic/connector counts the Vitest suite already proved
// (1/0, 4/3, 6/5, 7/6, 8/7) carry over unchanged to a real browser.
const DEPTH_ID = "fixture-depth";
function buildDepthFixture() {
  const nodes = [
    { id: `${DEPTH_ID}-root`, kind: "root", title: "Root", parent: null, order: 0 },
    { id: `${DEPTH_ID}-a`, kind: "section", title: "A", parent: `${DEPTH_ID}-root`, order: 0 },
    { id: `${DEPTH_ID}-b`, kind: "section", title: "B", parent: `${DEPTH_ID}-a`, order: 0 },
    { id: `${DEPTH_ID}-c`, kind: "section", title: "C", parent: `${DEPTH_ID}-b`, order: 0 },
    { id: `${DEPTH_ID}-d`, kind: "idea", title: "D", parent: `${DEPTH_ID}-c`, order: 0 },
    { id: `${DEPTH_ID}-f`, kind: "section", title: "F", parent: `${DEPTH_ID}-root`, order: 1 },
    { id: `${DEPTH_ID}-g`, kind: "section", title: "G", parent: `${DEPTH_ID}-root`, order: 2 },
    { id: `${DEPTH_ID}-h`, kind: "idea", title: "H", parent: `${DEPTH_ID}-g`, order: 0 },
  ];
  return { id: DEPTH_ID, title: "Bản đồ kiểm thử mức thu/mở (Fixture Depth)", nodes, relations: [], sources: [], schema_version: 2 };
}
export const FIXTURE_DEPTH = buildDepthFixture();

// Exactly 3 levels deep (root->a->b->c), plus a second depth-1 branch that
// also has its own child (root->e->f) -- the real-browser counterpart of
// MindElixirView.depthPresetIndicatorIntent.test.jsx's shallowData3. Used to
// prove the depth3==all preset-indicator fix against REAL layout/geometry
// (root-center, scale, instance identity, invalid paths), which jsdom can't
// compute reliably.
const SHALLOW3_ID = "fixture-shallow3";
function buildShallow3Fixture() {
  const nodes = [
    { id: `${SHALLOW3_ID}-root`, kind: "root", title: "Root", parent: null, order: 0 },
    { id: `${SHALLOW3_ID}-a`, kind: "section", title: "A", parent: `${SHALLOW3_ID}-root`, order: 0 },
    { id: `${SHALLOW3_ID}-b`, kind: "section", title: "B", parent: `${SHALLOW3_ID}-a`, order: 0 },
    { id: `${SHALLOW3_ID}-c`, kind: "idea", title: "C", parent: `${SHALLOW3_ID}-b`, order: 0 },
    { id: `${SHALLOW3_ID}-e`, kind: "section", title: "E", parent: `${SHALLOW3_ID}-root`, order: 1 },
    { id: `${SHALLOW3_ID}-f`, kind: "idea", title: "F", parent: `${SHALLOW3_ID}-e`, order: 0 },
  ];
  return { id: SHALLOW3_ID, title: "Bản đồ kiểm thử preset indicator (Fixture Shallow3)", nodes, relations: [], sources: [], schema_version: 2 };
}
export const FIXTURE_SHALLOW3 = buildShallow3Fixture();

export const FIXTURE_POST_PR77 = {
  id: "post-pr77-exact",
  title: "An ninh mạng và quyền riêng tư",
  nodes: [
    { id: "ROOT", kind: "root", title: "An ninh mạng và quyền riêng tư", parent: null, order: 0 },
    { id: "P", kind: "section", title: "Phát hiện và xử lý vi phạm mạng", parent: "ROOT", order: 0 },
    { id: "A", kind: "idea", title: "Dung File Tập Trung Vào", parent: "P", order: 0 },
    { id: "B", kind: "idea", title: "Phát hiện & xử lý vi phạm", parent: "P", order: 1 },
    { id: "C", kind: "idea", title: "Đăng nhập trái phép", parent: "P", order: 2 },
    { id: "D", kind: "idea", title: "Lắp đặt camera giám sát", parent: "P", order: 3 },
  ],
  relations: [], sources: [], schema_version: 2,
};

export const FIXTURE_EXACT_V3 = {
  id: "exact-node-export-v3",
  title: "Exact Node Export V3",
  nodes: [
    { id: "F", kind: "root", title: "F — Chủ đề", parent: null, order: 0 },
    { id: "E", kind: "section", title: "E — Nhánh trái", parent: "F", order: 0 },
    { id: "A", kind: "idea", title: "A — Ý thứ nhất", parent: "E", order: 0 },
    { id: "B", kind: "idea", title: "B — Ý thứ hai", parent: "E", order: 1 },
    { id: "C", kind: "idea", title: "C — Ý thứ ba", parent: "E", order: 2 },
    { id: "D", kind: "idea", title: "D — Ý thứ tư", parent: "E", order: 3 },
    { id: "J", kind: "section", title: "J — Nhánh phải", parent: "F", order: 1 },
    { id: "K", kind: "idea", title: "K — Ý bên phải thứ nhất", parent: "J", order: 0 },
    { id: "L", kind: "idea", title: "L — Ý bên phải thứ hai", parent: "J", order: 1 },
  ],
  relations: [], sources: [], schema_version: 2,
};
