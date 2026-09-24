// @vitest-environment jsdom
//
// Regression test for a real bug found and fixed this session: the Mind Map
// overlay branch of the right-panel render block wrapped <ContextInspector>
// (which renders SidebarRight — the owner of fetchMindMaps/generation/the
// library's own onSelect handling) inside `rightOpen && (...)`. Since
// `rightOpen` starts false (closed-by-default is a spec requirement),
// SidebarRight never mounted in Mind Map mode until a node was already
// selected — a chicken-and-egg deadlock: nothing could ever select a map
// from the library, because the component that handles selection hadn't
// mounted yet. Confirmed live via a `git stash` A/B test against the
// original code. The fix unifies the overlay/rail/drawer cases into ONE
// always-mounted <aside><ContextInspector/></aside>, hiding the overlay
// visually via CSS (opacity/pointer-events/visibility) instead of
// conditional JSX — this test proves that invariant directly instead of
// re-deriving it from a screenshot each time.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
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
vi.mock("./SidebarRight", () => ({ default: () => <div data-testid="sidebar-right-stub" /> }));
vi.mock("./WorkspaceContainer", () => ({ default: ({ mode }) => <div data-testid="workspace-stub">{mode}</div> }));
vi.mock("../mindmap/KnowledgeInspector", () => ({ default: () => <div data-testid="inspector-stub" /> }));
vi.mock("../study/ResearchTimeline", () => ({ default: () => <div data-testid="timeline-stub" /> }));
vi.mock("./AccountMenu", () => ({ default: () => <div data-testid="account-menu-stub" /> }));
vi.mock("../ui/Toaster", () => ({ default: () => null }));
vi.mock("../shortcuts/ShortcutsOverlay", () => ({ default: () => null }));

let container;

afterEach(() => {
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
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
  return root;
}

describe("MainLayout right-panel mount stability (Mind Map overlay)", () => {
  it("keeps SidebarRight (via ContextInspector) mounted in Mind Map mode immediately after switching, before any node is selected", async () => {
    await renderMainLayout();
    const mindmapTab = Array.from(container.querySelectorAll('[role="tab"]'))
      .find((t) => t.getAttribute("title") === "Sơ đồ tư duy");
    await act(async () => { mindmapTab.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    // rightOpen defaults to false (closed-by-default) — the bug made the
    // stub disappear from the DOM at exactly this point.
    const stub = container.querySelector('[data-testid="sidebar-right-stub"]');
    expect(stub).not.toBeNull();
  });

  it("hides the closed overlay via CSS, not by unmounting it", async () => {
    await renderMainLayout();
    const mindmapTab = Array.from(container.querySelectorAll('[role="tab"]'))
      .find((t) => t.getAttribute("title") === "Sơ đồ tư duy");
    await act(async () => { mindmapTab.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const overlay = container.querySelector(".mindmap-tools-overlay");
    expect(overlay).not.toBeNull();
    // closed by default: not visible, but still present in the DOM
    expect(overlay.style.pointerEvents).toBe("none");
    expect(overlay.style.visibility).toBe("hidden");
    expect(overlay.contains(container.querySelector('[data-testid="sidebar-right-stub"]'))).toBe(true);
  });
});
