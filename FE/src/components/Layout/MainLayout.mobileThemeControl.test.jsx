// @vitest-environment jsdom
//
// Mobile/tablet theme control PR — red tests written against the UNMODIFIED
// MainLayout (base: origin/main @ 1ac702b). Desktop's theme toggle is
// `hidden lg:flex`, so <1024px has zero reachable theme control today.
// Approved checkpoint: reuse `useTheme`'s existing toggleTheme/isDark (no
// second state source), add exactly one dynamic item to StudyToolsMenu's
// existing `extraActions` (already `lg:hidden`, matching the breakpoint).
//
// jsdom has no real CSS cascade -- it cannot prove an element is actually
// invisible at a given viewport, only that the right Tailwind classes are
// present. True per-breakpoint reachability/hit-target/overflow/native
// Enter-Space activation are proven for real in the Phase 4 Playwright
// pass; these tests cover logic, state, wiring and regression instead.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import MainLayout from "./MainLayout";
import { StudyContextProvider } from "../../study/StudyContextProvider";

const STORAGE_KEY = "memvid-theme";
const LIGHT_LABEL = "Chuyển sang nền tối"; // shown while light -- next action is "go dark"
const DARK_LABEL = "Chuyển sang nền sáng"; // shown while dark -- next action is "go light"

const { fakeMind, mountSpy } = vi.hoisted(() => ({
  fakeMind: { clearSelection: vi.fn(), scaleFit: vi.fn(), toCenter: vi.fn() },
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
vi.mock("./SidebarRight", () => ({ default: () => <div data-testid="sidebar-right-stub" /> }));
vi.mock("./WorkspaceContainer", () => ({
  default: function WorkspaceStub({ controller }) {
    useEffect(() => { mountSpy(); }, []);
    useEffect(() => { controller.registerMindInstance(fakeMind, new Map()); }, [controller]);
    return <div data-testid="workspace-stub" />;
  },
}));
vi.mock("./ChatArea", () => ({ default: () => <div data-testid="chat-area-stub" /> }));

let container;
let root;
const realInnerWidth = window.innerWidth;

afterEach(() => {
  act(() => { root?.unmount(); });
  if (container) { container.remove(); container = null; }
  root = null;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: realInnerWidth });
  localStorage.clear();
  fakeMind.scaleFit.mockClear();
  fakeMind.toCenter.mockClear();
  mountSpy.mockClear();
  vi.restoreAllMocks();
});

async function render({ width = 390 } = {}) {
  localStorage.setItem(STORAGE_KEY, "light"); // deterministic starting point, not an OS guess
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <StudyContextProvider>
        <MainLayout selectedSources={[]} setSelectedSources={() => {}} />
      </StudyContextProvider>
    );
  });
  await act(async () => { await Promise.resolve(); });
}

async function openOverflowMenu() {
  await act(async () => {
    container.querySelector(".study-tools-trigger")?.click();
  });
}

const themeMenuItem = () =>
  [...container.querySelectorAll('[role="menuitem"]')].find(
    (el) => el.textContent.includes(LIGHT_LABEL) || el.textContent.includes(DARK_LABEL)
  );

describe("MainLayout — mobile/tablet theme control reachability", () => {
  it.each([390, 768, 1023])("at %dpx, opening the overflow menu exposes exactly one theme action", async (width) => {
    await render({ width });
    await openOverflowMenu();
    const matches = [...container.querySelectorAll('[role="menuitem"]')].filter(
      (el) => el.textContent.includes(LIGHT_LABEL) || el.textContent.includes(DARK_LABEL)
    );
    expect(matches).toHaveLength(1);
  });

  it("at 1024/1440 the mobile action stays inside the lg:hidden wrapper, never a second always-visible control", async () => {
    await render({ width: 1440 });
    await openOverflowMenu();
    const item = themeMenuItem();
    expect(item).toBeTruthy();
    // Phase 4 proves this is actually hidden by the real CSS cascade at
    // >=1024px -- here we only guard that it still lives inside the exact
    // wrapper that is already `lg:hidden` (never pulled out into a
    // top-level, always-visible header control).
    expect(item.closest(".lg\\:hidden")).toBeTruthy();
  });

  it("the desktop toggle is untouched: two buttons, hidden lg:flex, still functional", async () => {
    await render({ width: 1440 });
    const group = container.querySelector('[role="group"][aria-label="Chế độ sáng/tối"]');
    expect(group).toBeTruthy();
    expect(group.className).toMatch(/hidden/);
    expect(group.className).toMatch(/lg:flex/);
    const buttons = group.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
  });
});

describe("MainLayout — mobile theme action switches the shared theme state", () => {
  it("Light -> Dark via the real mobile control: class, storage key and label all update", async () => {
    await render();
    await openOverflowMenu();
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await act(async () => { themeMenuItem().click(); });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
    await openOverflowMenu();
    expect(themeMenuItem().textContent).toContain(DARK_LABEL);
  });

  it("Dark -> Light via the real mobile control: class, storage key and label all revert", async () => {
    await render();
    await openOverflowMenu();
    await act(async () => { themeMenuItem().click(); }); // light -> dark
    await openOverflowMenu();
    await act(async () => { themeMenuItem().click(); }); // dark -> light

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
    await openOverflowMenu();
    expect(themeMenuItem().textContent).toContain(LIGHT_LABEL);
  });

  it("the accessible name always names the NEXT action, not the current state", async () => {
    await render();
    await openOverflowMenu();
    const item = themeMenuItem();
    expect(item.textContent).toContain(LIGHT_LABEL); // currently light -> offers "go dark"
    await act(async () => { item.click(); });
    await openOverflowMenu();
    expect(themeMenuItem().textContent).toContain(DARK_LABEL); // now dark -> offers "go light"
  });

  it("a remount after an explicit mobile choice still reads it back (reload persistence)", async () => {
    await render();
    await openOverflowMenu();
    await act(async () => { themeMenuItem().click(); }); // light -> dark
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");

    act(() => { root.unmount(); });
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <StudyContextProvider>
          <MainLayout selectedSources={[]} setSelectedSources={() => {}} />
        </StudyContextProvider>
      );
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("resizing across the 1023<->1024 breakpoint does not change the theme state", async () => {
    await render({ width: 390 });
    await openOverflowMenu();
    await act(async () => { themeMenuItem().click(); }); // light -> dark
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await act(async () => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
      window.dispatchEvent(new Event("resize"));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await act(async () => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1023 });
      window.dispatchEvent(new Event("resize"));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
  });

  it("clicking the mobile theme action never remounts the canvas or calls scaleFit/toCenter", async () => {
    await render();
    const mountsBefore = mountSpy.mock.calls.length;
    await openOverflowMenu();
    await act(async () => { themeMenuItem().click(); });

    expect(mountSpy.mock.calls.length).toBe(mountsBefore);
    expect(fakeMind.scaleFit).not.toHaveBeenCalled();
    expect(fakeMind.toCenter).not.toHaveBeenCalled();
  });
});
