import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dungHoSo, chuCaiDaiDien, anhDaiDien, nhanNhaCungCap, nhanVaiTro } from "./hoSoNguoiDung";
import ProfileView from "../components/Layout/ProfileView";
import Modal from "../components/ui/Modal";

/**
 * Hồ sơ CHỈ ĐỌC — NKS là nguồn sự thật, StudyMap không giữ bản sao.
 *
 * Kho này chạy test ở env node, không có DOM (xem `phienNguoiDung.test.js`). Nên
 * `ProfileView` được viết KHÔNG hook và gọi thẳng như một hàm: nó trả về cây
 * element của React — dữ liệu thuần, đọc được — thay vì phải render. Đổi lại là
 * không phải kéo jsdom + testing-library vào chỉ để xem một ngăn hồ sơ.
 *
 * `ProfileDrawer` (bọc ngoài) giữ state của chế độ sửa nên KHÔNG gọi thẳng được nữa;
 * phần logic của nó được đo ở `hoSoForm.test.js`.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const doc = (p) => readFileSync(join(SRC, "..", p), "utf8");
const NGUON_MOI = [
  "auth/hoSoNguoiDung.js",
  "components/Layout/ProfileDrawer.jsx",
  "components/Layout/ProfileView.jsx",
  "components/Layout/AccountMenu.jsx",
  "components/ui/Avatar.jsx",
];

/** Gom mọi chuỗi thấy được trong cây element: text con + giá trị prop dạng chuỗi. */
function chuoiTrongCay(node, out = []) {
  if (node == null || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const n of node) chuoiTrongCay(n, out); return out; }
  if (typeof node === "object" && node.props) {
    for (const [k, v] of Object.entries(node.props)) {
      if (k === "children" || k === "className" || k === "style") continue;
      if (typeof v === "string") out.push(v);
    }
    chuoiTrongCay(node.props.children, out);
  }
  return out;
}

const NGUOI_NKS = {
  id: "u-1",
  display_name: "Nguyễn Hữu Lực",
  email: "nks.manager01@example.com",
  phone: "0900010001",
  role: "admin",
  provider: "nks",
  avatar: "https://account.nks.vn/upload/avatar/91.jpg",
};
const NGUOI_LOCAL = { id: "u-2", display_name: "Trần Bình", email: "binh@vidu.com", role: "learner" };

const ve = (user, open = true) =>
  (open ? ProfileView({ hoSo: dungHoSo(user), onClose: () => {} }) : null);

// ── 1. mở ────────────────────────────────────────────────────────────────────
describe("1. ngăn hồ sơ mở", () => {
  it("open=true ⇒ có cây element; open=false ⇒ null", () => {
    expect(ve(NGUOI_NKS, true)).not.toBeNull();
    expect(ve(NGUOI_NKS, false)).toBeNull();
  });

  it("chưa đăng nhập ⇒ null, không dựng hồ sơ rỗng", () => {
    expect(dungHoSo(null)).toBeNull();
    expect(ProfileView({ hoSo: null, onClose: () => {} })).toBeNull();
  });

  it("đi qua Modal — tức là thừa hưởng Escape/bấm-ra-ngoài/nút đóng có sẵn", () => {
    expect(ve(NGUOI_NKS).type).toBe(Modal);
  });
});

// ── 2. các trường ────────────────────────────────────────────────────────────
describe("2. tên · email · điện thoại · vai trò", () => {
  it("hiện đủ khi NKS trả đủ", () => {
    const t = chuoiTrongCay(ve(NGUOI_NKS));
    expect(t).toContain("Nguyễn Hữu Lực");
    expect(t).toContain("nks.manager01@example.com");
    expect(t).toContain("0900010001");
    expect(t).toContain("Quản trị");
  });

  it("vai trò dịch sang tiếng Việt, vai trò lạ giữ nguyên văn", () => {
    expect(nhanVaiTro("learner")).toBe("Học viên");
    expect(nhanVaiTro("teacher")).toBe("Giảng viên");
    expect(nhanVaiTro("admin")).toBe("Quản trị");
    expect(nhanVaiTro("Faculty")).toBe("Faculty");   // hiện ra để còn biết mà ánh xạ
    expect(nhanVaiTro("")).toBeNull();
  });

  it("thiếu trường ⇒ MẤT dòng, không hiện ô trống có nhãn", () => {
    const hs = dungHoSo({ email: "x@vidu.com" });
    expect(hs.dong.map((d) => d.khoa)).toEqual(["email"]);
  });

  it("không có tên thì lấy phần trước @, không lấy id", () => {
    expect(dungHoSo({ id: "u-9", email: "binh@vidu.com" }).ten).toBe("binh");
  });
});

// ── 3. nhà cung cấp ──────────────────────────────────────────────────────────
describe("3. dấu hiệu đăng nhập qua NKS", () => {
  it("người NKS: có nhãn NKS và câu nói rõ ai là nguồn sự thật", () => {
    const t = chuoiTrongCay(ve(NGUOI_NKS));
    expect(t).toContain("NKS");
    expect(t.join(" ")).toContain("do NKS quản lý");
  });

  it("không biết provider ⇒ KHÔNG đoán là local", () => {
    expect(nhanNhaCungCap(undefined)).toBeNull();
    expect(nhanNhaCungCap("")).toBeNull();
    expect(nhanNhaCungCap("nks")).toBe("NKS");
    expect(nhanNhaCungCap("LOCAL")).toBe("StudyMap");
    expect(dungHoSo(NGUOI_LOCAL).dong.map((d) => d.khoa)).not.toContain("provider");
  });
});

