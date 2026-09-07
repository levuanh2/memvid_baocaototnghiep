import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { xoaDuLieuPhienNguoiDung } from "./phienNguoiDung";
import { nhoNguon, nguonConDangXuLy } from "../utils/nguonDangXuLy";
import { saveActiveMindmapJob, loadActiveMindmapJob } from "../utils/activeMindmapJob";
import { saveActiveSummaryJob, loadActiveSummaryJob } from "../utils/activeSummaryJob";

/**
 * Đăng xuất phải dọn state THUỘC NGƯỜI DÙNG trong localStorage.
 *
 * Ca thật đứng sau bộ test này: A tải lên "bao-cao-mat.pdf" → đăng xuất → B đăng
 * nhập trên CÙNG trình duyệt. `SidebarLeft` lúc mount đọc `memvid.nguon_dang_xu_ly`
 * và vẽ thẳng `filename` ra thẻ, KHÔNG gọi backend. Mọi kiểm tra quyền phía server
 * đều vô nghĩa ở đây vì dữ liệu chưa từng rời trình duyệt.
 *
 * "B không thấy dữ liệu của A khi gọi API" KHÔNG chứng minh được điều này.
 */

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _keys: () => [...m.keys()],
  };
}

const realLS = globalThis.localStorage;
beforeEach(() => { globalThis.localStorage = memLocalStorage(); });
afterEach(() => { globalThis.localStorage = realLS; });

describe("xoaDuLieuPhienNguoiDung", () => {
  it("xoá tên tài liệu của người dùng trước — ca rò rỉ chính", () => {
    nhoNguon({ sourceId: "src-cua-A", filename: "bao-cao-mat.pdf" });
    expect(nguonConDangXuLy()).toHaveLength(1);

    xoaDuLieuPhienNguoiDung();

    expect(nguonConDangXuLy()).toEqual([]);
    // Tên file không được còn sót ở BẤT KỲ khoá nào.
    const con = globalThis.localStorage._keys()
      .map((k) => globalThis.localStorage.getItem(k)).join(" ");
    expect(con).not.toContain("bao-cao-mat.pdf");
  });

  it("xoá job sơ đồ/tóm tắt đang chạy của người dùng trước", () => {
    saveActiveMindmapJob({ jobId: "job-A", sources: ["tai-lieu-cua-A"], startedAt: Date.now() });
    saveActiveSummaryJob({ jobId: "job-A2", sources: ["tai-lieu-cua-A"], startedAt: Date.now() });
    expect(loadActiveMindmapJob()).not.toBeNull();
    expect(loadActiveSummaryJob()).not.toBeNull();

    xoaDuLieuPhienNguoiDung();

    expect(loadActiveMindmapJob()).toBeNull();
    expect(loadActiveSummaryJob()).toBeNull();
  });

  it("KHÔNG xoá lựa chọn của THIẾT BỊ (giao diện sáng/tối, bề rộng cột)", () => {
    // Hai khoá này không mang dữ liệu của ai. Xoá chúng là bắt người dùng chỉnh
    // lại giao diện sau mỗi lần đăng xuất — phiền mà chẳng bảo vệ được gì.
    globalThis.localStorage.setItem("memvid-theme", "dark");
    globalThis.localStorage.setItem("memvidx.panels.v1", '{"width":{"left":300}}');
    nhoNguon({ sourceId: "s1", filename: "x.pdf" });

    xoaDuLieuPhienNguoiDung();

    expect(globalThis.localStorage.getItem("memvid-theme")).toBe("dark");
    expect(globalThis.localStorage.getItem("memvidx.panels.v1")).toContain("300");
  });

  it("gọi trên localStorage rỗng không ném", () => {
    expect(() => xoaDuLieuPhienNguoiDung()).not.toThrow();
    expect(nguonConDangXuLy()).toEqual([]);
  });

  it("gọi hai lần liên tiếp vẫn an toàn (đăng xuất rồi token hết hạn)", () => {
    nhoNguon({ sourceId: "s1", filename: "x.pdf" });
    xoaDuLieuPhienNguoiDung();
    expect(() => xoaDuLieuPhienNguoiDung()).not.toThrow();
    expect(nguonConDangXuLy()).toEqual([]);
  });

  it("A → dọn → B: danh sách của B bắt đầu từ số 0, không kế thừa gì", () => {
    nhoNguon({ sourceId: "A-1", filename: "cua-A.pdf" });
    nhoNguon({ sourceId: "A-2", filename: "cua-A-2.pdf" });
    xoaDuLieuPhienNguoiDung();

    nhoNguon({ sourceId: "B-1", filename: "cua-B.pdf" });
    const ds = nguonConDangXuLy();
    expect(ds).toHaveLength(1);
    expect(ds[0].sourceId).toBe("B-1");
    expect(ds.map((x) => x.filename)).not.toContain("cua-A.pdf");
  });
});
