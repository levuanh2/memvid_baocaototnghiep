import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOAI_CHO_PHEP, TRAN_CHON_BYTE, DICH_BYTE, CANH_TOI_DA,
  AnhKhongHopLe, canhSauThuNho, kiemTraFile, thuNhoAnh,
} from "./anhDaiDienFile";
import { dungHoSo } from "./hoSoNguoiDung";

/**
 * Chuẩn bị ảnh đại diện phía trình duyệt.
 *
 * Kho này test ở env node, không có DOM — nên `thuNhoAnh` nhận `taoAnh`/`taoCanvas`
 * tiêm vào để đo được phần quyết định (kích thước, số vòng hạ chất lượng) mà không
 * cần canvas thật.
 *
 * Nhắc lại điều dễ nhầm: mọi thứ ở đây là TRẢI NGHIỆM, không phải an toàn. Máy chủ
 * kiểm lại toàn bộ, vì FE có thể bị bỏ qua hoàn toàn.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const doc = (p) => readFileSync(join(SRC, "..", p), "utf8");
const maNguon = (p) => doc(p)
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

const NGUON_MOI = [
  "auth/anhDaiDienFile.js",
  "components/Layout/AvatarPicker.jsx",
  "components/Layout/ProfileDrawer.jsx",
];

const file = (type, size) => ({ type, size, name: "a.jpg" });

// ── 5. Loại tệp ──────────────────────────────────────────────────────────────
describe("kiểm tra tệp trước khi xử lý", () => {
  it("nhận JPG/PNG/WEBP", () => {
    for (const t of LOAI_CHO_PHEP) expect(kiemTraFile(file(t, 1000))).toBeNull();
  });

  it("từ chối loại khác — kể cả loại nghe có vẻ là ảnh", () => {
    for (const t of ["image/svg+xml", "image/gif", "application/pdf",
                     "text/html", "application/octet-stream", ""]) {
      expect(kiemTraFile(file(t, 1000)), t).toBeTruthy();
    }
  });

  it("SVG bị từ chối có chủ đích — nó chạy được script", () => {
    expect(kiemTraFile(file("image/svg+xml", 500))).toContain("JPG");
  });

  it("chưa chọn gì thì báo rõ", () => {
    expect(kiemTraFile(null)).toBe("Chưa chọn ảnh.");
  });
});

// ── 6. Kích thước ────────────────────────────────────────────────────────────
describe("trần kích thước tệp chọn", () => {
  it("quá lớn bị chặn, kèm số MB đọc được", () => {
    const loi = kiemTraFile(file("image/jpeg", TRAN_CHON_BYTE + 1));
    expect(loi).toBeTruthy();
    expect(loi).toContain("MB");
  });

  it("đúng bằng trần vẫn nhận", () => {
    expect(kiemTraFile(file("image/jpeg", TRAN_CHON_BYTE))).toBeNull();
  });
});

// ── Thu nhỏ: giữ tỉ lệ, không phóng to ───────────────────────────────────────
describe("tính cạnh sau thu nhỏ", () => {
  it("cạnh dài nhất về đúng 512, giữ tỉ lệ", () => {
    expect(canhSauThuNho(3000, 2000)).toEqual({ rong: 512, cao: 341 });
    expect(canhSauThuNho(2000, 3000)).toEqual({ rong: 341, cao: 512 });
    expect(canhSauThuNho(1000, 1000)).toEqual({ rong: 512, cao: 512 });
  });

  it("ảnh nhỏ hơn 512 KHÔNG bị phóng to — phóng to chỉ làm ảnh mờ và file to hơn", () => {
    expect(canhSauThuNho(100, 80)).toEqual({ rong: 100, cao: 80 });
    expect(canhSauThuNho(CANH_TOI_DA, CANH_TOI_DA)).toEqual({ rong: 512, cao: 512 });
  });

  it("kích thước vô lý không làm vỡ", () => {
    expect(canhSauThuNho(0, 0)).toEqual({ rong: 0, cao: 0 });
    expect(canhSauThuNho(-5, 10)).toEqual({ rong: 0, cao: 0 });
  });
});

// ── Vòng hạ chất lượng ───────────────────────────────────────────────────────
function canvasGia(kichCo) {
  const goi = [];
  return {
    goi,
    tao: (rong, cao) => ({
      width: rong,
      height: cao,
      getContext: () => ({ drawImage: () => {} }),
      toBlob: (cb, _type, chatLuong) => {
        goi.push(chatLuong);
        cb({ size: kichCo(chatLuong), type: "image/jpeg" });
      },
    }),
  };
}

describe("thu nhỏ ảnh", () => {
  const anhGia = (w, h) => async () => ({ width: w, height: h });

  it("đạt đích ngay lần đầu thì KHÔNG hạ chất lượng thêm", async () => {
    const c = canvasGia(() => 100 * 1024);
    const blob = await thuNhoAnh(file("image/jpeg", 5000),
                                 { taoAnh: anhGia(1000, 800), taoCanvas: c.tao });
    expect(blob.size).toBeLessThanOrEqual(DICH_BYTE);
    expect(c.goi).toEqual([0.85]);
  });

  it("chưa đạt đích thì hạ dần chất lượng", async () => {
    const c = canvasGia((q) => (q === 0.85 ? 900 * 1024 : 200 * 1024));
    await thuNhoAnh(file("image/jpeg", 5000), { taoAnh: anhGia(4000, 3000), taoCanvas: c.tao });
    expect(c.goi).toEqual([0.85, 0.7]);
  });

  it("không bao giờ đạt đích thì vẫn GỬI bản nhỏ nhất, không bế tắc", async () => {
    // Máy chủ có trần riêng và là bên nói lời cuối. Chặn ở đây nữa chỉ khiến người
    // dùng không hiểu vì sao mình không đổi được ảnh.
    const c = canvasGia(() => 900 * 1024);
    const blob = await thuNhoAnh(file("image/jpeg", 5000),
                                 { taoAnh: anhGia(4000, 3000), taoCanvas: c.tao });
    expect(c.goi).toEqual([0.85, 0.7, 0.55]);
    expect(blob.size).toBe(900 * 1024);
  });

  it("tệp sai loại bị chặn TRƯỚC khi đụng canvas", async () => {
    const c = canvasGia(() => 1000);
    const taoAnh = vi.fn();
    await expect(thuNhoAnh(file("application/pdf", 1000), { taoAnh, taoCanvas: c.tao }))
      .rejects.toBeInstanceOf(AnhKhongHopLe);
    expect(taoAnh).not.toHaveBeenCalled();
    expect(c.goi).toEqual([]);
  });

  it("ảnh 0x0 bị từ chối", async () => {
    const c = canvasGia(() => 1000);
    await expect(thuNhoAnh(file("image/jpeg", 1000),
                           { taoAnh: anhGia(0, 0), taoCanvas: c.tao }))
      .rejects.toBeInstanceOf(AnhKhongHopLe);
  });
});

// ── 1 + 2. Hiển thị ảnh / chữ cái ───────────────────────────────────────────
describe("ảnh đại diện hiển thị", () => {
  it("có avatar https ⇒ dùng URL đó", () => {
    const hs = dungHoSo({ id: "u1", email: "a@vidu.com", display_name: "Trần Bình",
                          avatar: "https://data.nks.vn/storage/users/1.jpg" });
    expect(hs.avatar).toBe("https://data.nks.vn/storage/users/1.jpg");
  });

  it("không có avatar ⇒ chữ cái", () => {
    const hs = dungHoSo({ id: "u1", email: "a@vidu.com", display_name: "Trần Bình" });
    expect(hs.avatar).toBeNull();
    expect(hs.chuCai).toBe("TB");
  });

  it("avatar không phải https tuyệt đối ⇒ rơi về chữ cái", () => {
    for (const x of ["http://d.nks.vn/a.jpg", "data:image/png;base64,iVBOR",
                     "javascript:alert(1)", "/a.jpg"]) {
      expect(dungHoSo({ id: "u", email: "a@b.c", avatar: x }).avatar, x).toBeNull();
    }
  });
});

// ── 13. Không lưu bí mật; ảnh chưa lưu không rời máy ────────────────────────
describe("không rò gì phía trình duyệt", () => {
  it("không file mới nào chạm localStorage/sessionStorage hay access_token", () => {
    for (const f of NGUON_MOI) {
      expect(maNguon(f), f).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(maNguon(f), f).not.toMatch(/access_token/);
    }
  });

  it("xem trước dùng object URL và ĐƯỢC THU HỒI — không rò bộ nhớ", () => {
    const drawer = doc("components/Layout/ProfileDrawer.jsx");
    expect(drawer).toMatch(/URL\.createObjectURL/);
    expect(drawer).toMatch(/URL\.revokeObjectURL/);
  });

  it("ảnh gửi đi bằng multipart, KHÔNG base64 trong trình duyệt", () => {
    const api = doc("utils/api.js");
    expect(api).toMatch(/FormData/);
    expect(maNguon("utils/api.js")).not.toMatch(/toDataURL|btoa\(/);
  });
});

// ── 9 + 11 + 12. Trạng thái ─────────────────────────────────────────────────
describe("hành vi lưu ảnh trong drawer", () => {
  const drawer = () => doc("components/Layout/ProfileDrawer.jsx");

  it("chặn gửi trùng bằng cờ đang tải", () => {
    expect(drawer()).toMatch(/if \(!anhCho \|\| dangTaiAnh\) return false;/);
  });

  it("chứng từ hết hạn ⇒ GIỮ ảnh đã chọn và mở hộp xác minh", () => {
    const s = drawer();
    expect(s).toMatch(/viecCho.*"anh"|setViecCho\("anh"\)/);
    expect(s).toMatch(/grant_required/);
    // Nhánh grant_required KHÔNG được gọi `boAnhCho` — đó là chỗ ảnh sẽ mất.
    const nhanh = s.slice(s.indexOf("const luuAnh"), s.indexOf("const batDauLuuAnh"));
    const sauLoi = nhanh.slice(nhanh.indexOf("grant_required"));
    expect(sauLoi).not.toMatch(/boAnhCho\(\)/);
  });

  it("huỷ trả lại ảnh cũ — ảnh cũ chưa từng bị đụng tới", () => {
    expect(drawer()).toMatch(/onHuy=\{boAnhCho\}/);
    // Xem trước là lớp phủ; `hoSo.avatar` vẫn là nguồn khi không có ảnh chờ.
    expect(doc("components/Layout/AvatarPicker.jsx")).toMatch(/src=\{xemTruoc \|\| avatar\}/);
  });

  it("lưu thành công thì đẩy hồ sơ mới lên trên — header đổi ngay, không cần F5", () => {
    expect(drawer()).toMatch(/onHoSoMoi\?\.\(moi\);/);
  });
});

// ── 14. LocalAuth không đổi hành vi ─────────────────────────────────────────
describe("tài khoản local", () => {
  it("không có khối đổi ảnh nào", () => {
    expect(doc("components/Layout/ProfileDrawer.jsx")).toMatch(/khoiAnh=\{laNks \?/);
  });

  it("vẫn hiện chữ cái và các dòng chỉ đọc như trước", () => {
    const hs = dungHoSo({ id: "u-2", display_name: "Trần Bình",
                          email: "binh@vidu.com", role: "learner" });
    expect(hs.chuCai).toBe("TB");
    expect(hs.dong.map((d) => d.khoa)).toEqual(["email", "role"]);
  });
});
