// @vitest-environment jsdom
// V9.3 P4b (owner brief C; docs/StudyMap-V9.3/06): explicit "Nguồn" and "Dẫn chứng" controls
// that say whether their panel is open (aria-expanded) and which panel they drive
// (aria-controls); a labelled "Chế độ học" select for narrow screens; evidence starts closed
// only when there is no saved layout; Focus Mode, saved layout, drafts and mounted subtrees
// stay intact, and no control sends a request.
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

const spies = vi.hoisted(() => ({ workspace: vi.fn(), inspector: vi.fn(), apiFetch: vi.fn(), mode: null }));

vi.mock("react-router-dom", () => ({
  Link: ({ children, to, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("../../auth/useAuth", () => ({ useAuth: () => ({ user: null, logout: vi.fn() }) }));
vi.mock("../../utils/api", async (original) => ({
  ...(await original()),
  apiFetch: (...args) => { spies.apiFetch(...args); return new Promise(() => {}); },
}));
vi.mock("./SidebarRight", () => ({
  default: function InspectorStub() { useEffect(() => { spies.inspector(); }, []); return <div data-testid="inspector" />; },
}));
vi.mock("../study/ResearchTimeline", () => ({ default: () => null }));
vi.mock("./AccountMenu", () => ({ default: () => null }));
vi.mock("../ui/Toaster", () => ({ default: () => null }));
vi.mock("../shortcuts/ShortcutsOverlay", () => ({ default: () => null }));
vi.mock("./SidebarLeft", () => ({ default: () => <button type="button" data-testid="sources">sources</button> }));
vi.mock("./WorkspaceContainer", () => ({
  default: function WorkspaceStub({ mode }) {
    spies.mode = mode;
    useEffect(() => { spies.workspace(); }, []);
    return <textarea data-testid="composer" defaultValue="" />;
  },
}));

let container, root;
const STORE = "memvidx.panels.v1";

async function renderLayout(width, storedCollapsed) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  window.localStorage.clear();
  if (storedCollapsed) {
    window.localStorage.setItem(STORE, JSON.stringify({ width: { left: 252, right: 360 }, collapsed: storedCollapsed }));
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<StudyContextProvider><MainLayout selectedSources={["a"]} setSelectedSources={() => {}} /></StudyContextProvider>);
  });
  await act(async () => { await Promise.resolve(); });
}

afterEach(() => {
  if (root) { act(() => { root.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  window.localStorage.clear();
  vi.clearAllMocks();
});

const sourcesButton = () => container.querySelector("button[data-panel-toggle='sources']");
const evidenceButton = () => container.querySelector("button[data-panel-toggle='evidence']");
const focusButton = () => container.querySelector("button[data-focus-toggle]");
const click = async (el) => { await act(async () => { el.click(); }); };
const controlled = (button) => document.getElementById(button.getAttribute("aria-controls"));
const saved = () => JSON.parse(window.localStorage.getItem(STORE) || "null");
const rightAside = () => container.querySelector("[data-testid='inspector']").closest("aside");
const leftAside = () => container.querySelector("[data-testid='sources']")?.closest("aside") ?? null;

describe("Nguồn / Dẫn chứng controls", () => {
  it("are named buttons that report their panel's state and point at it", async () => {
    await renderLayout(1440);
    for (const [button, name] of [[sourcesButton(), "Nguồn"], [evidenceButton(), "Dẫn chứng"]]) {
      expect(button, name).not.toBeNull();
      expect(button.getAttribute("type")).toBe("button");
      expect(button.textContent).toContain(name);
      expect(["true", "false"]).toContain(button.getAttribute("aria-expanded"));
    }
    expect(controlled(sourcesButton())).toBe(leftAside());
    expect(controlled(evidenceButton())).toBe(rightAside());
  });

  it("start with evidence closed and sources open when nothing is saved", async () => {
    await renderLayout(1440);
    expect(sourcesButton().getAttribute("aria-expanded")).toBe("true");
    expect(evidenceButton().getAttribute("aria-expanded")).toBe("false");
    expect(rightAside().getAttribute("aria-hidden")).toBe("true");
  });

  it("keep a saved layout that has evidence open", async () => {
    await renderLayout(1440, { left: true, right: false });
    expect(evidenceButton().getAttribute("aria-expanded")).toBe("true");
    expect(rightAside().getAttribute("aria-hidden")).toBeNull();
    expect(sourcesButton().getAttribute("aria-expanded")).toBe("false");
  });

  it("toggle and save each column on desktop", async () => {
    await renderLayout(1440, { left: false, right: true });
    await click(evidenceButton());
    expect(evidenceButton().getAttribute("aria-expanded")).toBe("true");
    expect(rightAside().getAttribute("aria-hidden")).toBeNull();
    expect(saved().collapsed.right).toBe(false);
    await click(sourcesButton());
    expect(sourcesButton().getAttribute("aria-expanded")).toBe("false");
    expect(leftAside()).toBeNull();
    expect(saved().collapsed.left).toBe(true);
    await click(sourcesButton());
    expect(sourcesButton().getAttribute("aria-expanded")).toBe("true");
    expect(saved().collapsed.left).toBe(false);
  });

  it("on phones open one drawer at a time", async () => {
    await renderLayout(390);
    await click(sourcesButton());
    expect(sourcesButton().getAttribute("aria-expanded")).toBe("true");
    await click(evidenceButton());
    expect(evidenceButton().getAttribute("aria-expanded")).toBe("true");
    expect(sourcesButton().getAttribute("aria-expanded")).toBe("false");
    expect(leftAside().getAttribute("aria-hidden")).toBe("true");
    await click(evidenceButton());
    expect(evidenceButton().getAttribute("aria-expanded")).toBe("false");
    expect(rightAside().getAttribute("aria-hidden")).toBe("true");
  });

  it("in Focus Mode show evidence without saving it; Nguồn is hidden with the source panel", async () => {
    await renderLayout(1440, { left: false, right: true });
    const stored = window.localStorage.getItem(STORE);
    await click(focusButton());
    expect(Boolean(sourcesButton().closest(".focus-hide"))).toBe(true);
    expect(Boolean(evidenceButton().closest(".focus-hide"))).toBe(false);
    await click(evidenceButton());
    expect(evidenceButton().getAttribute("aria-expanded")).toBe("true");
    expect(rightAside().getAttribute("aria-hidden")).toBeNull();
    expect(window.localStorage.getItem(STORE)).toBe(stored);
    await click(focusButton());
    expect(evidenceButton().getAttribute("aria-expanded")).toBe("false");
    expect(window.localStorage.getItem(STORE)).toBe(stored);
  });

  it("keep the composer, its draft and both panels mounted, and send nothing", async () => {
    await renderLayout(1440);
    const composer = container.querySelector("[data-testid='composer']");
    composer.value = "Nửa câu hỏi về cung cầu";
    const calls = spies.apiFetch.mock.calls.length;
    for (const b of [evidenceButton, sourcesButton, evidenceButton, sourcesButton]) await click(b());
    expect(container.querySelector("[data-testid='composer']")).toBe(composer);
    expect(composer.value).toBe("Nửa câu hỏi về cung cầu");
    expect(spies.workspace).toHaveBeenCalledTimes(1);
    expect(spies.inspector).toHaveBeenCalledTimes(1);
    // Collapsing the source panel while the stubbed library is still "loading" makes the existing
    // one-off /list-indexed probe (MainLayout, leftPanelUnmounted); nothing else, and never a question.
    const added = spies.apiFetch.mock.calls.slice(calls).map(([path]) => String(path));
    expect(added.filter((p) => p !== "/list-indexed")).toEqual([]);
  });
});

describe("Phone tools menu (no room for the header buttons at <=480px)", () => {
  const openMenu = async () => { await click(container.querySelector("button[aria-label='Mở công cụ học']")); };
  const item = (name) => [...container.querySelectorAll("[role='menuitemcheckbox']")].find((el) => el.textContent.trim() === name);

  it("offers Nguồn and Dẫn chứng as checkable items that report and toggle their panel", async () => {
    await renderLayout(390);
    await openMenu();
    expect(item("Nguồn").getAttribute("aria-checked")).toBe("false");
    expect(item("Dẫn chứng").getAttribute("aria-checked")).toBe("false");
    await click(item("Nguồn"));
    expect(sourcesButton().getAttribute("aria-expanded")).toBe("true");
    await openMenu();
    expect(item("Nguồn").getAttribute("aria-checked")).toBe("true");
    await click(item("Dẫn chứng"));
    expect(evidenceButton().getAttribute("aria-expanded")).toBe("true");
    expect(sourcesButton().getAttribute("aria-expanded")).toBe("false");
    await openMenu();
    expect(item("Dẫn chứng").getAttribute("aria-checked")).toBe("true");
    await click(item("Dẫn chứng"));
    expect(evidenceButton().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Chế độ học select", () => {
  it("is a labelled select with every mode, in step with the tabs", async () => {
    await renderLayout(390);
    const select = container.querySelector("select[data-mode-select]");
    expect(select).not.toBeNull();
    expect(select.labels[0].textContent).toBe("Chế độ học");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Trò chuyện", "Sơ đồ tư duy", "Tóm tắt"]);
    expect(select.value).toBe("chat");
    const calls = spies.apiFetch.mock.calls.length;
    await act(async () => {
      select.value = "summary";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(spies.mode).toBe("summary");
    expect(container.querySelector("[role='tab'][aria-selected='true']").getAttribute("aria-label")).toBe("Tóm tắt");
    expect(spies.workspace).toHaveBeenCalledTimes(1);
    expect(spies.apiFetch.mock.calls.length).toBe(calls);
  });

  it("stays usable in Focus Mode", async () => {
    await renderLayout(390);
    await click(focusButton());
    expect(Boolean(container.querySelector("select[data-mode-select]").closest(".focus-hide"))).toBe(false);
  });
});
