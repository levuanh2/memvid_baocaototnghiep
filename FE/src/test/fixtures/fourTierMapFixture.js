const longTitle = "Cơ chế điều phối tiến trình hiện đại bảo đảm công bằng phản hồi nhanh và tránh bế tắc trong hệ thống nhiều lõi";

export const fourTierMapFixture = {
  title: "Hệ điều hành hiện đại",
  selectedNodeId: "concept-scheduling",
  collapsedNodeId: "section-memory",
  searchQuery: "bế tắc",
  mindmapRecord: {
    id: "qa-four-tier-map",
    title: "Hệ điều hành hiện đại",
    nodes: [
      { id: "root", title: "Hệ điều hành hiện đại", kind: "root", level: 0, parent: null, order: 0 },
      { id: "section-process", title: "Quản lý tiến trình", kind: "branch", level: 1, parent: "root", order: 0 },
      { id: "section-memory", title: "Quản lý bộ nhớ", kind: "branch", level: 1, parent: "root", order: 1 },
      { id: "concept-scheduling", title: longTitle, kind: "idea", level: 2, parent: "section-process", order: 0 },
      { id: "concept-paging", title: "Phân trang theo yêu cầu", kind: "idea", level: 2, parent: "section-memory", order: 0 },
      { id: "detail-deadlock", title: "Ví dụ nhận diện và phòng tránh bế tắc", kind: "detail", level: 3, parent: "concept-scheduling", order: 0 },
      { id: "detail-page", title: "Khung trang vật lý và không gian địa chỉ ảo", kind: "detail", level: 3, parent: "concept-paging", order: 0 },
    ],
    relations: [],
  },
  studyNodes: [
    { node_id: "root", title: "Hệ điều hành hiện đại", node_type: "root", parent_node_id: null },
    { node_id: "section-process", title: "Quản lý tiến trình", node_type: "section", parent_node_id: "root" },
    { node_id: "section-memory", title: "Quản lý bộ nhớ", node_type: "section", parent_node_id: "root" },
    { node_id: "concept-scheduling", title: longTitle, node_type: "concept", parent_node_id: "section-process" },
    { node_id: "concept-paging", title: "Phân trang theo yêu cầu", node_type: "concept", parent_node_id: "section-memory" },
    { node_id: "detail-deadlock", title: "Ví dụ nhận diện và phòng tránh bế tắc", node_type: "example", parent_node_id: "concept-scheduling" },
    { node_id: "detail-page", title: "Khung trang vật lý và không gian địa chỉ ảo", node_type: "example", parent_node_id: "concept-paging" },
  ],
};

