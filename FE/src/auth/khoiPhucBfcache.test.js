import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { caiDatKiemTraKhoiPhuc, quyetDinh, GIU, HUY } from "./khoiPhucBfcache";
import { xoaDuLieuPhienNguoiDung } from "./phienNguoiDung";
import { nhoNguon, nguonConDangXuLy } from "../utils/nguonDangXuLy";
import { saveActiveMindmapJob, loadActiveMindmapJob } from "../utils/activeMindmapJob";

/**
 * Khôi phục từ bfcache — ca đã TÁI HIỆN ĐƯỢC trên trình duyệt thật:
 *
 *   A đăng nhập → có tài liệu riêng trên màn hình → rời sang trang khác
 *   → B đăng nhập ở phiên khác → bấm Back
 *   → trình duyệt trả lại nguyên trang cũ, React KHÔNG mount lại,
 *     giao diện của A hiện lại.
 *
 * Không effect nào của `AuthContext` chạy ở lượt khôi phục đó, nên hàng rào phải
 * treo vào `pageshow` — sự kiện duy nhất được bắn — và chỉ hành động khi
 * `event.persisted === true`.
 */

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

/** `window` tối thiểu — kho này test ở env node, không có DOM. */
function memWindow() {
  const reg = new Map();
  return {
    addEventListener: (t, h) => { if (!reg.has(t)) reg.set(t, new Set()); reg.get(t).add(h); },
    removeEventListener: (t, h) => { reg.get(t)?.delete(h); },
    soListener: (t) => (reg.get(t)?.size ?? 0),
    ban: (t, ev) => Promise.all([...(reg.get(t) || [])].map((h) => h(ev))),
  };
}

const realLS = globalThis.localStorage;
beforeEach(() => { globalThis.localStorage = memLocalStorage(); });
afterEach(() => { globalThis.localStorage = realLS; });

const USER_A = { id: "user-A", email: "a@vidu.com" };
const USER_B = { id: "user-B", email: "b@vidu.com" };

function dungBoKiem({ idHienThi, userTraVe, layUserImpl }) {
  const win = memWindow();
  const su = { huy: 0, giu: 0 };
  const layUser = layUserImpl || vi.fn(async () => userTraVe);
  const go = caiDatKiemTraKhoiPhuc({
    layIdDangHienThi: () => idHienThi,
    layUser,
    onHuy: () => { su.huy += 1; xoaDuLieuPhienNguoiDung(); },
    onGiu: () => { su.giu += 1; },
    window: win,
  });
  return { win, su, layUser, go };
}

// ── quyết định thuần ─────────────────────────────────────────────────────────
describe("quyetDinh", () => {
  it("cùng người ⇒ giữ", () => {
    expect(quyetDinh("user-A", USER_A)).toBe(GIU);
  });
  it("khác người ⇒ huỷ (đúng ca bfcache)", () => {
    expect(quyetDinh("user-A", USER_B)).toBe(HUY);
  });
  it("phiên đã chết ⇒ huỷ", () => {
    expect(quyetDinh("user-A", null)).toBe(HUY);
    expect(quyetDinh("user-A", {})).toBe(HUY);
  });
  it("lúc rời đi chưa đăng nhập ⇒ không có gì cũ để rò, giữ", () => {
    expect(quyetDinh(undefined, USER_B)).toBe(GIU);
    expect(quyetDinh(null, null)).toBe(GIU);
  });
});

// ── 1. persisted=false ───────────────────────────────────────────────────────
describe("chỉ phản ứng với lượt khôi phục thật", () => {
  it("persisted=false ⇒ KHÔNG hỏi lại server, không huỷ gì", async () => {
    const { win, su, layUser, go } = dungBoKiem({ idHienThi: "user-A", userTraVe: USER_B });
    await win.ban("pageshow", { persisted: false });
    expect(layUser).not.toHaveBeenCalled();
    expect(su).toEqual({ huy: 0, giu: 0 });
    go();
  });

  it("sự kiện rỗng/không có persisted cũng bỏ qua", async () => {
    const { win, layUser, go } = dungBoKiem({ idHienThi: "user-A", userTraVe: USER_B });
    await win.ban("pageshow", undefined);
    await win.ban("pageshow", {});
    expect(layUser).not.toHaveBeenCalled();
    go();
  });
});

// ── 2. persisted=true + cùng người ───────────────────────────────────────────
describe("khôi phục, vẫn đúng người", () => {
  it("giữ nguyên giao diện, KHÔNG huỷ phiên", async () => {
    nhoNguon({ sourceId: "s-A", filename: "cua-A.pdf" });
    const { win, su, go } = dungBoKiem({ idHienThi: "user-A", userTraVe: USER_A });
    await win.ban("pageshow", { persisted: true });
    expect(su.huy).toBe(0);
    expect(su.giu).toBe(1);
    // Dữ liệu của chính họ không bị đụng tới.
    expect(nguonConDangXuLy()).toHaveLength(1);
    go();
  });
});

