// @vitest-environment jsdom
// V9.3 P2b (docs/StudyMap-V9.3/04 "Auth"): dark intro panel + light form; label →
// input → helper/error → CTA; the error is announced and tied to the fields; the real
// auth calls, StudyMap/NKS provider, safeNext and the 8-character rule are unchanged.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Login from "./Login";
import Register from "./Register";

const auth = vi.hoisted(() => ({ error: "", login: null, register: null, setError: null }));
vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false, error: auth.error, setError: auth.setError,
    login: auth.login, register: auth.register }),
}));

let container, root, where;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  container = root = null;
  auth.error = "";
});

function Where() { where = useLocation(); return null; }

async function render(path) {
  auth.setError = vi.fn((e) => { auth.error = e; });
  auth.login = vi.fn(async () => {});
  auth.register = vi.fn(async () => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<p>đích</p>} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return container;
}

async function type(input, value) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  await act(async () => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(c) {
  await act(async () => { c.querySelector("form").requestSubmit(); });
}

describe("Login V9.3", () => {
  it("pairs a dark intro panel with the form", async () => {
    const c = await render("/login");
    expect(c.querySelector(".auth-intro.lp-ink")).not.toBeNull();
    expect(c.querySelector(".auth-form form")).not.toBeNull();
    expect(c.querySelector("h1").textContent).toBe("Đăng nhập");
  });

  it("keeps the StudyMap/NKS choice and the typed values when switching", async () => {
    const c = await render("/login");
    await type(c.querySelector("input[type='email']"), "a@b.vn");
    const nks = [...c.querySelectorAll("[role='radio']")].find((b) => b.textContent === "NKS");
    await act(async () => { nks.click(); });
    expect(c.querySelector("input[autocomplete='username']")).not.toBeNull();
    const local = [...c.querySelectorAll("[role='radio']")].find((b) => b.textContent === "StudyMap");
    await act(async () => { local.click(); });
    expect(c.querySelector("input[type='email']").value).toBe("a@b.vn");
  });

  it("announces the error and ties it to the fields, keeping what was typed", async () => {
    auth.error = "Email hoặc mật khẩu không đúng.";
    const c = await render("/login");
    const alert = c.querySelector("[role='alert']");
    expect(alert.textContent).toContain("không đúng");
    for (const input of c.querySelectorAll("form input")) {
      expect(input.getAttribute("aria-describedby")).toContain(alert.id);
      expect(input.getAttribute("aria-invalid")).toBe("true");
    }
  });

  it("signs in through the real call and only follows a safe next", async () => {
    const c = await render("/login?next=%2F%2Fevil.example");
    await type(c.querySelector("input[type='email']"), "a@b.vn");
    await type(c.querySelector("input[type='password']"), "matkhau123");
    await submit(c);
    expect(auth.login).toHaveBeenCalledWith("a@b.vn", "matkhau123", undefined);
    expect(where.pathname).toBe("/app");
  });

  it("follows a safe in-app next", async () => {
    const c = await render("/login?next=%2Fapp%2Fstudy");
    await type(c.querySelector("input[type='email']"), "a@b.vn");
    await type(c.querySelector("input[type='password']"), "matkhau123");
    await submit(c);
    expect(where.pathname).toBe("/app/study");
  });
});

describe("Register V9.3", () => {
  it("shows the real password rule as helper text tied to the field", async () => {
    const c = await render("/register");
    expect(c.querySelector(".auth-intro.lp-ink")).not.toBeNull();
    const pw = c.querySelector("input[autocomplete='new-password']");
    const helper = c.querySelector(`#${pw.getAttribute("aria-describedby").split(" ")[0]}`);
    expect(helper.textContent).toBe("Ít nhất 8 ký tự.");
    // The accessible name stays "Mật khẩu" (e2e/fixtures.js finds the field by it).
    expect(pw.labels[0].textContent).toBe("Mật khẩu");
  });

  it("refuses a short password before calling the server", async () => {
    const c = await render("/register");
    await type(c.querySelector("input[type='email']"), "a@b.vn");
    const [pw, again] = c.querySelectorAll("input[autocomplete='new-password']");
    await type(pw, "short");
    await type(again, "short");
    await submit(c);
    expect(auth.register).not.toHaveBeenCalled();
    expect(auth.setError).toHaveBeenCalledWith("Mật khẩu cần ít nhất 8 ký tự.");
  });

  it("registers through the real call and lands on a safe next", async () => {
    const c = await render("/register?next=https%3A%2F%2Fevil.example");
    await type(c.querySelector("input[type='email']"), "a@b.vn");
    const [pw, again] = c.querySelectorAll("input[autocomplete='new-password']");
    await type(pw, "matkhau123");
    await type(again, "matkhau123");
    await submit(c);
    expect(auth.register).toHaveBeenCalledWith({ email: "a@b.vn", password: "matkhau123", display_name: "" });
    expect(where.pathname).toBe("/app");
  });
});
