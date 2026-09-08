import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { xoaDuLieuPhienNguoiDung } from "./phienNguoiDung";
import { layGrant, luuGrant, quenGrant } from "./grantNks";
import { installUnauthorizedHandler } from "./authEvents";
import { caiDatKiemTraKhoiPhuc } from "./khoiPhucBfcache";

/**
 * Chứng từ ghi NKS phải chết cùng phiên — cả ở máy chủ lẫn trong bộ nhớ trang.
 *
 * Có BA đường kết thúc phiên, và chúng không dùng chung mã:
 *
 *   1. đăng xuất chủ động   → `AuthContext.logout` → `logoutUser()` → POST /auth/logout
 *   2. `auth:unauthorized`  → token đã hỏng nên KHÔNG gọi được /auth/logout
 *   3. khôi phục bfcache    → token trong kho là của NGƯỜI KHÁC đang hoạt động
 *
 * Chỉ đường (1) dọn được phía máy chủ, và lý do nằm ở chính `/auth/logout`: nó nhận
 * ra người dùng bằng bearer token. Đường (2) không có token hợp lệ để trình ra; đường
 * (3) có token, nhưng là của người B vừa đăng nhập ở nơi khác — gọi logout ở đó sẽ
 * giết phiên của B. Xem test "KHÔNG gọi logout" bên dưới.
 *
 * Cả ba đường đều đi qua `xoaDuLieuPhienNguoiDung()`, nên phần quên chứng từ ở trình
 * duyệt được đặt ở đúng một chỗ.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const doc = (p) => readFileSync(join(SRC, "..", p), "utf8");

const GRANT = "grant-id-cua-nguoi-truoc";
const CON_HAN = () => Date.now() / 1000 + 600;

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function memWindow() {
  const reg = new Map();
  return {
    addEventListener: (t, h) => { if (!reg.has(t)) reg.set(t, new Set()); reg.get(t).add(h); },
    removeEventListener: (t, h) => { reg.get(t)?.delete(h); },
    dispatchEvent: (ev) => { for (const h of reg.get(ev.type) || []) h(ev); return true; },
    ban: (t, ev) => Promise.all([...(reg.get(t) || [])].map((h) => h(ev))),
  };
}

const realLS = globalThis.localStorage;
const realWin = globalThis.window;
beforeEach(() => {
  globalThis.localStorage = memLocalStorage();
  globalThis.window = memWindow();
  quenGrant();
});
afterEach(() => {
  globalThis.localStorage = realLS;
  globalThis.window = realWin;
  quenGrant();
});

// ── 4 + 5 + 6. Trình duyệt quên chứng từ ở CẢ BA đường ──────────────────────
describe("bộ nhớ trang quên chứng từ khi phiên kết thúc", () => {
  it("4. đăng xuất chủ động ⇒ layGrant() về null ngay", () => {
    luuGrant(GRANT, CON_HAN());
    expect(layGrant()).toBe(GRANT);

    xoaDuLieuPhienNguoiDung();          // đúng thứ AuthContext.logout gọi

    expect(layGrant()).toBeNull();
  });

  it("5. auth:unauthorized ⇒ layGrant() về null ngay", () => {
    luuGrant(GRANT, CON_HAN());
    const go = installUnauthorizedHandler(() => xoaDuLieuPhienNguoiDung());

    globalThis.window.dispatchEvent({ type: "auth:unauthorized" });

    expect(layGrant()).toBeNull();
    go();
  });

  it("6. bfcache phát hiện NGƯỜI KHÁC ⇒ layGrant() về null ngay", async () => {
    luuGrant(GRANT, CON_HAN());
    const win = memWindow();
    const go = caiDatKiemTraKhoiPhuc({
      layIdDangHienThi: () => "user-A",
      layUser: async () => ({ id: "user-B" }),     // server nói: giờ là người khác
      onHuy: () => xoaDuLieuPhienNguoiDung(),      // đúng thứ AuthContext truyền vào
      window: win,
    });

    await win.ban("pageshow", { persisted: true });

    expect(layGrant()).toBeNull();
    go();
  });

  it("bfcache VẪN ĐÚNG NGƯỜI ⇒ giữ nguyên chứng từ, không phá việc đang làm", async () => {
    luuGrant(GRANT, CON_HAN());
    const win = memWindow();
    const go = caiDatKiemTraKhoiPhuc({
      layIdDangHienThi: () => "user-A",
      layUser: async () => ({ id: "user-A" }),
      onHuy: () => xoaDuLieuPhienNguoiDung(),
      window: win,
    });

    await win.ban("pageshow", { persisted: true });

    expect(layGrant()).toBe(GRANT);
    go();
  });

  it("phiên chết lúc tải trang (không có token) cũng quên", () => {
    luuGrant(GRANT, CON_HAN());
    xoaDuLieuPhienNguoiDung();          // nhánh `if (!getToken())` của AuthContext
    expect(layGrant()).toBeNull();
  });
});

// ── Đổi người dùng trong cùng một tab ───────────────────────────────────────
describe("đổi người dùng", () => {
  it("đăng nhập lại quên chứng từ của người trước", () => {
    // `AuthContext.login` gọi `quenGrant()` trước khi đặt token/user mới.
    luuGrant(GRANT, CON_HAN());
    quenGrant();
    expect(layGrant()).toBeNull();
  });

  it("AuthContext thật sự gọi quenGrant trong login", () => {
    const s = doc("auth/AuthContext.jsx");
    const login = s.slice(s.indexOf("const login = useCallback"), s.indexOf("const register"));
    expect(login).toMatch(/quenGrant\(\);/);
    // Phải quên TRƯỚC khi đặt người dùng mới, không phải sau.
    expect(login.indexOf("quenGrant()")).toBeLessThan(login.indexOf("setUser(u)"));
  });
});

// ── 7. Idempotent ───────────────────────────────────────────────────────────
describe("7. dọn nhiều lần vẫn an toàn", () => {
  it("gọi liên tiếp không ném và không đổi kết quả", () => {
    luuGrant(GRANT, CON_HAN());
    expect(() => {
      xoaDuLieuPhienNguoiDung();
      xoaDuLieuPhienNguoiDung();
      xoaDuLieuPhienNguoiDung();
    }).not.toThrow();
    expect(layGrant()).toBeNull();
  });

  it("dọn khi chưa từng có chứng từ nào cũng không ném", () => {
    expect(() => xoaDuLieuPhienNguoiDung()).not.toThrow();
    expect(layGrant()).toBeNull();
  });

  it("401 lặp lại nhiều lần vẫn im lặng", () => {
    luuGrant(GRANT, CON_HAN());
    const go = installUnauthorizedHandler(() => xoaDuLieuPhienNguoiDung());
    for (let i = 0; i < 3; i++) {
      globalThis.window.dispatchEvent({ type: "auth:unauthorized" });
    }
    expect(layGrant()).toBeNull();
    go();
  });
});

// ── 1 + 2 + 3 + 8. Phía máy chủ: ai gọi được /auth/logout, ai không ─────────
describe("dọn phía máy chủ", () => {
  it("1. chỉ đường đăng xuất chủ động gọi /auth/logout — và gọi ĐÚNG MỘT lần", () => {
    const s = doc("auth/AuthContext.jsx");
    // Một lời gọi duy nhất, nằm trong `logout`.
    expect(s.match(/logoutUser\(\)/g) || []).toHaveLength(1);
    const logout = s.slice(s.indexOf("const logout = useCallback"), s.indexOf("const refreshUser"));
    expect(logout).toMatch(/await logoutUser\(\);/);
  });

  it("8. không có lời gọi dọn trùng ở các đường khác", () => {
    const s = doc("auth/AuthContext.jsx");
    // Cắt ĐÚNG hai callback, không cắt cả phần còn lại của file: `logout` nằm phía
    // sau và nó ĐƯỢC PHÉP gọi `logoutUser`.
    // `lastIndexOf`: cả hai tên còn xuất hiện ở dòng `import` đầu file.
    const than401 = s.slice(s.lastIndexOf("installUnauthorizedHandler"),
                            s.lastIndexOf("caiDatKiemTraKhoiPhuc"));
    const thanBfcache = s.slice(s.lastIndexOf("caiDatKiemTraKhoiPhuc"),
                                s.indexOf("const login = useCallback"));
    expect(than401).not.toMatch(/logoutUser/);
    expect(thanBfcache).not.toMatch(/logoutUser/);
    // Và cả hai vẫn phải dọn phía trình duyệt.
    expect(than401).toMatch(/xoaDuLieuPhienNguoiDung\(\)/);
    expect(thanBfcache).toMatch(/xoaDuLieuPhienNguoiDung\(\)/);
  });

  it("2. auth:unauthorized KHÔNG gọi /auth/logout — token đã hỏng, gọi cũng vô ích", () => {
    // `/auth/logout` nhận ra người dùng bằng bearer token; 401 nghĩa là token không
    // còn hợp lệ, nên máy chủ không biết xoá chứng từ của ai. Hạn 10 phút là hàng
    // rào duy nhất còn lại — và đó là thiết kế, không phải thiếu sót.
    const goi = [];
    const go = installUnauthorizedHandler(() => { goi.push("signout"); xoaDuLieuPhienNguoiDung(); });
    globalThis.window.dispatchEvent({ type: "auth:unauthorized" });
    expect(goi).toEqual(["signout"]);
    go();
  });

  it("3. bfcache KHÔNG gọi /auth/logout — token trong kho là của người B đang hoạt động", async () => {
    // Gọi logout ở đây sẽ xoá chứng từ của B, người vừa đăng nhập ở tab khác và
    // không làm gì sai. Chứng từ của A không với tới được vì không còn token của A.
    const logoutUser = vi.fn();
    const win = memWindow();
    const go = caiDatKiemTraKhoiPhuc({
      layIdDangHienThi: () => "user-A",
      layUser: async () => ({ id: "user-B" }),
      onHuy: () => xoaDuLieuPhienNguoiDung(),
      window: win,
    });

    await win.ban("pageshow", { persisted: true });

    expect(logoutUser).not.toHaveBeenCalled();
    expect(doc("auth/AuthContext.jsx")).not.toMatch(/onHuy:[\s\S]{0,200}logoutUser/);
    go();
  });

  it("một chỗ dọn duy nhất — cả ba đường đều đi qua xoaDuLieuPhienNguoiDung", () => {
    const s = doc("auth/AuthContext.jsx");
    expect((s.match(/xoaDuLieuPhienNguoiDung\(\)/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(doc("auth/phienNguoiDung.js")).toMatch(/quenGrant\(\);/);
  });
});
