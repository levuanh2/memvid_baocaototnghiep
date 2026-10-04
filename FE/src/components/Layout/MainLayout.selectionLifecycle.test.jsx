// @vitest-environment jsdom
//
// Contextual MindMap selection lifecycle, through the REAL MainLayout and the
// REAL useMindMapController. Only the canvas (WorkspaceContainer) and the right
// panel (SidebarRight) are stubs; the stubs call the same entry points the real
// components use: `controller.onNodeSelected` (canvas click), `props.onClose`
// (node-detail X), `props.onGuidedClose` (Guided dialog close), and
// `onMindmapAction` (empty-state CTA).
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MainLayout from "./MainLayout";
import { StudyContextProvider } from "../../study/StudyContextProvider";

const { fakeMind, chatMountSpy } = vi.hoisted(() => ({
  fakeMind: { clearSelection: vi.fn() },
  chatMountSpy: vi.fn(),
}));

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
vi.mock("../mindmap/KnowledgeInspector", () => ({ default: () => <div data-testid="inspector-stub" /> }));
vi.mock("../study/ResearchTimeline", () => ({ default: () => <div data-testid="timeline-stub" /> }));
vi.mock("./AccountMenu", () => ({ default: () => <div data-testid="account-menu-stub" /> }));
vi.mock("../ui/Toaster", () => ({ default: () => null }));
vi.mock("../shortcuts/ShortcutsOverlay", () => ({ default: () => null }));

// Right panel stub: shows the contextual selection and exposes the two close
// paths the real panel uses (node-detail X and Guided close).
vi.mock("./SidebarRight", () => ({
  default: (props) => (
    <div data-testid="sidebar-right-stub">
      <span data-testid="selected-node">{props.mindMapController?.selected?.id ?? "none"}</span>
      <button type="button" onClick={() => props.onClose?.()}>close-node</button>
      <button type="button" onClick={() => props.onGuidedClose?.()}>close-guided</button>
    </div>
  ),
}));

// Canvas stub: registers the mind instance once (as MindElixirView does after
// init), and drives selection through the controller's real canvas entry point.
vi.mock("./WorkspaceContainer", () => ({
  default: ({ mode, controller, onMindmapAction }) => {
    useEffect(() => { controller.registerMindInstance(fakeMind, new Map()); }, [controller]);
    return (
      <div data-testid="workspace-stub" data-mode={mode}>
        <button type="button" onClick={() => controller.onNodeSelected([{ id: "a", topic: "A" }])}>pick-a</button>
        <button type="button" onClick={() => controller.onNodeSelected([{ id: "b", topic: "B" }])}>pick-b</button>
        <button type="button" onClick={() => onMindmapAction?.()}>workspace-cta</button>
      </div>
    );
  },
}));
vi.mock("./ChatArea", () => ({
  default: function ChatAreaMountSpyStub() {
    useEffect(() => { chatMountSpy(); }, []);
    return <div data-testid="chat-area-stub" />;
  },
}));

let container;
let root;
afterEach(() => {
  act(() => { root?.unmount(); });
  if (container) { container.remove(); container = null; }
  root = null;
  fakeMind.clearSelection.mockClear();
  vi.restoreAllMocks();
});

const ONE_SOURCE = [{ id: "doc-1", title: "Tài liệu", status: "ready" }];

async function renderApp() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <StudyContextProvider>
        <MainLayout selectedSources={ONE_SOURCE} setSelectedSources={() => {}} />
      </StudyContextProvider>
    );
  });
  await act(async () => { await Promise.resolve(); });
  await goMode("Sơ đồ tư duy");
}

async function goMode(label) {
  await act(async () => {
    [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent.includes(label))?.click();
  });
}

const clickButton = async (text) => {
  await act(async () => {
    [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === text)?.click();
  });
};
const selectedNode = () => container.querySelector('[data-testid="selected-node"]').textContent;
const asideOpen = () => container.querySelector("aside.mindmap-tools-overlay").style.opacity !== "0";

describe("MainLayout — contextual MindMap selection lifecycle", () => {
  it("manual close of the node detail clears the selection and closes the overlay (and clears the canvas selection)", async () => {
    await renderApp();
    await clickButton("pick-a");
    expect(selectedNode()).toBe("a");
    expect(asideOpen()).toBe(true);

    await clickButton("close-node");

    expect(selectedNode()).toBe("none");
    expect(asideOpen()).toBe(false);
    expect(fakeMind.clearSelection).toHaveBeenCalled();
  });

  it("after a manual close, MindMap -> Chat -> MindMap does not reopen the old node detail", async () => {
    await renderApp();
    await clickButton("pick-a");
    await clickButton("close-node");

    await goMode("Trò chuyện");
    await goMode("Sơ đồ tư duy");

    expect(selectedNode()).toBe("none");
    expect(asideOpen()).toBe(false);
  });

  it("selected node -> switch straight to Chat -> back to MindMap: detail is closed and selection is cleared", async () => {
    await renderApp();
    await clickButton("pick-a");
    expect(asideOpen()).toBe(true);

    await goMode("Trò chuyện");
    expect(fakeMind.clearSelection).toHaveBeenCalled();
    await goMode("Sơ đồ tư duy");

    expect(selectedNode()).toBe("none");
    expect(asideOpen()).toBe(false);
  });

  it("after reopening MindMap, clicking a new node opens the detail for that node", async () => {
    await renderApp();
    await clickButton("pick-a");
    await clickButton("close-node");
    await goMode("Trò chuyện");
    await goMode("Sơ đồ tư duy");

    await clickButton("pick-b");

    expect(selectedNode()).toBe("b");
    expect(asideOpen()).toBe(true);
  });

  it("selected node -> open Guided -> close Guided: node detail is restored and the selected node is kept", async () => {
    await renderApp();
    await clickButton("pick-a");
    expect(asideOpen()).toBe(true);

    await clickButton("workspace-cta");
    expect(asideOpen()).toBe(true);
    await clickButton("close-guided");

    expect(selectedNode()).toBe("a");
    expect(asideOpen()).toBe(true);
    expect(fakeMind.clearSelection).not.toHaveBeenCalled();
  });

  it("closing only the Guided dialog with no node selected leaves the overlay closed", async () => {
    await renderApp();
    await clickButton("workspace-cta");
    await clickButton("close-guided");

    expect(selectedNode()).toBe("none");
    expect(asideOpen()).toBe(false);
  });
});
