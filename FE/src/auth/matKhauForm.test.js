import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  O, KHOA, DAI_TOI_THIEU, DAI_TOI_DA,
  bieuMauRong, guiDuoc, kiemTra, loiDeDoc, sauKhiHong, trangThaiSach,
} from "./matKhauForm";
import { MA_THONG_BAO, thongBaoSauDangXuat } from "./loginForm";
import { dungHoSo } from "./hoSoNguoiDung";

/**
 * Đổi mật khẩu NKS — logic thuần.
 *
 * Kho này test ở env node, không có DOM (xem `phienNguoiDung.test.js`), nên quyết
 * định "yêu cầu này có được gửi đi không" nằm trong module thuần chứ không trong
 * component. Ở đây điều đó quan trọng hơn bình thường: thứ sắp rời máy là mật khẩu
 * của một hệ thống khác.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const doc = (p) => readFileSync(join(SRC, "..", p), "utf8");
const maNguon = (p) => doc(p)
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

const NGUON_MOI = [
  "auth/matKhauForm.js",
  "components/Layout/ChangePasswordDialog.jsx",
  "components/Layout/AccountMenu.jsx",
];

const CU = "mat-khau-cu-7f2a";
const MOI = "mat-khau-moi-9c4b";
const day = (over = {}) => ({
  identifier: "nguoi-dung-nks", oldPassword: CU,
  password: MOI, passwordConfirmation: MOI, ...over,
});

// ── 3. Kiểm dữ liệu nhập ────────────────────────────────────────────────────
describe("kiểm dữ liệu nhập", () => {
  it("biểu mẫu đầy đủ và hợp lệ ⇒ gửi được", () => {
    expect(kiemTra(day())).toEqual({});
    expect(guiDuoc(day())).toBe(true);
  });

  it("thiếu trường nào báo đúng trường đó", () => {
    expect(kiemTra(day({ identifier: "" })).identifier).toBeTruthy();
    expect(kiemTra(day({ identifier: "   " })).identifier).toBeTruthy();
    expect(kiemTra(day({ oldPassword: "" })).oldPassword).toBeTruthy();
    expect(kiemTra(day({ password: "", passwordConfirmation: "" })).password).toBeTruthy();
  });

  it("biểu mẫu rỗng ⇒ không gửi được", () => {
    expect(guiDuoc(bieuMauRong())).toBe(false);
    expect(guiDuoc(null)).toBe(false);
  });

  it("độ dài khớp hợp đồng backend", () => {
    const ngan = "x".repeat(DAI_TOI_THIEU - 1);
    expect(kiemTra(day({ password: ngan, passwordConfirmation: ngan })).password).toContain("ít nhất");
    const dai = "x".repeat(DAI_TOI_DA + 1);
    expect(kiemTra(day({ password: dai, passwordConfirmation: dai })).password).toContain("tối đa");
    const vua = "x".repeat(DAI_TOI_THIEU);
    expect(kiemTra(day({ password: vua, passwordConfirmation: vua })).password).toBeUndefined();
  });

  it("mật khẩu mới phải KHÁC mật khẩu cũ", () => {
    expect(kiemTra(day({ password: CU, passwordConfirmation: CU })).password)
      .toContain("khác mật khẩu hiện tại");
  });
});

// ── 4. Xác nhận lệch ────────────────────────────────────────────────────────
describe("xác nhận mật khẩu", () => {
  it("lệch ⇒ báo ở ô xác nhận, không phải ô mật khẩu", () => {
    const loi = kiemTra(day({ passwordConfirmation: "khac-han-9999" }));
    expect(loi.passwordConfirmation).toContain("không khớp");
    expect(loi.password).toBeUndefined();
  });

  it("mật khẩu mới đã sai thì KHÔNG báo thêm lỗi xác nhận — một lỗi mỗi lần", () => {
    const loi = kiemTra(day({ password: "ngan", passwordConfirmation: "khac" }));
    expect(loi.password).toBeTruthy();
    expect(loi.passwordConfirmation).toBeUndefined();
  });

  it("khớp ⇒ không lỗi", () => {
    expect(kiemTra(day()).passwordConfirmation).toBeUndefined();
  });
});

// ── 9. Thất bại giữ lại gì ──────────────────────────────────────────────────
describe("sau khi thất bại", () => {
  it("giữ định danh, XOÁ cả ba ô mật khẩu", () => {
    const sau = sauKhiHong(day());
    expect(sau.identifier).toBe("nguoi-dung-nks");
    expect(sau.oldPassword).toBe("");
    expect(sau.password).toBe("");
    expect(sau.passwordConfirmation).toBe("");
  });

  it("không có định danh thì trả về biểu mẫu rỗng, không ném", () => {
    expect(sauKhiHong(null)).toEqual(bieuMauRong());
  });
});

// ── Định danh không suy từ email ────────────────────────────────────────────
describe("định danh", () => {
  it("email chỉ là GỢI Ý ban đầu, sửa được", () => {
    const f = bieuMauRong("a@example.com");
    expect(f.identifier).toBe("a@example.com");
    // Sửa thành thứ khác vẫn hợp lệ — định danh NKS không chắc là email.
    expect(guiDuoc({ ...day(), identifier: "ten-dang-nhap-rieng" })).toBe(true);
  });

  it("gửi đi đúng bốn khoá, không thêm gì", () => {
    expect(KHOA).toEqual(["identifier", "oldPassword", "password", "passwordConfirmation"]);
    expect(O.map((o) => o.khoa)).toEqual(KHOA);
  });
});

// ── Thông điệp lỗi ──────────────────────────────────────────────────────────
describe("mã lỗi thành câu đọc được", () => {
  it("sai credential KHÔNG tiết lộ nguyên nhân cụ thể", () => {
    const cau = loiDeDoc("invalid_credentials");
    expect(cau).toContain("không đúng");
    // Không được nói "tài khoản này không phải người dùng NKS" — máy chủ cố ý trả
    // cùng một mã cho hai ca đó, câu chữ ở đây không được phân biệt hộ.
    expect(cau).not.toMatch(/không tồn tại|chưa liên kết|không phải/i);
  });

  it("lỗi nhập liệu dùng lại câu của máy chủ khi có", () => {
    expect(loiDeDoc("invalid_password", 400, "Xác nhận mật khẩu không khớp."))
      .toBe("Xác nhận mật khẩu không khớp.");
  });

  it("outage nói rõ mật khẩu CHƯA đổi", () => {
    expect(loiDeDoc("provider_unavailable")).toContain("chưa được đổi");
    expect(loiDeDoc("provider_protocol_error")).toContain("chưa được đổi");
  });

  it("có câu cho quá nhiều lần thử và mất mạng", () => {
    expect(loiDeDoc("rate_limited")).toContain("quá nhiều lần");
    expect(loiDeDoc(undefined, 0)).toContain("Không kết nối");
    expect(loiDeDoc("gi_do_la")).toBeTruthy();
  });
});

// ── 1 + 2. Ai thấy mục Đổi mật khẩu ─────────────────────────────────────────
describe("hiển thị mục Đổi mật khẩu", () => {
  it("chỉ tài khoản NKS mới có mục này", () => {
    expect(doc("components/Layout/AccountMenu.jsx"))
      .toMatch(/hoSo\.nhaCungCap === "NKS" && \(/);
  });

  it("người dùng local không được coi là NKS", () => {
    const local = dungHoSo({ id: "u", email: "a@vidu.com", display_name: "A", role: "learner" });
    expect(local.nhaCungCap).toBeNull();
    const nks = dungHoSo({ id: "u", email: "a@vidu.com", display_name: "A", provider: "nks" });
    expect(nks.nhaCungCap).toBe("NKS");
  });

  it("mục này không còn bị vô hiệu như trước", () => {
    const s = doc("components/Layout/AccountMenu.jsx");
    expect(s).not.toMatch(/Đổi mật khẩu\s*\n?\s*<span[^>]*>Sắp có/);
    expect(s).toMatch(/setMoDoiMatKhau\(true\)/);
  });
});

// ── 5 + 6 + 7 + 8. Hành vi hộp thoại ───────────────────────────────────────
describe("hộp thoại đổi mật khẩu", () => {
  const dlg = () => doc("components/Layout/ChangePasswordDialog.jsx");

  it("chặn gửi trùng", () => {
    expect(dlg()).toMatch(/if \(dangGui\) return;/);
  });

  it("thành công ⇒ báo lên trên để đăng xuất, KHÔNG tự ở lại", () => {
    expect(dlg()).toMatch(/onDoiXong\?\.\(\)/);
    const menu = doc("components/Layout/AccountMenu.jsx");
    expect(menu).toMatch(/onDoiXong=\{\(\) => \{/);
    expect(menu).toMatch(/onLogout\?\.\(/);
  });

  it("nói trước cho người dùng biết sẽ bị đăng xuất", () => {
    expect(dlg()).toMatch(/đăng nhập lại/);
  });

  it("thất bại thì gọi sauKhiHong, không xoá sạch biểu mẫu", () => {
    expect(dlg()).toMatch(/setForm\(sauKhiHong\(form\)\)/);
  });

  it("có nút hiện mật khẩu", () => {
    expect(dlg()).toMatch(/type=\{o\.loai === "password" && hien \? "text" : o\.loai\}/);
  });
});

// ── 10 + 11. Không lưu bí mật ───────────────────────────────────────────────
describe("không rò gì phía trình duyệt", () => {
  it("không file mới nào chạm localStorage/sessionStorage/cookie", () => {
    for (const f of NGUON_MOI) {
      expect(maNguon(f), f).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    }
  });

  it("không file mới nào chạm access_token", () => {
    for (const f of NGUON_MOI) {
      expect(maNguon(f), f).not.toMatch(/access_token/);
    }
  });

  it("mật khẩu chỉ sống trong state của hộp thoại", () => {
    const s = maNguon("components/Layout/ChangePasswordDialog.jsx");
    expect(s).toMatch(/useState/);
    // Không đẩy mật khẩu lên context/cha: chỉ `onDoiXong()` không tham số.
    expect(s).not.toMatch(/onDoiXong\?\.\([^)]+\)/);
  });

  it("module logic thuần không giữ trạng thái toàn cục nào", () => {
    const s = maNguon("auth/matKhauForm.js");
    expect(s).not.toMatch(/^let /m);
    expect(s).not.toMatch(/window\./);
  });
});


// ── D1. Trạng thái mật khẩu KHÔNG được sống qua lần đóng ────────────────────
describe("D1 — đóng hộp thoại phải xoá sạch mật khẩu", () => {
  /**
   * Mô phỏng ĐÚNG luồng người dùng, bằng chính hàm mà component gọi ở effect đóng.
   * Không render được (env node, không DOM), nên chỗ nối component↔hàm được khoá
   * riêng bằng phép quét nguồn ở test cuối nhóm này.
   */
  const moHopThoai = (email) => trangThaiSach(email);
  const goVao = (tt) => ({
    ...tt,
    form: {
      identifier: "nguoi-dung-nks",
      oldPassword: "mat-khau-cu-BI-MAT",
      password: "mat-khau-moi-BI-MAT",
      passwordConfirmation: "mat-khau-moi-BI-MAT",
    },
    hien: true,                       // người dùng bật "Hiện mật khẩu"
    loiChung: "Tên đăng nhập hoặc mật khẩu hiện tại không đúng.",
  });
  const dong = (email) => trangThaiSach(email);   // đúng thứ effect đóng làm

  it("gõ → đóng → mở lại: mọi ô mật khẩu rỗng", () => {
    const daGo = goVao(moHopThoai("a@example.com"));
    expect(daGo.form.oldPassword).toBeTruthy();   // tiền đề: có gõ thật

    const moLai = dong("a@example.com");
    expect(moLai.form.oldPassword).toBe("");
    expect(moLai.form.password).toBe("");
    expect(moLai.form.passwordConfirmation).toBe("");
  });

  it("show-password về false — đây mới là thứ làm mật khẩu cũ HIỆN RÕ", () => {
    expect(goVao(moHopThoai("")).hien).toBe(true);
    expect(dong("").hien).toBe(false);
  });

  it("lỗi cũ cũng biến mất, không doạ người mở lại", () => {
    expect(goVao(moHopThoai("")).loiChung).toBeTruthy();
    expect(dong("").loiChung).toBe("");
    expect(dong("")).toHaveProperty("loi", {});
  });

  it("định danh trở lại GỢI Ý, không giữ thứ gõ dở", () => {
    expect(dong("a@example.com").form.identifier).toBe("a@example.com");
    expect(dong("").form.identifier).toBe("");
  });

  it("không còn dấu vết mật khẩu ở bất kỳ khoá nào", () => {
    const phang = JSON.stringify(dong("a@example.com"));
    expect(phang).not.toContain("BI-MAT");
  });

  it("component THẬT gọi trangThaiSach khi `open` sai", () => {
    const s = doc("components/Layout/ChangePasswordDialog.jsx");
    expect(s).toMatch(/useEffect\(\(\) => \{[\s\S]{0,80}?if \(open\) return;/);
    expect(s).toMatch(/const sach = trangThaiSach\(email\);/);
    for (const setter of ["setForm(sach.form)", "setLoi(sach.loi)",
                          "setLoiChung(sach.loiChung)", "setHien(sach.hien)"]) {
      expect(s, setter).toContain(setter);
    }
    expect(s).toMatch(/\}, \[open, email\]\);/);
  });

  it("NksVerifyDialog cũng xoá mật khẩu khi đóng (lỗi có sẵn, cùng lớp)", () => {
    const s = doc("components/Layout/NksVerifyDialog.jsx");
    expect(s).toMatch(/useEffect\(\(\) => \{[\s\S]{0,80}?if \(open\) return;/);
    expect(s).toMatch(/setMatKhau\(""\);/);
    expect(s).toMatch(/\}, \[open, email\]\);/);
  });

  it("không docstring nào còn nói state tự biến mất khi đóng", () => {
    for (const f of ["components/Layout/ChangePasswordDialog.jsx",
                     "components/Layout/NksVerifyDialog.jsx"]) {
      expect(doc(f), f).not.toMatch(/biến mất khi đóng\. Không/);
      expect(doc(f), f).toMatch(/bị XOÁ khi hộp thoại đóng/);
    }
  });
});

