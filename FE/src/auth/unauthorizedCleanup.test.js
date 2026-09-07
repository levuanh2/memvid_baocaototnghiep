import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installUnauthorizedHandler } from "./authEvents";
import { xoaDuLieuPhienNguoiDung } from "./phienNguoiDung";
import { getToken, setToken } from "./tokenStore";
import { nhoNguon, nguonConDangXuLy } from "../utils/nguonDangXuLy";
import { saveActiveMindmapJob, loadActiveMindmapJob } from "../utils/activeMindmapJob";
import { saveActiveSummaryJob, loadActiveSummaryJob } from "../utils/activeSummaryJob";

/**
 * Hết phiên (token hỏng/hết hạn) phải dọn SẠCH như đăng xuất chủ động.
 *
 * Có HAI đường tới "phiên đã chết", và chúng KHÔNG dùng chung mã:
 *
 *   1. 401 từ một app API  → `apiFetch` phát `auth:unauthorized`
 *                          → `installUnauthorizedHandler` xoá token + gọi onSignout.
 *   2. 401 từ `/auth/me`   → khớp `AUTH_PATH_RE` nên **KHÔNG** phát sự kiện (cố ý:
 *                            lượt thăm dò phiên không được kéo theo đăng xuất toàn
 *                            cục). `getCurrentUser` chỉ xoá token.
 *
 * Đường (2) là đường token hết hạn bình thường, và trước bản sửa này nó để lại tên
 * tài liệu của người dùng cũ trong localStorage: A hết hạn → B đăng nhập trên cùng
 * trình duyệt → `SidebarLeft` đọc khoá đó lúc mount và vẽ tên file của A.
 */

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

/**
 * `window` tối thiểu: chỉ đủ addEventListener/removeEventListener/dispatchEvent.
 *
 * Kho này chạy test ở env node, không có DOM (xem `phienNguoiDung.test.js`). Thay vì
 * kéo jsdom vào chỉ để bắn một sự kiện, dựng đúng ba hàm mà `installUnauthorizedHandler`
 * dùng — nó vốn đã guard `typeof window === "undefined"`, nên phải có window thật thì
 * mới đo được nhánh có đăng ký listener.
 */
function memWindow() {
  const reg = new Map();
  return {
    addEventListener: (t, h) => { if (!reg.has(t)) reg.set(t, new Set()); reg.get(t).add(h); },
    removeEventListener: (t, h) => { reg.get(t)?.delete(h); },
    dispatchEvent: (ev) => { for (const h of reg.get(ev.type) || []) h(ev); return true; },
  };
}
const banSuKien = (type, detail) => globalThis.window.dispatchEvent({ type, detail });

const realLS = globalThis.localStorage;
const realWin = globalThis.window;
beforeEach(() => {
  globalThis.localStorage = memLocalStorage();
  globalThis.window = memWindow();
});
afterEach(() => { globalThis.localStorage = realLS; globalThis.window = realWin; });

/** Dựng đúng trạng thái một phiên đang chạy của người dùng A. */
function dungPhienCuaA() {
  setToken("token-cua-A");
  nhoNguon({ sourceId: "src-A", filename: "bao-cao-cua-A.pdf" });
  saveActiveMindmapJob({ jobId: "job-A", sources: ["tl-A"], startedAt: Date.now() });
  saveActiveSummaryJob({ jobId: "job-A2", sources: ["tl-A"], startedAt: Date.now() });
  globalThis.localStorage.setItem("memvid-theme", "dark");
  globalThis.localStorage.setItem("memvidx.panels.v1", '{"width":{"left":300}}');
}

function phienDaSach() {
  return {
    token: getToken(),
    nguon: nguonConDangXuLy(),
    mindmap: loadActiveMindmapJob(),
    summary: loadActiveSummaryJob(),
  };
}

