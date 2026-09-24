// @vitest-environment jsdom
//
// 2026-09-24 regression: SidebarRight (the only owner of fetchMindMaps/
// fetchSummaries, guided-generation polling and the Guided dialog) used to
// live entirely inside the right panel's `panel.collapsed.right` branch in
// MainLayout.jsx. The right panel starts collapsed on a fresh session, so
// SidebarRight never mounted and its fetch-on-mount effect never ran --
// confirmed live in production: a fresh page load issued zero requests to
// /mindmaps or /summaries, and the mind map/summary catalog stayed at 0
// items no matter what existed server-side, until a user happened to
// manually expand the "Bằng chứng" panel. This proves SidebarRight now
// mounts immediately on initial render, with no panel-expand interaction,
// regardless of the right panel's collapsed/expanded state.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MainLayout from "./MainLayout";
import { StudyContextProvider } from "../../study/StudyContextProvider";

beforeAll(() => {
  window.matchMedia = window.matchMedia || function () {
    return { matches: false, addEventListener() {}, removeEventListener() {} };
  };
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
  window.ResizeObserver = window.ResizeObserver || class {
    observe() {} unobserve() {} disconnect() {}
  };
});

vi.mock("react-router-dom", () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({ user: { name: "Test User" }, logout: vi.fn() }),
}));
vi.mock("./SidebarLeft", () => ({ default: () => <div data-testid="sidebar-left-stub" /> }));
vi.mock("./WorkspaceContainer", () => ({ default: ({ mode }) => <div data-testid="workspace-stub">{mode}</div> }));
vi.mock("../study/ResearchTimeline", () => ({ default: () => <div data-testid="timeline-stub" /> }));
vi.mock("./AccountMenu", () => ({ default: () => <div data-testid="account-menu-stub" /> }));
vi.mock("../ui/Toaster", () => ({ default: () => null }));
vi.mock("../shortcuts/ShortcutsOverlay", () => ({ default: () => null }));

const { sidebarRightMountSpy } = vi.hoisted(() => ({ sidebarRightMountSpy: vi.fn() }));
vi.mock("./SidebarRight", () => ({
  default: () => {
    useEffect(() => { sidebarRightMountSpy(); }, []);
    return <div data-testid="sidebar-right-stub" />;
  },
}));

let container;

afterEach(() => {
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
  sidebarRightMountSpy.mockClear();
});

async function renderMainLayout() {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <StudyContextProvider>
        <MainLayout selectedSources={[]} setSelectedSources={() => {}} />
      </StudyContextProvider>
    );
  });
  await act(async () => { await Promise.resolve(); });
}

describe("MainLayout / SidebarRight mount lifecycle", () => {
  it("mounts SidebarRight immediately on initial render, with the right panel still collapsed", async () => {
    await renderMainLayout();
    // The right "Bằng chứng" panel starts collapsed by default (only a
    // PanelSpine rail is visible) -- SidebarRight must still be mounted.
    expect(sidebarRightMountSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="sidebar-right-stub"]')).toBeTruthy();
  });
});
