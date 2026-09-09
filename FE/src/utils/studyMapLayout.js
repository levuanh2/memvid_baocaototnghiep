// Layout của Sơ đồ kiến thức (StudyMap) — id RENDERER-ĐỘC-LẬP.
//
// `LAYOUT_IDS` không bao giờ được đọc thành "orientation"/"pathFunc" ở bất cứ đâu
// ngoài `thongSoReactD3Tree` bên dưới. localStorage, URL, hay một API tương lai chỉ
// biết đúng năm chữ này — đổi thư viện vẽ cây (`react-d3-tree` → thứ khác) thì CHỈ
// sửa hàm adapter, không sửa gì khác: không sửa StudyMapView, không sửa dữ liệu đã
// lưu của người dùng.
export const LAYOUT_IDS = [
  "auto", "tree-horizontal", "tree-vertical", "tree-curved", "tree-straight",
];

// Khớp NGUYÊN VĂN prop cứng hiện có trong StudyMapView trước khi có bộ chọn layout —
// đổi mặc định là một quyết định UX riêng, không phải tác dụng phụ của refactor này.
export const LAYOUT_MAC_DINH = "tree-horizontal";

const NHAN = {
  auto: "Tự động",
  "tree-horizontal": "Cây ngang",
  "tree-vertical": "Cây dọc",
  "tree-curved": "Cây ngang (cong)",
  "tree-straight": "Cây ngang (thẳng)",
};

export function nhanLayout(id) {
  return NHAN[id] || NHAN[LAYOUT_MAC_DINH];
}

// Bảng ánh xạ id → props thật của react-d3-tree. ĐÂY LÀ NƠI DUY NHẤT trong toàn bộ
// module biết tên "orientation"/"pathFunc" tồn tại — không export bảng này ra ngoài,
// chỉ export hàm đọc nó (`thongSoReactD3Tree`), để không ai ở tầng gọi lỡ tay đọc
// thẳng vào cấu trúc bên trong rồi khoá luôn vào react-d3-tree.
const ADAPTER = {
  "tree-horizontal": { orientation: "horizontal", pathFunc: "step" },
  "tree-vertical": { orientation: "vertical", pathFunc: "step" },
  "tree-curved": { orientation: "horizontal", pathFunc: "diagonal" },
  "tree-straight": { orientation: "horizontal", pathFunc: "straight" },
};

const mang = (v) => (Array.isArray(v) ? v : []);

/**
 * Heuristic THUẦN, không biết gì về react-d3-tree: cây CÀNG RỘNG (nhiều anh em
 * cùng cha) thì càng cần chỗ DỌC để không bị dồn cục; cây càng SÂU thì càng cần
 * chỗ NGANG để không phải cuộn dọc qua từng tầng. So `soConToiDa` (bề rộng lớn
 * nhất tại một cha) với `tangToiDa` (độ sâu) — rộng hơn sâu thì chọn dọc.
 */
export function layoutTuDong(nodes) {
  const list = mang(nodes).filter((n) => n && typeof n === "object" && n.node_id);
  if (!list.length) return LAYOUT_MAC_DINH;

  const soConTheoCha = new Map();
  let tangToiDa = 0;
  for (const n of list) {
    const cha = n.parent_node_id ?? "__goc__";
    soConTheoCha.set(cha, (soConTheoCha.get(cha) || 0) + 1);
    const tang = Number(n.level);
    if (Number.isFinite(tang) && tang > tangToiDa) tangToiDa = tang;
  }
  const soConToiDa = Math.max(0, ...soConTheoCha.values());

  return soConToiDa > tangToiDa * 2 ? "tree-vertical" : "tree-horizontal";
}

/**
 * Renderer adapter — hàm DUY NHẤT `StudyMapView` được gọi để lấy props cho `<Tree>`.
 * `"auto"` tự giải ra một id CỤ THỂ trước khi tra bảng — người gọi không bao giờ
 * thấy `orientation`/`pathFunc` mang giá trị "tự động".
 */
export function thongSoReactD3Tree(layoutId, nodes) {
  const id = layoutId === "auto" ? layoutTuDong(nodes) : layoutId;
  return ADAPTER[id] || ADAPTER[LAYOUT_MAC_DINH];
}