describe("đường 1 — 401 từ app API (auth:unauthorized)", () => {
  it("xoá token, state người dùng, và gọi onSignout", () => {
    dungPhienCuaA();
    const goi = [];
    const go = installUnauthorizedHandler(() => {
      xoaDuLieuPhienNguoiDung();      // đúng thứ AuthContext truyền vào
      goi.push("signout");
    });

    banSuKien("auth:unauthorized", { path: "/api/documents" });

    const s = phienDaSach();
    expect(s.token).toBeNull();       // authEvents tự xoá token
    expect(s.nguon).toEqual([]);
    expect(s.mindmap).toBeNull();
    expect(s.summary).toBeNull();
    expect(goi).toEqual(["signout"]);
    go();
  });

  it("giữ lại lựa chọn của thiết bị", () => {
    dungPhienCuaA();
    const go = installUnauthorizedHandler(() => xoaDuLieuPhienNguoiDung());
    banSuKien("auth:unauthorized");
    expect(globalThis.localStorage.getItem("memvid-theme")).toBe("dark");
    expect(globalThis.localStorage.getItem("memvidx.panels.v1")).toContain("300");
    go();
  });

  it("401 lặp lại nhiều lần không ném và không lặp vô hạn", () => {
    dungPhienCuaA();
    let n = 0;
    const go = installUnauthorizedHandler(() => { n += 1; xoaDuLieuPhienNguoiDung(); });
    for (let i = 0; i < 3; i++) banSuKien("auth:unauthorized");
    expect(n).toBe(3);
    expect(phienDaSach().nguon).toEqual([]);
    go();
  });

  it("gỡ handler rồi thì sự kiện không còn tác dụng", () => {
    const go = installUnauthorizedHandler(() => xoaDuLieuPhienNguoiDung());
    go();
    dungPhienCuaA();
    banSuKien("auth:unauthorized");
    expect(getToken()).toBe("token-cua-A");   // không bị đụng sau khi gỡ
  });
});

describe("đường 2 — token hết hạn qua /auth/me (KHÔNG phát sự kiện)", () => {
  it("dọn state người dùng dù không có auth:unauthorized nào được phát", () => {
    // Mô phỏng đúng nhánh mà AuthContext chạy khi `getCurrentUser()` trả null.
    dungPhienCuaA();
    const daPhat = vi.fn();
    globalThis.window.addEventListener("auth:unauthorized", daPhat);

    // getCurrentUser đã xoá token của nó; AuthContext dọn phần còn lại.
    globalThis.localStorage.removeItem("memvid-token");
    xoaDuLieuPhienNguoiDung();

    expect(daPhat).not.toHaveBeenCalled();    // đúng: /auth/me không phát sự kiện
    const s = phienDaSach();
    expect(s.token).toBeNull();
    expect(s.nguon).toEqual([]);
    expect(s.mindmap).toBeNull();
    expect(s.summary).toBeNull();
    globalThis.window.removeEventListener("auth:unauthorized", daPhat);
  });

  it("A hết hạn → B đăng nhập: B không thấy gì của A", () => {
    dungPhienCuaA();
    // A hết hạn (đường /auth/me)
    globalThis.localStorage.removeItem("memvid-token");
    xoaDuLieuPhienNguoiDung();

    // B đăng nhập trên cùng trình duyệt
    setToken("token-cua-B");
    expect(nguonConDangXuLy()).toEqual([]);
    nhoNguon({ sourceId: "src-B", filename: "cua-B.pdf" });

    const ds = nguonConDangXuLy();
    expect(ds).toHaveLength(1);
    expect(ds[0].sourceId).toBe("src-B");
    expect(JSON.stringify(ds)).not.toContain("bao-cao-cua-A.pdf");
    expect(loadActiveMindmapJob()).toBeNull();
  });

  it("không có token ngay từ đầu cũng dọn — phiên chết từ lần tải trước", () => {
    nhoNguon({ sourceId: "src-A", filename: "bao-cao-cua-A.pdf" });
    expect(getToken()).toBeNull();
    xoaDuLieuPhienNguoiDung();
    expect(nguonConDangXuLy()).toEqual([]);
  });
});

describe("không ảnh hưởng đường đăng nhập", () => {
  it("đăng nhập thành công sau khi dọn vẫn giữ được token mới", () => {
    dungPhienCuaA();
    xoaDuLieuPhienNguoiDung();
    globalThis.localStorage.removeItem("memvid-token");

    setToken("token-moi");
    expect(getToken()).toBe("token-moi");
    // Dọn phiên KHÔNG đụng token — token do tokenStore quản lý riêng, nên một lần
    // dọn nhầm lúc đang đăng nhập cũng không đá người dùng ra ngoài.
    xoaDuLieuPhienNguoiDung();
    expect(getToken()).toBe("token-moi");
  });
});
