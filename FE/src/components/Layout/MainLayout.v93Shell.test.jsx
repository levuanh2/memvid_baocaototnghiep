// @vitest-environment jsdom
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

vi.mock("react-router-dom", () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("../../auth/useAuth", () => ({ useAuth: () => ({ user: null, logout: vi.fn() }) }));
vi.mock("./SidebarRight", () => ({ default: () => <div data-testid="sidebar-right-stub" /> }));
vi.mock("../study/ResearchTimeline", () => ({ default: () => null }));
vi.mock("./AccountMenu", () => ({ default: () => null }));
vi.mock("../ui/Toaster", () => ({ default: () => null }));
vi.mock("../shortcuts/ShortcutsOverlay", () => ({ default: () => null }));

const { sidebarMountSpy, workspaceMountSpy } = vi.hoisted(() => ({
  sidebarMountSpy: vi.fn(),
  workspaceMountSpy: vi.fn(),
}));

vi.mock("./SidebarLeft", () => ({
  default: function SidebarLeftStub({ railMode, onClose }) {
    useEffect(() => { sidebarMountSpy(); }, []);
    return <button data-testid="sidebar-left-stub" data-rail-mode={String(Boolean(railMode))} onClick={onClose}>sources</button>;
  },
}));
vi.mock("./WorkspaceContainer", () => ({
  default: function WorkspaceStub() {
    useEffect(() => { workspaceMountSpy(); }, []);
    return <div data-testid="workspace-stub" />;
  },
}));

let container;
let root;

function setViewport(width) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

async function renderLayout(width, storedCollapsed) {
  setViewport(width);
  window.localStorage.clear();
  if (storedCollapsed) {
    window.localStorage.setItem("memvidx.panels.v1", JSON.stringify({
      width: { left: 252, right: 360 },
      collapsed: storedCollapsed,
    }));
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<StudyContextProvider><MainLayout selectedSources={[]} setSelectedSources={() => {}} /></StudyContextProvider>);
  });
  await act(async () => { await Promise.resolve(); });
}

afterEach(() => {
  if (root) { act(() => { root.unmount(); }); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  window.localStorage.clear();
});

// V9.3 P1b: the workspace (/app) keeps the same bottom nav as the study pages, in the
// layout flow (not fixed over the composer), plus a skip link to a focusable main.
describe("MainLayout V9.3 shell", () => {
  it("renders the bottom nav with Học tập current and a skip link to main", async () => {
    await renderLayout(390);
    const nav = container.querySelector("nav.app-bottom-nav");
    expect(nav).not.toBeNull();
    expect(nav.className).toContain("app-bottom-nav--inflow");
    const current = [...nav.querySelectorAll("a[aria-current='page']")].map((a) => a.textContent.trim());
    expect(current).toEqual(["Học tập"]);
    expect(container.querySelector("a.skip-link").getAttribute("href")).toBe("#main-content");
    const main = container.querySelector("main#main-content");
    expect(main.getAttribute("tabindex")).toBe("-1");
  });
});
