// @vitest-environment jsdom
// V9.3 P5b (#210 review P2): a session that ended with a browser-notes draft the browser
// refused to save tells the learner once, on the login screen.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";

vi.mock("react-router-dom", () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
  Navigate: () => null,
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams("")],
}));
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ user: null, loading: false, login: vi.fn(), error: "", setError: vi.fn() }) }));

import Login from "./Login";

let container, root;
afterEach(() => { act(() => root.unmount()); container.remove(); window.sessionStorage.clear(); });

async function renderLogin() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Login />); });
}

describe("Login: lost browser-notes draft", () => {
  it("says once that a draft was lost", async () => {
    window.sessionStorage.setItem("studymap.notes.unsavedLost", "1");
    await renderLogin();
    expect(container.querySelector("[role='alert']").textContent).toMatch(/bản nháp ghi chú chưa lưu được/);
    expect(window.sessionStorage.getItem("studymap.notes.unsavedLost")).toBeNull();
  });

  it("says nothing when no draft was lost", async () => {
    await renderLogin();
    expect(container.textContent).not.toMatch(/bản nháp ghi chú/);
  });
});
