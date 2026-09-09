// MỘT truy vết cha-con duy nhất, dùng chung cho focus mode, "hiện kết quả tìm" (mở
// tổ tiên của một node khớp để nó lộ ra trong cây đang gập), và breadcrumb sau này.
// Không viết lại phép duyệt cây ba lần cho ba tính năng — mọi nơi cần "node này liên
// quan tới những node nào" đều gọi ĐÚNG hàm này.
const mang = (v) => (Array.isArray(v) ? v : []);

function chiMuc(nodes) {
  const byId = new Map();
  for (const n of mang(nodes)) {
    if (n && typeof n === "object" && n.node_id) byId.set(n.node_id, n);
  }
  return byId;
}

const RONG = () => ({ ancestors: [], descendants: new Set(), all: new Set() });

/**
 * `ancestors`: gốc→...→cha (KHÔNG gồm chính node) — dùng thẳng làm breadcrumb.
 * `descendants`: mọi tầng bên dưới, không riêng con trực tiếp.
 * `all`: tổ tiên + chính node + hậu duệ — tập "còn sáng" khi node này được focus.
 */
export function lienQuanCuaNode(nodeId, nodes) {
  const byId = chiMuc(nodes);
  if (!nodeId || !byId.has(nodeId)) return RONG();

  // Tổ tiên: đi ngược parent_node_id. Tập `da_tham` chặn vòng lặp dữ liệu hỏng
  // (cha trỏ vòng lại con) thay vì treo trình duyệt.
  const ancestors = [];
  const daTham = new Set([nodeId]);
  let cur = byId.get(nodeId);
  while (cur?.parent_node_id && byId.has(cur.parent_node_id) && !daTham.has(cur.parent_node_id)) {
    daTham.add(cur.parent_node_id);
    ancestors.unshift(cur.parent_node_id);
    cur = byId.get(cur.parent_node_id);
  }

  // Hậu duệ: BFS xuôi theo con, dựng chỉ mục cha→[con] một lần.
  const conCua = new Map();
  for (const n of byId.values()) {
    if (n.parent_node_id && byId.has(n.parent_node_id) && n.parent_node_id !== n.node_id) {
      if (!conCua.has(n.parent_node_id)) conCua.set(n.parent_node_id, []);
      conCua.get(n.parent_node_id).push(n.node_id);
    }
  }
  const descendants = new Set();
  const hangDoi = [...(conCua.get(nodeId) || [])];
  while (hangDoi.length) {
    const id = hangDoi.shift();
    if (descendants.has(id)) continue;
    descendants.add(id);
    hangDoi.push(...(conCua.get(id) || []));
  }

  return { ancestors, descendants, all: new Set([...ancestors, nodeId, ...descendants]) };
}