// ── D4. Xác nhận đổi mật khẩu xong + bắt đăng nhập lại ─────────────────────
describe("D4 — thông báo sau khi đổi mật khẩu", () => {
  it("có câu xác nhận, và nó nói rõ phải đăng nhập lại", () => {
    const cau = thongBaoSauDangXuat(MA_THONG_BAO.DOI_MAT_KHAU);
    expect(cau).toBeTruthy();
    expect(cau).toMatch(/đổi mật khẩu/i);
    expect(cau).toMatch(/đăng nhập lại/i);
  });

  it("câu thông báo KHÔNG chứa mật khẩu, token hay định danh", () => {
    const cau = thongBaoSauDangXuat(MA_THONG_BAO.DOI_MAT_KHAU);
    for (const bi_mat of ["mat-khau", "password", "token", "@", "identifier"]) {
      expect(cau.toLowerCase(), bi_mat).not.toContain(bi_mat);
    }
  });

  it("mã lạ ⇒ không hiện gì — URL không dựng được thông báo tuỳ ý", () => {
    for (const rac of ["", null, undefined, "khong-co-that",
                       "<script>alert(1)</script>", "Tài khoản của bạn đã bị khoá"]) {
      expect(thongBaoSauDangXuat(rac)).toBe("");
    }
  });

  it("màn hình đăng nhập đọc mã từ query và tra BẢNG TRẮNG", () => {
    const s = doc("pages/Login.jsx");
    expect(s).toMatch(/thongBaoSauDangXuat\(params\.get\("tb"\)\)/);
    expect(s).toMatch(/role="status"/);
    expect(s).toMatch(/\{thongBao\}/);
  });

  it("đổi mật khẩu xong ⇒ đăng xuất rồi tới /login kèm mã", () => {
    const s = doc("components/Layout/MainLayout.jsx");
    expect(s).toMatch(/await logout\(\);/);              // dọn phiên như cũ
    expect(s).toMatch(/navigate\(`\/login\?tb=\$\{encodeURIComponent\(ma\)\}`/);
  });

  it("đăng xuất THƯỜNG giữ nguyên hành vi cũ: về `/`, không thông báo", () => {
    expect(doc("components/Layout/MainLayout.jsx")).toMatch(/else navigate\("\/"\);/);
  });

  it("AccountMenu truyền đúng mã đã khai, không phải chuỗi tự chế", () => {
    expect(doc("components/Layout/AccountMenu.jsx")).toMatch(/lyDo: "doi-mat-khau"/);
    expect(MA_THONG_BAO.DOI_MAT_KHAU).toBe("doi-mat-khau");
  });
});
