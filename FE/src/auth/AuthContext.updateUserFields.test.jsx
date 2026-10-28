// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./AuthContext";
import { useAuth } from "./useAuth";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getCurrentUser = vi.fn();
const loginUser = vi.fn();
const logoutUser = vi.fn().mockResolvedValue(undefined);
const registerUser = vi.fn();
vi.mock("../utils/api", () => ({
  getCurrentUser: (...a) => getCurrentUser(...a),
  loginUser: (...a) => loginUser(...a),
  logoutUser: (...a) => logoutUser(...a),
  registerUser: (...a) => registerUser(...a),
}));

let token = null;
vi.mock("./tokenStore", () => ({
  getToken: () => token,
  setToken: (t) => { token = t; },
  clearToken: () => { token = null; },
}));
vi.mock("./authEvents", () => ({ installUnauthorizedHandler: () => () => {} }));
vi.mock("./khoiPhucBfcache", () => ({ caiDatKiemTraKhoiPhuc: () => () => {} }));
vi.mock("./phienNguoiDung", () => ({ xoaDuLieuPhienNguoiDung: () => {} }));
vi.mock("./grantNks", () => ({ quenGrant: () => {} }));

let container, root;
let api;
function Probe() {
  api = useAuth();
  return <div data-testid="user">{api.user ? `${api.user.id}:${api.user.phone ?? ""}` : "none"}</div>;
}

beforeEach(() => { token = null; });
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove(); container = null; root = null;
  vi.clearAllMocks();
});

async function mount() {
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
}

describe("AuthContext.updateUserFields", () => {
  it("merges fields into the current user when no identity is expected", async () => {
    await mount();
    loginUser.mockResolvedValue({ token: "t-a", user: { id: "user-a", email: "a@test.com" } });
    await act(async () => { await api.login("a@test.com", "pw"); });
    await act(async () => { api.updateUserFields({ phone: "0911111111" }); });
    expect(container.textContent).toBe("user-a:0911111111");
  });

  it("merges when the expected identity still matches the current user", async () => {
    await mount();
    loginUser.mockResolvedValue({ token: "t-a", user: { id: "user-a", email: "a@test.com" } });
    await act(async () => { await api.login("a@test.com", "pw"); });
    await act(async () => { api.updateUserFields({ phone: "0922222222" }, "user-a"); });
    expect(container.textContent).toBe("user-a:0922222222");
  });

  it("drops a stale update whose expected identity no longer matches the signed-in user", async () => {
    await mount();
    loginUser.mockResolvedValueOnce({ token: "t-a", user: { id: "user-a", email: "a@test.com", phone: "0900000000" } });
    await act(async () => { await api.login("a@test.com", "pw"); });

    // User A's slow profile save resolves AFTER user B has since logged in on the
    // same tab -- this must not overwrite user B's data with user A's.
    loginUser.mockResolvedValueOnce({ token: "t-b", user: { id: "user-b", email: "b@test.com" } });
    await act(async () => { await api.login("b@test.com", "pw"); });

    await act(async () => { api.updateUserFields({ phone: "0900000000" }, "user-a"); });
    expect(container.textContent).toBe("user-b:");
  });
});
