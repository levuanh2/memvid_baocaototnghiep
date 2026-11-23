// @vitest-environment jsdom
// V9.3 P4 (owner brief; docs/StudyMap-V9.3/06, 03): Focus Mode hides the secondary UI and
// keeps the document's mode switch; it exits by its button or Escape (a dialog keeps Escape);
// the layout before it comes back exactly; nothing is unmounted and no request is sent by
// any layout toggle; on phones only one side panel is open at a time.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MainLayout from "./MainLayout";
import { StudyContextProvider } from "../../study/StudyContextProvider";

beforeAll(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
});

const spies = vi.hoisted(() => ({ workspace: vi.fn(), inspector: vi.fn(), apiFetch: vi.fn(), chatProps: null }));

vi.mock("react-router-dom", () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("../../auth/useAuth", () => ({ useAuth: () => ({ user: null, logout: vi.fn() }) }));
vi.mock("../../utils/api", async (original) => ({
  ...(await original()),
  apiFetch: (...args) => { spies.apiFetch(...args); return new Promise(() => {}); },
}));
vi.mock("./SidebarRight", () => ({
  default: function InspectorStub() { useEffect(() => { spies.inspector(); }, []); return <div data-testid="inspector" />; },
}));
vi.mock("../study/ResearchTimeline", () => ({ default: () => null }));
vi.mock("./AccountMenu", () => ({ default: () => null }));
vi.mock("../ui/Toaster", () => ({ default: () => null }));
vi.mock("../shortcuts/ShortcutsOverlay", () => ({ default: () => null }));
vi.mock("./SidebarLeft", () => ({ default: () => <button type="button" data-testid="sources">sources</button> }));
vi.mock("./WorkspaceContainer", () => ({
  default: function WorkspaceStub({ chatProps }) {
    spies.chatProps = chatProps;
    useEffect(() => { spies.workspace(); }, []);
    return <textarea data-testid="composer" defaultValue="" />;
  },
}));

let container, root;

async function renderLayout(width, storedCollapsed) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  window.localStorage.clear();
  if (storedCollapsed) {
    window.localStorage.setItem("memvidx.panels.v1", JSON.stringify({ width: { left: 252, right: 360 }, collapsed: storedCollapsed }));
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<StudyContextProvider><MainLayout selectedSources={["a"]} setSelectedSources={() => {}} /></StudyContextProvider>);
  });
  await act(async () => { await Promise.resolve(); });
}

afterEach(() => {
  if (root) { act(() => { root.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  document.querySelectorAll("[data-test-dialog]").forEach((d) => d.remove());
  window.localStorage.clear();
  vi.clearAllMocks();
});

const shell = () => container.firstElementChild;
const focusButton = () => container.querySelector("button[data-focus-toggle]");
const press = async (key) => { await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); }); };
const hiddenInFocus = (el) => Boolean(el.closest(".focus-hide"));
const leftAside = () => container.querySelector("[data-testid='sources']").closest("aside");
const rightAside = () => container.querySelector("[data-testid='inspector']").closest("aside");

describe("Workspace Focus Mode", () => {
  it("enters from the header button and hides the secondary UI, keeping the mode switch", async () => {
    await renderLayout(1440);
    expect(focusButton().getAttribute("aria-pressed")).toBe("false");
    expect(focusButton().getAttribute("aria-label")).toBe("Tập trung");
    await act(async () => { focusButton().click(); });
    expect(shell().getAttribute("data-focus")).toBe("true");
    expect(focusButton().getAttribute("aria-pressed")).toBe("true");
    expect(focusButton().getAttribute("aria-label")).toBe("Thoát tập trung");
    for (const sel of [".workspace-home-link", ".study-library-link", "nav.app-bottom-nav", ".workspace-theme-toggle"]) {
      expect(hiddenInFocus(container.querySelector(sel)), sel).toBe(true);
    }
    expect(hiddenInFocus(leftAside())).toBe(true);
    // The evidence column is collapsed (still mounted), so a citation opened while focused shows.
    expect(rightAside().getAttribute("aria-hidden")).toBe("true");
    expect(hiddenInFocus(container.querySelector(".workspace-mode-switch"))).toBe(false);
    expect(hiddenInFocus(focusButton())).toBe(false);
  });

  it("leaves on Escape, but not while a dialog holds Escape", async () => {
    await renderLayout(1440);
    await act(async () => { focusButton().click(); });
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("data-test-dialog", "");
    document.body.appendChild(dialog);
    await press("Escape");
    expect(shell().getAttribute("data-focus")).toBe("true");
    dialog.remove();
    await press("Escape");
    expect(shell().getAttribute("data-focus")).toBe("false");
  });

  it("brings back exactly the panel layout from before", async () => {
    await renderLayout(1440, { left: false, right: true });
    const stored = window.localStorage.getItem("memvidx.panels.v1");
    const spinesBefore = container.querySelectorAll(".panel-spine").length;
    await act(async () => { focusButton().click(); });
    await act(async () => { focusButton().click(); });
    expect(window.localStorage.getItem("memvidx.panels.v1")).toBe(stored);
    expect(container.querySelectorAll(".panel-spine").length).toBe(spinesBefore);
    expect(shell().getAttribute("data-focus")).toBe("false");
  });

  it("keeps the workspace and inspector mounted, the draft typed, and sends no request", async () => {
    await renderLayout(1440);
    const composer = container.querySelector("[data-testid='composer']");
    composer.value = "Nửa câu hỏi về cung cầu";
    const calls = spies.apiFetch.mock.calls.length;
    await act(async () => { focusButton().click(); });
    await press("Escape");
    await act(async () => { focusButton().click(); });
    await act(async () => { focusButton().click(); });
    expect(spies.workspace).toHaveBeenCalledTimes(1);
    expect(spies.inspector).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-testid='composer']")).toBe(composer);
    expect(composer.value).toBe("Nửa câu hỏi về cung cầu");
    expect(spies.apiFetch.mock.calls.length).toBe(calls);
  });
});

describe("Phone side panels", () => {
  it("opens only one side panel at a time", async () => {
    await renderLayout(390);
    await act(async () => { spies.chatProps.onOpenLeft(); });
    expect(leftAside().getAttribute("aria-hidden")).toBeNull();
    await act(async () => { spies.chatProps.onOpenEvidence(); });
    expect(rightAside().getAttribute("aria-hidden")).toBeNull();
    expect(leftAside().getAttribute("aria-hidden")).toBe("true");
    await act(async () => { spies.chatProps.onOpenLeft(); });
    expect(leftAside().getAttribute("aria-hidden")).toBeNull();
    expect(rightAside().getAttribute("aria-hidden")).toBe("true");
  });

  it("closes an open drawer for Focus Mode and reopens it after", async () => {
    await renderLayout(390);
    await act(async () => { spies.chatProps.onOpenLeft(); });
    await act(async () => { focusButton().click(); });
    expect(leftAside().getAttribute("aria-hidden")).toBe("true");
    await act(async () => { focusButton().click(); });
    expect(leftAside().getAttribute("aria-hidden")).toBeNull();
  });
});
