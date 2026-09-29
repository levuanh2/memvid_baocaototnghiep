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

/** Node ids to pre-collapse right after mount, so the fixture always has a real mix of expanded/collapsed branches (not just "everything open"). */
export const FIXTURE_COLLAPSED_NODE_IDS = {
  [FIXTURE_MAP_A.id]: [`${FIXTURE_MAP_A.id}-m2`, `${FIXTURE_MAP_A.id}-m2-s0`],
  [FIXTURE_MAP_B.id]: [`${FIXTURE_MAP_B.id}-m1`],
};
