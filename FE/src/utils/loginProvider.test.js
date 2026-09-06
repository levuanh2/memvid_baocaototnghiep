import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loginUser } from "./api";

/**
 * Thân yêu cầu mà FE thật sự gửi tới `/auth/login`.
 *
 * Khoá hai điều ngược nhau:
 *   1. Không chọn provider ⇒ thân KHÔNG có khoá `provider`. Backend hiểu vắng mặt là
 *      "local", nên trang Login hiện tại không phải sửa gì — đây là toàn bộ luận
 *      điểm tương thích ngược, và nó phải được đo chứ không phải được tin.
 *   2. Chọn "nks" ⇒ khoá đó được gửi đúng nguyên văn.
 *
 * FE không chứa logic xác thực nào: nó chuyển tiếp một lựa chọn, backend quyết định.
 */

const realFetch = globalThis.fetch;
const realLS = globalThis.localStorage;

beforeEach(() => {
  globalThis.localStorage = {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
  };
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ token: "studymap-token", user: { id: "u1" } }),
  }));
});
afterEach(() => { globalThis.fetch = realFetch; globalThis.localStorage = realLS; });

const thanGui = () => JSON.parse(globalThis.fetch.mock.calls[0][1].body);

describe("loginUser — chọn provider", () => {
  it("không truyền provider → thân chỉ có email/password (hành vi cũ)", async () => {
    await loginUser({ email: "a@b.c", password: "mk" });
    const body = thanGui();
    expect(body).toEqual({ email: "a@b.c", password: "mk" });
    expect("provider" in body).toBe(false);
  });

  it('provider "nks" được gửi lên nguyên văn', async () => {
    await loginUser({ email: "nguoi-dung", password: "mk", provider: "nks" });
    expect(thanGui()).toEqual({
      email: "nguoi-dung", password: "mk", provider: "nks",
    });
  });

  it("provider rỗng KHÔNG được gửi — backend không phải đoán chuỗi rỗng nghĩa là gì", async () => {
    await loginUser({ email: "a@b.c", password: "mk", provider: "" });
    expect("provider" in thanGui()).toBe(false);
  });

  it("gọi đúng POST /auth/login với Content-Type JSON", async () => {
    await loginUser({ email: "a@b.c", password: "mk", provider: "nks" });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(String(url)).toContain("/auth/login");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  it("FE chỉ nhận token StudyMap + user công khai, không có gì của NKS", async () => {
    const ra = await loginUser({ email: "u", password: "mk", provider: "nks" });
    expect(Object.keys(ra).sort()).toEqual(["token", "user"]);
    expect(ra.token).toBe("studymap-token");
    // Không có khoá nào mang dấu vết NKS đi kèm phản hồi.
    expect(JSON.stringify(ra)).not.toMatch(/access_token/i);
  });
});
