import { describe, expect, it } from "vitest";

import {
  LAYOUT_IDS, LAYOUT_MAC_DINH, layoutTuDong, nhanLayout, thongSoReactD3Tree,
} from "./studyMapLayout";

const node = (id, parent, level) => ({ node_id: id, parent_node_id: parent, level });

// Cây HẸP-SÂU: một nhánh, 5 tầng, không ai có quá 1 con.
const CAY_HEP_SAU = [
  node("r", null, 0), node("a", "r", 1), node("b", "a", 2),
  node("c", "b", 3), node("d", "c", 4),
];

// Cây RỘNG-NÔNG: gốc có 8 con trực tiếp, chỉ 2 tầng.
const CAY_RONG_NONG = [
  node("r", null, 0),
  ...Array.from({ length: 8 }, (_, i) => node(`c${i}`, "r", 1)),
];

describe("layout — nhận diện renderer-độc-lập", () => {
  it("liệt kê đúng năm id, không lộ chi tiết react-d3-tree ra ngoài", () => {
    expect(LAYOUT_IDS).toEqual(["auto", "tree-horizontal", "tree-vertical", "tree-curved", "tree-straight"]);
    expect(LAYOUT_MAC_DINH).toBe("tree-horizontal");
  });

  it("gắn nhãn tiếng Việt cho từng id và không nổ với id lạ", () => {
    for (const id of LAYOUT_IDS) expect(nhanLayout(id)).toBeTruthy();
    expect(nhanLayout("khong-ton-tai")).toBeTruthy();
    expect(nhanLayout(null)).toBeTruthy();
  });
});

describe("adapter — CHỈ chỗ này biết chữ 'orientation'/'pathFunc' của react-d3-tree", () => {
  it("tree-horizontal khớp ĐÚNG hành vi mặc định hiện tại (chống hồi quy)", () => {
    expect(thongSoReactD3Tree("tree-horizontal", CAY_HEP_SAU))
      .toEqual({ orientation: "horizontal", pathFunc: "step" });
  });

  it("tree-vertical / tree-curved / tree-straight đúng như ví dụ đã duyệt", () => {
    expect(thongSoReactD3Tree("tree-vertical", CAY_HEP_SAU))
      .toEqual({ orientation: "vertical", pathFunc: "step" });
    expect(thongSoReactD3Tree("tree-curved", CAY_HEP_SAU))
      .toEqual({ orientation: "horizontal", pathFunc: "diagonal" });
    expect(thongSoReactD3Tree("tree-straight", CAY_HEP_SAU))
      .toEqual({ orientation: "horizontal", pathFunc: "straight" });
  });

  it("id lạ hoặc thiếu rơi về mặc định, không bao giờ trả undefined", () => {
    expect(thongSoReactD3Tree("khong-ton-tai", CAY_HEP_SAU))
      .toEqual({ orientation: "horizontal", pathFunc: "step" });
    expect(thongSoReactD3Tree(null, CAY_HEP_SAU))
      .toEqual({ orientation: "horizontal", pathFunc: "step" });
    expect(thongSoReactD3Tree(undefined, null))
      .toEqual({ orientation: "horizontal", pathFunc: "step" });
  });

  it("'auto' luôn giải ra một bộ thông số CỤ THỂ, không bao giờ tự thân là 'auto'", () => {
    const kq = thongSoReactD3Tree("auto", CAY_RONG_NONG);
    expect(["horizontal", "vertical"]).toContain(kq.orientation);
    expect(kq.pathFunc).toBe("step");
  });
});

describe("layoutTuDong — heuristic thuần, không đụng react-d3-tree", () => {
  it("cây hẹp-sâu chọn tree-horizontal (đủ chỗ ngang cho nhiều tầng)", () => {
    expect(layoutTuDong(CAY_HEP_SAU)).toBe("tree-horizontal");
  });

  it("cây rộng-nông chọn tree-vertical (nhiều anh em cùng tầng cần chỗ dọc)", () => {
    expect(layoutTuDong(CAY_RONG_NONG)).toBe("tree-vertical");
  });

  it("không nổ với danh sách rỗng hoặc hỏng, rơi về mặc định", () => {
    expect(layoutTuDong([])).toBe(LAYOUT_MAC_DINH);
    expect(layoutTuDong(null)).toBe(LAYOUT_MAC_DINH);
    expect(layoutTuDong([null, {}, "rác"])).toBe(LAYOUT_MAC_DINH);
  });

  it("không sửa mảng node truyền vào", () => {
    const before = JSON.stringify(CAY_RONG_NONG);
    layoutTuDong(CAY_RONG_NONG);
    thongSoReactD3Tree("auto", CAY_RONG_NONG);
    expect(JSON.stringify(CAY_RONG_NONG)).toBe(before);
  });
});
