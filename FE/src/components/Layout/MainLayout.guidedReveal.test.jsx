// @vitest-environment jsdom
//
// Regression: in MindMap overlay mode the right <aside> is hidden
// (opacity:0, visibility:hidden, pointer-events:none) unless `rightOpen` is
// true. `openArtifact` set the artifact request but never opened `rightOpen`
// when the panel is not a drawer, so the Guided Mind Map dialog -- rendered
// inside that aside -- was mounted but invisible. With the global library
// removed, the empty-state create CTA became the only creation path, so this
// latent bug surfaced. These tests pin the reveal contract and the layout
// invariants around it.
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
vi.mock("./SidebarRight", () => ({ default: () => <div data-testid="sidebar-right-stub" /> }));
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

async function renderMainLayout() {
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
  await act(async () => { await Promise.resolve(); });
  return root;
}

const aside = () => container.querySelector("aside.mindmap-tools-overlay, aside.context-inspector-shell");

describe("MainLayout — openArtifact reveals the right aside", () => {
  it("opening an artifact from MindMap mode with no panel drawer opens the aside (opacity/visibility/pointer-events restored)", async () => {
    await renderMainLayout();
    await act(async () => {
      [...container.querySelectorAll('[role="tab"]')]
        .find((b) => b.textContent.includes("Sơ đồ tư duy"))?.click();
    });
    const cta = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Tạo sơ đồ tư duy");
    expect(cta, "empty-state create CTA must be present with zero maps").toBeTruthy();

    await act(async () => { cta.click(); });

    const el = aside();
    expect(el).toBeTruthy();
    expect(el.style.opacity).not.toBe("0");
    expect(el.style.visibility).not.toBe("hidden");
    expect(el.style.pointerEvents).not.toBe("none");
  });

  it("the sidebar-right host (which holds the Guided dialog) stays inside the revealed aside", async () => {
    await renderMainLayout();
    await act(async () => {
      [...container.querySelectorAll('[role="tab"]')]
        .find((b) => b.textContent.includes("Sơ đồ tư duy"))?.click();
    });
    const cta = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Tạo sơ đồ tư duy");
    await act(async () => { cta.click(); });
    expect(aside().contains(container.querySelector('[data-testid="sidebar-right-stub"]'))).toBe(true);
  });

  it("does not remount ChatArea when the artifact reveal runs", async () => {
    await renderMainLayout();
    const before = chatMountSpy.mock.calls.length;
    await act(async () => {
      [...container.querySelectorAll('[role="tab"]')]
        .find((b) => b.textContent.includes("Sơ đồ tư duy"))?.click();
    });
    const cta = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Tạo sơ đồ tư duy");
    await act(async () => { cta.click(); });
    expect(chatMountSpy.mock.calls.length).toBe(before);
  });
});

describe("MainLayout — zero-map MindMap state has exactly one create owner", () => {
  it("shows one create trigger, no standalone + and no global library dropdown", async () => {
    await renderMainLayout();
    await act(async () => {
      [...container.querySelectorAll('[role="tab"]')]
        .find((b) => b.textContent.includes("Sơ đồ tư duy"))?.click();
    });
    const createTriggers = [...container.querySelectorAll("button")]
      .filter((b) => /^Tạo sơ đồ/.test(b.textContent.trim()));
    expect(createTriggers.length).toBe(1);
    expect(container.querySelector('button[aria-label="Mở thư viện sơ đồ"]')).toBeNull();
    expect([...container.querySelectorAll("button")].some((b) => b.textContent.trim() === "+")).toBe(false);
    expect(container.querySelector('[role="listbox"][aria-label="Chọn sơ đồ"]')).toBeNull();
  });
});
