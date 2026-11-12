// @vitest-environment jsdom
// V6 account page: usage, appearance and security sections under the personal details.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfileSections from "./ProfileSections";
import { usageByActivity } from "../../hooks/useAiUsage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let usageResponse;
vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn((path) => (path === "/usage/me" ? usageResponse() : Promise.resolve({ ok: true, json: async () => ({}) }))),
}));
vi.mock("./ChangePasswordDialog", () => ({
  default: ({ open, onDoiXong }) => (open ? <div role="dialog" aria-label="Đổi mật khẩu"><button type="button" onClick={onDoiXong}>xong</button></div> : null),
}));

const USAGE = {
  plan: "free", used: 1500, reserved: 0, limit: 10000, remaining: 8500, percentage: 15,
  reset_at: "2026-12-01T00:00:00Z", breakdown: { chat: 400, answer: 600, summary: 300, quiz: 200 },
};
const ok = (body) => () => Promise.resolve({ ok: true, json: async () => body });

let host, root;
beforeEach(() => {
  localStorage.setItem("memvid-theme", "light");
  usageResponse = ok(USAGE);
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove(); host = null; root = null;
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

async function render(props = {}) {
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<ProfileSections laNks={false} email="ban@vidu.com" onLogout={() => {}} {...props} />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}
const button = (text) => [...host.querySelectorAll("button")].find((b) => b.textContent.includes(text));

describe("usageByActivity", () => {
  it("names activities for learners, adds keys that share a name, and sorts largest first", () => {
    expect(usageByActivity(USAGE.breakdown)).toEqual([["Hỏi đáp", 1000], ["Tóm tắt", 300], ["Tạo quiz", 200]]);
  });
  it("keeps an unknown key visible instead of dropping its tokens", () => {
    expect(usageByActivity({ new_thing: 5 })).toEqual([["new_thing", 5]]);
  });
});

describe("ProfileSections", () => {
  it("shows this month's usage with learner-facing activity names, never the internal keys", async () => {
    await render();
    const text = host.textContent;
    expect(text).toContain("15%");
    expect(text).toContain("Hỏi đáp");
    expect(text).not.toContain("answer");
    expect(text).not.toContain("chat");
    const bar = host.querySelector('[role="progressbar"]');
    expect(bar.getAttribute("aria-valuenow")).toBe("15");
  });

  it("a failed usage load says so and can be reloaded", async () => {
    usageResponse = () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
    await render();
    expect(host.textContent).toContain("Chưa tải được mức sử dụng.");
    usageResponse = ok(USAGE);
    await act(async () => { button("Tải lại").click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain("15%");
  });

  it("the theme choice shows the current state and writes the same setting the header uses", async () => {
    await render();
    const [light, dark] = host.querySelectorAll('[role="radio"]');
    expect(light.getAttribute("aria-checked")).toBe("true");
    await act(async () => { dark.click(); });
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("memvid-theme")).toBe("dark");
  });

  it("a local account gets sign-out but no password change", async () => {
    const onLogout = vi.fn();
    await render({ laNks: false, onLogout });
    expect(button("Đổi mật khẩu")).toBeUndefined();
    await act(async () => { button("Đăng xuất").click(); });
    expect(onLogout).toHaveBeenCalledWith();
  });

  it("an NKS account can change its password here; finishing signs out with the password-change reason", async () => {
    const onLogout = vi.fn();
    await render({ laNks: true, onLogout });
    await act(async () => { button("Đổi mật khẩu").click(); });
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    await act(async () => { button("xong").click(); });
    expect(onLogout).toHaveBeenCalledWith({ lyDo: "doi-mat-khau" });
  });
});
