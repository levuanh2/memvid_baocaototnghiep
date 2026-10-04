// @vitest-environment jsdom
//
// Mobile (drawer) Mind Map node-detail close. Desktop already clears the contextual
// selection on close; on mobile the same surface is a bottom sheet (panel.drawer
// === true) and the close paths used to hide it without clearing the selection,
// so the sheet did not reopen for the same node and the canvas kept the highlight.
// Only the canvas (WorkspaceContainer) and the right panel body (SidebarRight) are
// stubs; the close paths, the controller and the canvas selection calls are real.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MainLayout from "./MainLayout";
import { StudyContextProvider } from "../../study/StudyContextProvider";

const { fakeMind, chatMountSpy, mountSpy } = vi.hoisted(() => ({
  fakeMind: { clearSelection: vi.fn(), scaleFit: vi.fn(), toCenter: vi.fn() },
  chatMountSpy: vi.fn(),
  mountSpy: vi.fn(),
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

// Right panel body: shows the contextual selection and exposes the real close
// callbacks MainLayout passes (node-detail X and Guided close).
vi.mock("./SidebarRight", () => ({
  default: (props) => (
    <div data-testid="sidebar-right-stub">
      <span data-testid="selected-node">{props.mindMapController?.selected?.id ?? "none"}</span>
      <button type="button" onClick={() => props.onClose?.()}>close-node</button>
      <button type="button" onClick={() => props.onGuidedClose?.()}>close-guided</button>
    </div>
  ),
}));

vi.mock("./WorkspaceContainer", () => ({
  default: function WorkspaceStub({ mode, controller, onMindmapAction }) {
    useEffect(() => { mountSpy(); }, []);
    useEffect(() => { controller.registerMindInstance(fakeMind, new Map()); }, [controller]);
    return (
      <div data-testid="workspace-stub" data-mode={mode}>
        <button type="button" onClick={() => controller.onNodeSelected([{ id: "a", topic: "A" }])}>pick-a</button>
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
const realInnerWidth = window.innerWidth;

afterEach(() => {
  act(() => { root?.unmount(); });
  if (container) { container.remove(); container = null; }
  root = null;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: realInnerWidth });
  fakeMind.clearSelection.mockClear();
  fakeMind.scaleFit.mockClear();
  fakeMind.toCenter.mockClear();
  mountSpy.mockClear();
  chatMountSpy.mockClear();
  vi.restoreAllMocks();
});

const ONE_SOURCE = [{ id: "doc-1", title: "Tài liệu", status: "ready" }];

// Narrow viewport: MainLayout's usePanelLayout reads window.innerWidth -> drawer mode.
async function renderMobile({ startInMindmap = true } = {}) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
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
  if (startInMindmap) await goMode("Sơ đồ tư duy");
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
// The mobile bottom sheet is the drawer-mode right aside; it is hidden by translate-y-full.
const sheet = () => container.querySelector("aside.context-inspector-shell");
const sheetOpen = () => !!sheet() && !sheet().className.includes("translate-y-full");

describe("MainLayout — mobile node-detail close clears the contextual selection", () => {
  it("X close hides the bottom sheet, clears the React selection and the canvas selection", async () => {
    await renderMobile();
    await clickButton("pick-a");
    expect(sheetOpen()).toBe(true);
    expect(selectedNode()).toBe("a");

    await clickButton("close-node");

    expect(sheetOpen()).toBe(false);
    expect(selectedNode()).toBe("none");
    expect(fakeMind.clearSelection).toHaveBeenCalled();
  });

  it("Escape closes the bottom sheet and clears the selection", async () => {
    await renderMobile();
    await clickButton("pick-a");
    expect(sheetOpen()).toBe(true);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(sheetOpen()).toBe(false);
    expect(selectedNode()).toBe("none");
    expect(fakeMind.clearSelection).toHaveBeenCalled();
  });

  it("the backdrop closes the bottom sheet and clears the selection", async () => {
    await renderMobile();
    await clickButton("pick-a");
    const backdrop = container.querySelector("div.fixed.inset-0");
    expect(backdrop, "backdrop present while the sheet is open").toBeTruthy();

    await act(async () => { backdrop.click(); });

    expect(sheetOpen()).toBe(false);
    expect(selectedNode()).toBe("none");
  });

  it("after a mobile X close, tapping the same node opens the sheet again", async () => {
    await renderMobile();
    await clickButton("pick-a");
    await clickButton("close-node");
    expect(sheetOpen()).toBe(false);

    await clickButton("pick-a");

    expect(selectedNode()).toBe("a");
    expect(sheetOpen()).toBe(true);
  });

  it("Mind Map -> Chat -> Mind Map after a mobile close does not reopen the old node", async () => {
    await renderMobile();
    await clickButton("pick-a");
    await clickButton("close-node");

    await goMode("Trò chuyện");
    await goMode("Sơ đồ tư duy");

    expect(sheetOpen()).toBe(false);
    expect(selectedNode()).toBe("none");
  });

  it("closing the generic right drawer outside Mind Map does not touch the Mind Map selection", async () => {
    await renderMobile({ startInMindmap: false });
    await goMode("Trò chuyện");
    await clickButton("close-node");

    expect(fakeMind.clearSelection).not.toHaveBeenCalled();
    expect(selectedNode()).toBe("none");
  });

  it("Guided close restores the node sheet with the same node selected", async () => {
    await renderMobile();
    await clickButton("pick-a");
    expect(sheetOpen()).toBe(true);

    await clickButton("workspace-cta");
    await clickButton("close-guided");

    expect(selectedNode()).toBe("a");
    expect(sheetOpen()).toBe(true);
    expect(fakeMind.clearSelection).not.toHaveBeenCalled();
  });

  it("closing the sheet never remounts the canvas or calls scaleFit/toCenter", async () => {
    await renderMobile();
    const mountsBefore = mountSpy.mock.calls.length;
    await clickButton("pick-a");
    await clickButton("close-node");

    expect(mountSpy.mock.calls.length).toBe(mountsBefore);
    expect(fakeMind.scaleFit).not.toHaveBeenCalled();
    expect(fakeMind.toCenter).not.toHaveBeenCalled();
  });
});