// ── 3. persisted=true + phiên chết ───────────────────────────────────────────
describe("khôi phục, phiên đã chết", () => {
  it("dọn state người dùng", async () => {
    nhoNguon({ sourceId: "s-A", filename: "cua-A.pdf" });
    saveActiveMindmapJob({ jobId: "j-A", sources: ["tl-A"], startedAt: Date.now() });
    const { win, su, go } = dungBoKiem({ idHienThi: "user-A", userTraVe: null });
    await win.ban("pageshow", { persisted: true });
    expect(su.huy).toBe(1);
    expect(nguonConDangXuLy()).toEqual([]);
    expect(loadActiveMindmapJob()).toBeNull();
    go();
  });

  it("lay lỗi mạng cũng coi là phiên chết, không ném ra ngoài", async () => {
    nhoNguon({ sourceId: "s-A", filename: "cua-A.pdf" });
    const { win, su, go } = dungBoKiem({
      idHienThi: "user-A",
      layUserImpl: vi.fn(async () => { throw new Error("mất mạng"); }),
    });
    await expect(win.ban("pageshow", { persisted: true })).resolves.toBeDefined();
    expect(su.huy).toBe(1);
    expect(nguonConDangXuLy()).toEqual([]);
    go();
  });
});

// ── 4. persisted=true + NGƯỜI KHÁC (ca chính) ────────────────────────────────
describe("khôi phục, server trả về người KHÁC", () => {
  it("dọn sạch state của người cũ", async () => {
    nhoNguon({ sourceId: "s-A", filename: "tai-lieu-mat-cua-A.pdf" });
    saveActiveMindmapJob({ jobId: "j-A", sources: ["tl-A"], startedAt: Date.now() });

    const { win, su, go } = dungBoKiem({ idHienThi: "user-A", userTraVe: USER_B });
    await win.ban("pageshow", { persisted: true });

    expect(su.huy).toBe(1);
    expect(su.giu).toBe(0);
    expect(nguonConDangXuLy()).toEqual([]);
    expect(loadActiveMindmapJob()).toBeNull();
    // Tên tài liệu của A không được còn ở bất kỳ đâu.
    expect(JSON.stringify(nguonConDangXuLy())).not.toContain("tai-lieu-mat-cua-A.pdf");
    go();
  });
});

// ── 5. thiết bị ──────────────────────────────────────────────────────────────
describe("lựa chọn của thiết bị", () => {
  it("sống sót qua lượt huỷ phiên", async () => {
    globalThis.localStorage.setItem("memvid-theme", "dark");
    globalThis.localStorage.setItem("memvidx.panels.v1", '{"width":{"left":300}}');
    nhoNguon({ sourceId: "s-A", filename: "cua-A.pdf" });

    const { win, go } = dungBoKiem({ idHienThi: "user-A", userTraVe: USER_B });
    await win.ban("pageshow", { persisted: true });

    expect(globalThis.localStorage.getItem("memvid-theme")).toBe("dark");
    expect(globalThis.localStorage.getItem("memvidx.panels.v1")).toContain("300");
    go();
  });
});

// ── 6. không nhân đôi listener / không chạy loạn ─────────────────────────────
describe("đăng ký và dọn listener", () => {
  it("cài một lần ⇒ đúng MỘT listener; gỡ ⇒ về 0", () => {
    const win = memWindow();
    const go = caiDatKiemTraKhoiPhuc({
      layIdDangHienThi: () => "user-A", layUser: async () => USER_A, window: win,
    });
    expect(win.soListener("pageshow")).toBe(1);
    go();
    expect(win.soListener("pageshow")).toBe(0);
  });

  it("gỡ rồi thì sự kiện không còn tác dụng", async () => {
    const { win, su, layUser, go } = dungBoKiem({ idHienThi: "user-A", userTraVe: USER_B });
    go();
    await win.ban("pageshow", { persisted: true });
    expect(layUser).not.toHaveBeenCalled();
    expect(su.huy).toBe(0);
  });

  it("nhiều pageshow liên tiếp không sinh lượt kiểm chồng nhau", async () => {
    let dangChay = 0;
    let toiDa = 0;
    const layUser = vi.fn(async () => {
      dangChay += 1; toiDa = Math.max(toiDa, dangChay);
      await new Promise((r) => setTimeout(r, 5));
      dangChay -= 1;
      return USER_A;
    });
    const { win, go } = dungBoKiem({ idHienThi: "user-A", layUserImpl: layUser });
    await Promise.all([
      win.ban("pageshow", { persisted: true }),
      win.ban("pageshow", { persisted: true }),
      win.ban("pageshow", { persisted: true }),
    ]);
    expect(toiDa).toBe(1);            // không bao giờ hai lượt kiểm cùng lúc
    go();
  });

  it("không có window (SSR/node) ⇒ trả hàm gỡ vô hại", () => {
    const go = caiDatKiemTraKhoiPhuc({
      layIdDangHienThi: () => null, layUser: async () => null, window: undefined,
    });
    expect(() => go()).not.toThrow();
  });
});
