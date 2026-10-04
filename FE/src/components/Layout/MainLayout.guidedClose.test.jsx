// @vitest-environment jsdom
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
// Stands in for the Guided dialog's own close: calls the callback MainLayout wires.
vi.mock("./SidebarRight", () => ({
  default: (props) => (
    <div data-testid="sidebar-right-stub">
      <button type="button" onClick={() => props.onGuidedClose?.()}>close-guided</button>
    </div>
  ),
}));
vi.mock("../mindmap/KnowledgeInspector", () => ({ default: () => <div data-testid="inspector-stub" /> }));
vi.mock("../study/ResearchTimeline", () => ({ default: () => <div data-testid="timeline-stub" /> }));
vi.mock("./AccountMenu", () => ({ default: () => <div data-testid="account-menu-stub" /> }));
vi.mock("../ui/Toaster", () => ({ default: () => null }));
vi.mock("../shortcuts/ShortcutsOverlay", () => ({ default: () => null }));

const { chatMountSpy } = vi.hoisted(() => ({ chatMountSpy: vi.fn() }));
function ChatAreaMountSpyStub() {
  useEffect(() => { chatMountSpy(); }, []);
  return <div data-testid="chat-area-stub" />;
}
vi.mock("./ChatArea", () => ({ default: ChatAreaMountSpyStub }));

let container;
afterEach(() => {
  if (container) { document.body.removeChild(container); container = null; }
  vi.restoreAllMocks();
  chatMountSpy.mockClear();
});

const ONE_SOURCE = [{ id: "doc-1", title: "Tài liệu", status: "ready" }];

async function renderInMindMapMode() {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <StudyContextProvider>
        <MainLayout selectedSources={ONE_SOURCE} setSelectedSources={() => {}} />
      </StudyContextProvider>
    );
  });
  await act(async () => {
    [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent.includes("Sơ đồ tư duy"))?.click();
  });
  return root;
}

const aside = () => container.querySelector("aside.mindmap-tools-overlay");
const buttonByText = (text) => [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === text);

describe("MainLayout — closing the Guided dialog restores the aside", () => {
  it("zero maps: close returns the overlay to hidden, keeps the empty-state CTA, and does not remount ChatArea", async () => {
    await renderInMindMapMode();
    const mountsBefore = chatMountSpy.mock.calls.length;

    await act(async () => { buttonByText("Tạo sơ đồ tư duy").click(); });
    expect(aside().style.opacity).not.toBe("0");

    await act(async () => { buttonByText("close-guided").click(); });
    expect(aside().style.opacity).toBe("0");
    expect(aside().style.visibility).toBe("hidden");
    expect(aside().style.pointerEvents).toBe("none");
    expect(buttonByText("Tạo sơ đồ tư duy")).toBeTruthy();
    expect(chatMountSpy.mock.calls.length).toBe(mountsBefore);
  });

  it("closing without a prior artifact request is a no-op for the overlay", async () => {
    await renderInMindMapMode();
    const before = aside().getAttribute("style");
    await act(async () => { buttonByText("close-guided").click(); });
    expect(aside().getAttribute("style")).toBe(before);
  });
});
