// @vitest-environment jsdom
//
// Round 12 regression: "exactly one visible Chat mode-switch owner". Round 11
// merged the mode-switch tabs into MainLayout's own single-row header
// (LessonHeader.jsx, which used to own a second copy, was deleted). This
// proves the invariant holds by actually rendering MainLayout and counting
// `role="tab"` elements, instead of re-reading that history in prose.
//
// Heavy children (SidebarLeft/SidebarRight/WorkspaceContainer/
// KnowledgeInspector/ResearchTimeline/AccountMenu/Toaster/ShortcutsOverlay)
// are stubbed — this test is about header/mode-switch ownership, not their
// internals (those have their own dedicated test files). react-router-dom
// and useAuth are mocked so MainLayout can mount without a real Router/
// AuthProvider tree.
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
}

describe("MainLayout mode-switch ownership", () => {
  it("renders exactly one tablist with exactly three mode tabs, no duplicate nav row", async () => {
    await renderMainLayout();
    const tablists = container.querySelectorAll('[role="tablist"]');
    expect(tablists.length).toBe(1);
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(3);
    const labels = Array.from(tabs).map((t) => t.getAttribute("title"));
    expect(labels).toEqual(["Trò chuyện", "Sơ đồ tư duy", "Tóm tắt"]);
  });

  it("clicking a mode tab switches the workspace pane (single real owner, not decorative)", async () => {
    await renderMainLayout();
    const mindmapTab = Array.from(container.querySelectorAll('[role="tab"]'))
      .find((t) => t.getAttribute("title") === "Sơ đồ tư duy");
    await act(async () => { mindmapTab.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const stub = container.querySelector('[data-testid="workspace-stub"]');
    expect(stub.textContent).toBe("mindmap");
  });
});
