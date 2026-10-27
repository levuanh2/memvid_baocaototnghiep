// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePage from "./ProfilePage";
import { quenGrant } from "../auth/grantNks";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigate = vi.fn();
let locationKey = "abc123";
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ key: locationKey }),
}));

const updateUserFields = vi.fn();
let mockUser = null;
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ user: mockUser, updateUserFields }) }));

vi.mock("../components/ui/Toaster", () => ({ toast: () => {} }));

const NKS_USER = { email: "nks@vidu.com", display_name: "Nguyễn Khôi", provider: "nks", phone: "0900000000" };
const LOCAL_USER = { email: "local@vidu.com", display_name: "Người Dùng", provider: "local" };

let container, root;
beforeEach(() => {
  locationKey = "abc123";
  quenGrant();
});
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove(); container = null; root = null;
  vi.clearAllMocks();
});

async function renderReady(user) {
  mockUser = user;
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<ProfilePage />));
  return container;
}

describe("Round 7 full-page Profile", () => {
  it("renders as a real page (no dialog role) and focuses the heading", async () => {
    const c = await renderReady(LOCAL_USER);
    expect(c.querySelector('[role="dialog"]')).toBeNull();
    const h1 = c.querySelector("h1");
    expect(h1?.textContent).toBe("Hồ sơ tài khoản");
    expect(document.activeElement).toBe(h1);
  });

  it("back button navigates(-1) when opened via app navigation, and to /app when opened directly", async () => {
    let c = await renderReady(LOCAL_USER);
    const back = () => [...c.querySelectorAll("button")].find((b) => b.textContent.includes("Quay lại"));
    await act(async () => back().click());
    expect(navigate).toHaveBeenCalledWith(-1);

    navigate.mockClear();
    locationKey = "default";
    if (root) act(() => root.unmount());
    c = await renderReady(LOCAL_USER);
    await act(async () => back().click());
    expect(navigate).toHaveBeenCalledWith("/app");
  });

  it("does not expose the NKS edit action for a non-NKS account, but shows it for an NKS account", async () => {
    let c = await renderReady(LOCAL_USER);
    expect([...c.querySelectorAll("button")].some((b) => b.textContent.includes("Chỉnh sửa"))).toBe(false);

    if (root) act(() => root.unmount());
    c = await renderReady(NKS_USER);
    expect([...c.querySelectorAll("button")].some((b) => b.textContent.includes("Chỉnh sửa"))).toBe(true);
  });
});

// NKS grant lifecycle (request-grant-before-edit, expiry mid-save, server-confirmed
// re-read) is owned by ProfileDrawer.jsx, which Round 7 did not change beyond
// threading a `variant` prop through to ProfileView — that logic is unmodified and
// already covered by the existing auth/grantNks.js + auth/hoSoForm.js unit tests.
// This file covers only the NEW page/routing contract Round 7 introduced.