// ── 4. ảnh đại diện ──────────────────────────────────────────────────────────
describe("4. ảnh đại diện khi có URL", () => {
  it("URL https đi thẳng vào cây", () => {
    expect(chuoiTrongCay(ve(NGUOI_NKS))).toContain(NGUOI_NKS.avatar);
  });

  it("chỉ nhận https tuyệt đối — mọi thứ khác rơi về chữ cái", () => {
    expect(anhDaiDien({ avatar: "https://a.nks.vn/x.jpg" })).toBe("https://a.nks.vn/x.jpg");
    expect(anhDaiDien({ avatar: "http://a.nks.vn/x.jpg" })).toBeNull();
    expect(anhDaiDien({ avatar: "data:image/png;base64,iVBOR" })).toBeNull();
    expect(anhDaiDien({ avatar: "javascript:alert(1)" })).toBeNull();
    expect(anhDaiDien({ avatar: "/upload/91.jpg" })).toBeNull();
    expect(anhDaiDien({})).toBeNull();
  });
});

// ── 5. chữ cái thay ảnh ──────────────────────────────────────────────────────
describe("5. không có ảnh ⇒ chữ cái", () => {
  it("dựng chữ cái từ tên", () => {
    expect(chuCaiDaiDien("Nguyễn Hữu Lực", "a@b.c")).toBe("NL");
    expect(chuCaiDaiDien("Bình", "a@b.c")).toBe("BÌ");
    expect(chuCaiDaiDien("", "binh@vidu.com")).toBe("B");
    expect(chuCaiDaiDien("", "")).toBe("?");
  });

  it("hồ sơ không ảnh vẫn có chữ cái trong cây, và không có URL nào", () => {
    const hs = dungHoSo(NGUOI_LOCAL);
    expect(hs.avatar).toBeNull();
    expect(chuoiTrongCay(ve(NGUOI_LOCAL))).toContain("TB");
  });

  it("chữ cái LUÔN được dựng, kể cả khi có ảnh — ảnh hỏng là lộ ra ngay", () => {
    expect(dungHoSo(NGUOI_NKS).chuCai).toBe("NL");
  });
});

// ── 6. LocalAuth ─────────────────────────────────────────────────────────────
describe("6. tài khoản local vẫn hiện đúng", () => {
  it("hiện tên/email/vai trò, không có dòng NKS nào", () => {
    const t = chuoiTrongCay(ve(NGUOI_LOCAL));
    expect(t).toContain("Trần Bình");
    expect(t).toContain("binh@vidu.com");
    expect(t).toContain("Học viên");
    expect(t.join(" ")).not.toContain("NKS");
  });

  it("payload `/auth/me` hôm nay (không avatar/phone/provider) không làm vỡ gì", () => {
    const u = { id: "u-3", email: "a@vidu.com", display_name: "A", role: "learner" };
    expect(dungHoSo(u).dong.map((d) => d.khoa)).toEqual(["email", "role"]);
    expect(ve(u)).not.toBeNull();
  });
});

// ── 7. đóng ──────────────────────────────────────────────────────────────────
describe("7. ngăn hồ sơ đóng", () => {
  it("onClose truyền thẳng xuống Modal — một đường đóng cho cả ba lối", () => {
    const dong = () => {};
    const el = ProfileView({ hoSo: dungHoSo(NGUOI_NKS), onClose: dong });
    expect(el.props.onClose).toBe(dong);
    expect(el.props.title).toBe("Hồ sơ tài khoản");
  });
});

// ── 8. không lưu bí mật ──────────────────────────────────────────────────────
describe("8. không có bí mật nào được giữ lại", () => {
  it("không file mới nào chạm localStorage/sessionStorage", () => {
    for (const f of NGUON_MOI) {
      expect(doc(f), f).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });

  it("hồ sơ dựng ra không mang theo token dù user có lỡ chứa", () => {
    const hs = dungHoSo({ ...NGUOI_NKS, access_token: "eyJ0eXAiOiJKV1Q", password: "12345678" });
    const phang = JSON.stringify(hs);
    expect(phang).not.toContain("eyJ0eXAiOiJKV1Q");
    expect(phang).not.toContain("12345678");
    expect(Object.keys(hs)).not.toContain("access_token");
    expect(hs.dong.map((d) => d.khoa)).toEqual(["email", "phone", "role", "provider"]);
  });
});

// ── 9. mở ngăn không gọi mạng ────────────────────────────────────────────────
describe("9. mở ngăn hồ sơ không sinh request nào", () => {
  it("phần HIỂN THỊ không import utils/api — nó không có đường nào gọi mạng", () => {
    for (const f of ["auth/hoSoNguoiDung.js", "components/Layout/ProfileView.jsx",
                     "components/ui/Avatar.jsx", "components/Layout/AccountMenu.jsx"]) {
      expect(doc(f), f).not.toMatch(/utils\/api|apiFetch|\bfetch\s*\(/);
    }
  });

  it("ProfileDrawer có gọi mạng, nhưng KHÔNG có useEffect nên mở ngăn không tự bắn gì", () => {
    // Đây mới là điều cần khoá. `ProfileDrawer` PHẢI import `utils/api` (chế độ sửa
    // cần nó), nên cấm import là cấm nhầm chỗ. Thứ bảo đảm "mở ngăn = 0 request" là
    // mọi lời gọi đều nằm trong handler do người dùng bấm — tức là không có effect
    // nào chạy lúc mount.
    const drawer = doc("components/Layout/ProfileDrawer.jsx");
    expect(drawer).toMatch(/utils\/api/);
    expect(drawer).not.toMatch(/useEffect/);
  });

  it("dựng hồ sơ là phép thuần: gọi hai lần cho kết quả bằng nhau", () => {
    expect(dungHoSo(NGUOI_NKS)).toEqual(dungHoSo(NGUOI_NKS));
  });
});
