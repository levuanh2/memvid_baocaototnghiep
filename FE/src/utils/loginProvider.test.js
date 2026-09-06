import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loginUser } from "./api";
import {
  PROVIDER_MAC_DINH,
  kiemTra,
  laProviderNgoai,
  truongDinhDanh,
} from "../auth/loginForm";

/**
 * Hợp đồng đăng nhập nhiều provider, đo ở hai chỗ:
 *   1. thân yêu cầu FE thật sự gửi lên `/auth/login`;
 *   2. quyết định "hỏi trường gì, hợp lệ theo luật nào" của form.
 *
 * Component không render được ở đây (kho chưa có jsdom), nên logic được tách sang
 * `auth/loginForm.js` và khoá tại đó — cùng pattern với `jobRecovery.js`.
 */

const realFetch = globalThis.fetch;
const realLS = globalThis.localStorage;

beforeEach(() => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ token: "studymap-token", user: { id: "u1", role: "learner" } }),
  }));
});
afterEach(() => { globalThis.fetch = realFetch; globalThis.localStorage = realLS; });

const thanGui = () => JSON.parse(globalThis.fetch.mock.calls[0][1].body);

describe("thân yêu cầu /auth/login", () => {
  it("local: gửi ĐÚNG {email, password}, không có khoá provider", async () => {
    await loginUser({ email: "a@b.c", password: "matkhau123" });
    const body = thanGui();
    expect(body).toEqual({ email: "a@b.c", password: "matkhau123" });
    expect("provider" in body).toBe(false);
    expect("username" in body).toBe(false);
  });

  it('nks: gửi ĐÚNG {provider:"nks", username, password} — không có khoá email', async () => {
    await loginUser({ username: "nguoi-dung", password: "mk", provider: "nks" });
    const body = thanGui();
    expect(body).toEqual({ provider: "nks", username: "nguoi-dung", password: "mk" });
    expect("email" in body).toBe(false);
  });

  it('provider "local" tường minh vẫn đi đường local', async () => {
    await loginUser({ email: "a@b.c", password: "mk", provider: "local" });
    const body = thanGui();
    expect(body).toEqual({ email: "a@b.c", password: "mk" });
    expect("provider" in body).toBe(false);
  });

  it("gọi POST /auth/login với Content-Type JSON", async () => {
    await loginUser({ username: "u", password: "mk", provider: "nks" });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(String(url)).toContain("/auth/login");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  it("FE chỉ nhận token StudyMap + user công khai; không có gì của NKS", async () => {
    const ra = await loginUser({ username: "u", password: "mk", provider: "nks" });
    expect(Object.keys(ra).sort()).toEqual(["token", "user"]);
    expect(JSON.stringify(ra)).not.toMatch(/access_token/i);
  });

  it("lỗi backend nổi lên nguyên vẹn để AuthContext dịch sang câu tiếng Việt", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({ error: "invalid_credentials" }),
    }));
    await expect(loginUser({ username: "u", password: "sai", provider: "nks" }))
      .rejects.toMatchObject({ status: 401, code: "invalid_credentials" });
  });
});

describe("loginForm — provider nào hỏi trường gì", () => {
  it("mặc định là local", () => {
    expect(PROVIDER_MAC_DINH).toBe("local");
    expect(laProviderNgoai(PROVIDER_MAC_DINH)).toBe(false);
  });

  it("local hỏi email, nks hỏi username", () => {
    expect(truongDinhDanh("local")).toBe("email");
    expect(truongDinhDanh(undefined)).toBe("email");
    expect(truongDinhDanh("nks")).toBe("username");
  });
});

describe("loginForm — luật hợp lệ theo provider", () => {
  it("local: vẫn bắt đúng email và mật khẩu ≥ 8 ký tự như trước", () => {
    expect(kiemTra("local", { dinhDanh: "khong-phai-email", password: "matkhau123" }))
      .toMatch(/Email/);
    expect(kiemTra("local", { dinhDanh: "a@b.c", password: "ngan" }))
      .toMatch(/8 ký tự/);
    expect(kiemTra("local", { dinhDanh: "a@b.c", password: "matkhau123" })).toBeNull();
  });

  it("nks: username KHÔNG cần là email", () => {
    expect(kiemTra("nks", { dinhDanh: "nguoi-dung", password: "mk" })).toBeNull();
  });

  it("nks: KHÔNG áp luật độ dài mật khẩu của StudyMap", () => {
    // Mật khẩu 3 ký tự là hợp lệ hay không do NKS quyết định, không phải mình.
    // Chặn ở FE là tự khoá cửa với tài khoản hợp lệ mà mình không đặt luật.
    expect(kiemTra("nks", { dinhDanh: "u", password: "abc" })).toBeNull();
  });

  it("nks: vẫn chặn ô rỗng để không gửi yêu cầu chắc chắn hỏng", () => {
    expect(kiemTra("nks", { dinhDanh: "   ", password: "mk" })).toMatch(/tên đăng nhập/i);
    expect(kiemTra("nks", { dinhDanh: "u", password: "" })).toMatch(/mật khẩu/i);
    expect(kiemTra("nks", {})).toBeTruthy();
  });
});
