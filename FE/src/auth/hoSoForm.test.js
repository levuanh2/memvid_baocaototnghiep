import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TRUONG, KHOA_SUA_DUOC, coThayDoi, kiemTra, loiDeDoc, ngayDeDoc, ngayHopLe, tuHoSo, veThayDoi,
} from "./hoSoForm";
import { layGrant, luuGrant, quenGrant, conHan, giayConLai } from "./grantNks";

/**
 * Biểu mẫu sửa hồ sơ NKS — logic thuần.
 *
 * Kho này chạy test ở env node, không có DOM, nên mọi quyết định đáng kiểm đều nằm
 * trong module thuần chứ không nằm trong component (xem `phienNguoiDung.test.js`).
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const doc = (p) => readFileSync(join(SRC, "..", p), "utf8");

/**
 * Nguồn đã BỎ chú thích.
 *
 * Các phép quét phủ định dưới đây hỏi "mã có làm việc này không", không phải "trang
 * này có nhắc tới nó không". `grantNks.js` giải thích khá dài vì sao nó KHÔNG dùng
 * localStorage — quét cả chú thích thì chính lời giải thích đó làm test đỏ, và cách
 * sửa duy nhất là xoá đi phần đáng giá nhất của file.
 */
const maNguon = (p) => doc(p)
  .replace(/\/\*[\s\S]*?\*\//g, " ")   // /* … */
  .replace(/(^|[^:])\/\/.*$/gm, "$1"); // // … (giữ "https://")
const NGUON_MOI = [
  "auth/hoSoForm.js",
  "auth/grantNks.js",
  "components/Layout/ProfileDrawer.jsx",
  "components/Layout/ProfileEditForm.jsx",
  "components/Layout/NksVerifyDialog.jsx",
];

const HO_SO = {
  provider: "nks", provider_user_id: "128", email: "a@example.com",
  display_name: "Teacher1", avatar: "https://data.nks.vn/a.jpg", role: "teacher",
  firstname: "Nguyễn Hữu", lastname: "Lực", phone: "0364967082", gender: 1,
  dob: "2004-08-18", website: null, pob: null, province: "TP.HCM", intro: "xin chào",
};

// ── 2. Nạp giá trị từ hồ sơ ──────────────────────────────────────────────────
describe("nạp biểu mẫu từ hồ sơ", () => {
  it("mọi ô là chuỗi; null thành rỗng, không thành 'null'", () => {
    const f = tuHoSo(HO_SO);
    expect(f.firstname).toBe("Nguyễn Hữu");
    expect(f.gender).toBe("1");            // số → chuỗi cho <select>
    expect(f.dob).toBe("2004-08-18");
    expect(f.website).toBe("");            // null → ""
    expect(f.pob).toBe("");
    expect(Object.values(f).every((v) => typeof v === "string")).toBe(true);
  });

  it("hồ sơ rỗng/thiếu không làm vỡ gì", () => {
    expect(Object.keys(tuHoSo(null))).toEqual(KHOA_SUA_DUOC);
    expect(Object.values(tuHoSo(undefined)).every((v) => v === "")).toBe(true);
  });
});

// ── 3. `name` không sửa được ─────────────────────────────────────────────────
describe("tên hiển thị KHÔNG phải ô sửa được", () => {
  it("không có `name`/`display_name` trong danh sách trường", () => {
    expect(KHOA_SUA_DUOC).not.toContain("name");
    expect(KHOA_SUA_DUOC).not.toContain("display_name");
  });

  it("CCCD và email cũng không có mặt", () => {
    for (const k of ["id_number", "id_date", "id_place", "email", "avatar", "role"]) {
      expect(KHOA_SUA_DUOC, k).not.toContain(k);
    }
  });

  it("danh sách khớp đúng hợp đồng backend `TRUONG_SUA_DUOC`", () => {
    expect([...KHOA_SUA_DUOC].sort()).toEqual(
      ["dob", "firstname", "gender", "intro", "lastname", "phone", "pob", "province", "website"]);
  });

  it("biểu mẫu không dựng được ô nào ngoài danh sách", () => {
    expect(TRUONG.every((t) => KHOA_SUA_DUOC.includes(t.khoa))).toBe(true);
  });
});

// ── 4. Chỉ gửi ô ĐÃ ĐỔI ──────────────────────────────────────────────────────
describe("dựng phần thay đổi", () => {
  it("không đổi gì ⇒ gửi rỗng", () => {
    const f = tuHoSo(HO_SO);
    expect(veThayDoi(f, f)).toEqual({});
    expect(coThayDoi(f, f)).toBe(false);
  });

  it("chỉ ô đã đổi mới được gửi — ô không đụng tới KHÔNG bị ghi đè", () => {
    const goc = tuHoSo(HO_SO);
    const moi = { ...goc, phone: "0911222333" };
    expect(veThayDoi(goc, moi)).toEqual({ phone: "0911222333" });
    expect(coThayDoi(goc, moi)).toBe(true);
  });

  it("xoá trắng một ô ⇒ null (backend dịch thành chuỗi rỗng)", () => {
    const goc = tuHoSo(HO_SO);
    expect(veThayDoi(goc, { ...goc, intro: "" })).toEqual({ intro: null });
  });

  it("giới tính về số, chuỗi khác được cắt khoảng trắng", () => {
    const goc = tuHoSo(HO_SO);
    expect(veThayDoi(goc, { ...goc, gender: "0" })).toEqual({ gender: 0 });
    expect(veThayDoi(goc, { ...goc, pob: "  Hà Nội  " })).toEqual({ pob: "Hà Nội" });
  });

  it("khoá lạ lọt vào biểu mẫu cũng không đi ra", () => {
    const goc = tuHoSo(HO_SO);
    expect(veThayDoi(goc, { ...goc, name: "Tên mới", id_number: "079" })).toEqual({});
  });
});

// ── 5. Kiểm tra nhập liệu ────────────────────────────────────────────────────
describe("lỗi nhập liệu", () => {
  it("hồ sơ thật thì không có lỗi nào", () => {
    expect(kiemTra(tuHoSo(HO_SO))).toEqual({});
  });

  it("ngày sinh sai định dạng hoặc không có thật", () => {
    expect(kiemTra({ dob: "18/08/2004" }).dob).toBeTruthy();
    expect(kiemTra({ dob: "2024-02-31" }).dob).toBeTruthy();   // 31/02 không tồn tại
    expect(kiemTra({ dob: "2004-13-01" }).dob).toBeTruthy();
    expect(kiemTra({ dob: "" }).dob).toBeUndefined();          // trống là hợp lệ
  });

  it("ngày sinh ở tương lai bị chặn", () => {
    const mai = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    expect(kiemTra({ dob: mai }).dob).toBeTruthy();
  });

  it("website phải có http(s)", () => {
    expect(kiemTra({ website: "vidu.com" }).website).toBeTruthy();
    expect(kiemTra({ website: "https://vidu.com" }).website).toBeUndefined();
  });

  it("điện thoại chỉ nhận chữ số và dấu thường gặp", () => {
    expect(kiemTra({ phone: "0364967082" }).phone).toBeUndefined();
    expect(kiemTra({ phone: "+84 (90) 123-4567" }).phone).toBeUndefined();
    expect(kiemTra({ phone: "gọi cho tôi" }).phone).toBeTruthy();
  });

  it("quá dài thì báo, và báo kèm tên ô", () => {
    const loi = kiemTra({ intro: "x".repeat(501) });
    expect(loi.intro).toContain("Giới thiệu");
  });

  it("giới tính chỉ nhận '', '0', '1'", () => {
    expect(kiemTra({ gender: "2" }).gender).toBeTruthy();
    for (const g of ["", "0", "1"]) expect(kiemTra({ gender: g }).gender).toBeUndefined();
  });
});

// ── Ngày: KHÔNG phụ thuộc locale ─────────────────────────────────────────────
describe("ngày tháng theo đúng một định dạng", () => {
  it("chỉ chấp nhận yyyy-mm-dd", () => {
    expect(ngayHopLe("2004-08-18")).toBe(true);
    for (const x of ["18/08/2004", "08/18/2004", "2004-8-18", "Aug 18 2004", "", null]) {
      expect(ngayHopLe(x), String(x)).toBe(false);
    }
  });

  it("không tự cuộn ngày tràn như `new Date` vẫn làm", () => {
    expect(ngayHopLe("2024-02-31")).toBe(false);
    expect(ngayHopLe("2023-02-29")).toBe(false);
    expect(ngayHopLe("2024-02-29")).toBe(true);   // năm nhuận thật
  });

  it("bản để đọc là dd/mm/yyyy, và chỉ dùng để hiển thị", () => {
    expect(ngayDeDoc("2004-08-18")).toBe("18/08/2004");
    expect(ngayDeDoc("khong-phai-ngay")).toBe("");
  });
});

// ── 9 + 11. Chứng từ: chỉ trong bộ nhớ ───────────────────────────────────────
describe("chứng từ ghi phía trình duyệt", () => {
  beforeEach(() => quenGrant());
  afterEach(() => quenGrant());

  it("giữ được rồi lấy lại được khi còn hạn", () => {
    const sau10phut = Date.now() / 1000 + 600;
    luuGrant("grant-abc", sau10phut);
    expect(layGrant()).toBe("grant-abc");
    expect(conHan()).toBe(true);
    expect(giayConLai()).toBeGreaterThan(500);
  });

  it("hết hạn ⇒ null, và tự quên", () => {
    luuGrant("grant-abc", Date.now() / 1000 - 1);
    expect(layGrant()).toBeNull();
    expect(conHan()).toBe(false);
    expect(giayConLai()).toBe(0);
  });

  it("có lề an toàn — không trả về chứng từ sắp chết trong vài giây", () => {
    luuGrant("grant-abc", Date.now() / 1000 + 2);
    expect(layGrant()).toBeNull();
  });

  it("quên thì mất hẳn", () => {
    luuGrant("grant-abc", Date.now() / 1000 + 600);
    quenGrant();
    expect(layGrant()).toBeNull();
  });

  it("KHÔNG chạm localStorage/sessionStorage ở bất kỳ file mới nào", () => {
    for (const f of NGUON_MOI) {
      expect(maNguon(f), f).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    }
  });
});

// ── 11. Token NKS không bao giờ xuất hiện phía trình duyệt ───────────────────
describe("không có bí mật NKS nào ở phía trình duyệt", () => {
  it("không file mới nào chạm access_token", () => {
    for (const f of NGUON_MOI) {
      expect(maNguon(f), f).not.toMatch(/access_token/);
    }
  });

  it("mật khẩu chỉ sống trong state của hộp xác minh, không đi đâu khác", () => {
    const dialog = doc("components/Layout/NksVerifyDialog.jsx");
    expect(dialog).toMatch(/type="password"/);
    // Không tự gọi mạng: nó chỉ đưa giá trị lên cho người gọi.
    expect(dialog).not.toMatch(/utils\/api|apiFetch|\bfetch\s*\(/);
    for (const f of ["components/Layout/ProfileEditForm.jsx"]) {
      expect(maNguon(f), f).not.toMatch(/password/i);
    }
  });

  it("chứng từ đi ở header, không nằm trong URL", () => {
    const api = doc("utils/api.js");
    expect(api).toMatch(/X-Grant-Id/);
    expect(api).not.toMatch(/profile\?grant/);
  });
});

// ── Thông điệp lỗi ───────────────────────────────────────────────────────────
describe("mã lỗi thành câu đọc được", () => {
  it("mỗi mã của máy chủ có một câu riêng", () => {
    expect(loiDeDoc("invalid_field")).toContain("không hợp lệ");
    expect(loiDeDoc("provider_unavailable")).toContain("NKS");
    expect(loiDeDoc("invalid_credentials")).toContain("mật khẩu");
    expect(loiDeDoc("rate_limited")).toContain("quá nhiều lần");
    expect(loiDeDoc(undefined, 0)).toContain("Không kết nối");
    expect(loiDeDoc("gi_do_la")).toBeTruthy();
  });

  it("`grant_required` KHÔNG phải câu để đọc — nó là tín hiệu mở hộp xác minh", () => {
    // Nếu ai đó thêm nó vào bảng thông điệp, người dùng sẽ thấy một lỗi khó hiểu
    // thay vì thấy hộp xác minh mở ra.
    expect(maNguon("auth/hoSoForm.js")).not.toMatch(/grant_required/);
    const drawer = doc("components/Layout/ProfileDrawer.jsx");
    expect(drawer).toMatch(/grant_required/);
    expect(drawer).toMatch(/setHoiMatKhau\(true\)/);
  });
});

// ── 12. LocalAuth không thấy nút ghi nào ─────────────────────────────────────
describe("tài khoản local", () => {
  it("nút Chỉnh sửa chỉ hiện với NKS", () => {
    // Cờ tính ở `ProfileDrawer`, nút vẽ ở `ProfileView` — kiểm cả hai đầu, vì tách
    // một trong hai ra là nút hiện cho cả tài khoản local mà không ai thấy.
    expect(doc("components/Layout/ProfileDrawer.jsx"))
      .toMatch(/laNks\s*=\s*hoSo\?\.nhaCungCap === "NKS"/);
    expect(doc("components/Layout/ProfileView.jsx"))
      .toMatch(/laNks && !dangSua && \(/);
  });
});

// ── 7. Huỷ trả lại giá trị gốc ───────────────────────────────────────────────
describe("huỷ chỉnh sửa", () => {
  it("đặt lại biểu mẫu về bản gốc, không giữ lại gì", () => {
    const goc = tuHoSo(HO_SO);
    const daSua = { ...goc, phone: "0900", intro: "khác" };
    expect(coThayDoi(goc, daSua)).toBe(true);
    expect(coThayDoi(goc, goc)).toBe(false);       // sau khi huỷ = đặt form về goc
    expect(veThayDoi(goc, goc)).toEqual({});
  });

  it("drawer đặt lại form về `goc` khi bấm Huỷ", () => {
    expect(doc("components/Layout/ProfileDrawer.jsx"))
      .toMatch(/onHuy=\{\(\) => \{ setForm\(goc\)/);
  });
});
