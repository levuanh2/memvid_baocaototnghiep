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
  // Phase C Round 3 (Codex2 review): unmount before detaching so effect
  // cleanup (the resize listener this file's MainLayout adds) actually
  // runs — removing the container alone leaves it dangling across cases.
  if (root) { act(() => { root.unmount(); }); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  window.localStorage.clear();
  sidebarMountSpy.mockClear();
  workspaceMountSpy.mockClear();
});

describe("MainLayout Learning Desk responsive shell", () => {
  it("expands and collapses the 56px tablet source rail without duplicate mounts", async () => {
    await renderLayout(820);
    const shell = container.querySelector('[data-source-layout="rail"]');
    expect(shell).toBeTruthy();
    expect(shell.style.width).toBe("56px");
    expect(container.querySelectorAll('[data-testid="sidebar-left-stub"]')).toHaveLength(1);
    expect(sidebarMountSpy).toHaveBeenCalledTimes(1);

    await act(async () => { container.querySelector('[data-testid="sidebar-left-stub"]').click(); });
    expect(container.querySelector('[data-source-layout="shelf"]').style.width).toBe("252px");
    expect(sidebarMountSpy).toHaveBeenCalledTimes(1);
    expect(workspaceMountSpy).toHaveBeenCalledTimes(1);

    await act(async () => { container.querySelector('[data-testid="sidebar-left-stub"]').click(); });
    expect(container.querySelector('[data-source-layout="rail"]').style.width).toBe("56px");
    expect(sidebarMountSpy).toHaveBeenCalledTimes(1);
  });

  it.each([768, 769, 780, 800, 820, 1024])("holds the Inspector at its 320px floor at %ipx", async (width) => {
    await renderLayout(width, { left: true, right: false });
    const inspector = container.querySelector(".context-inspector-shell");
    expect(inspector).toBeTruthy();
    expect(inspector.style.minWidth).toBe("320px");
    expect(Number.parseFloat(inspector.style.width)).toBeGreaterThanOrEqual(320);
  });
});
