// @vitest-environment jsdom
// W3-4 (owner decision O4): the right panel's own tab row is back (Bằng
// chứng / Gia sư AI / Dòng thời gian / Kiến thức), driving the SAME
// `rightView` prop the header's "Công cụ học" menu already drives (no
// second state -- SidebarRight is a controlled component here, so this
// file asserts `onRightViewChange` calls and re-renders with the new value
// the way the real parent, MainLayout's `setRightView`, would). The legacy
// artifact block stays off (SidebarRight.legacyInspectorFlag.test.jsx).
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SidebarRight from "./SidebarRight";
import { StudyContextProvider } from "../../study/StudyContextProvider";

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(async (path) => {
    if (path === "/mindmaps") return { ok: true, json: async () => ({ mindmaps: [] }) };
    if (path === "/summaries") return { ok: true, json: async () => ({ summaries: [] }) };
    return { ok: true, json: async () => ({}) };
  }),
  generateMindmap: vi.fn(), suggestMindmapTopics: vi.fn(async () => ({ suggestions: [] })),
  cancelMindmap: vi.fn(), generateSummary: vi.fn(), cancelSummary: vi.fn(),
  getMindmapCapability: vi.fn(async () => ({ guided_mindmap_v3: false })),
  isUnauthorizedError: vi.fn(() => false), isNotFoundOrForbiddenError: vi.fn(() => false),
  getUserFriendlyApiError: vi.fn((e) => String(e)),
}));
vi.mock("../ui/Toaster", () => ({ toast: vi.fn() }));
// This file's concern is the tab row/header title/legacy-block gating, not
// these panes' own internals (each has its own test coverage) -- stubbed
// out so a `rightView`/`mode` combination that mounts them doesn't also
// need a Router (TutorPanel's `Link`) or a full `mindMapContext` shape
// (KnowledgeInspector).
vi.mock("../study/TutorPanel", () => ({ default: () => <div data-testid="tutor-panel-stub" /> }));
vi.mock("../study/ResearchTimeline", () => ({ default: () => <div data-testid="research-timeline-stub" /> }));
vi.mock("../study/KnowledgeDashboard", () => ({ default: () => <div data-testid="knowledge-dashboard-stub" /> }));
vi.mock("../mindmap/KnowledgeInspector", () => ({ default: () => <div data-testid="knowledge-inspector-stub" /> }));

const noop = () => {};
let container, root;
afterEach(() => {
  if (root) { act(() => root.unmount()); root = null; }
  if (container) { document.body.removeChild(container); container = null; }
  localStorage.clear();
});

const flush = () => act(async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); });
async function render(props) {
  if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
  await act(async () => {
    root.render(
      <StudyContextProvider>
        <SidebarRight evidence={null} onMindmapDataChange={noop} onSummaryDataChange={noop} onSwitchToChat={noop} {...props} />
      </StudyContextProvider>,
    );
  });
  await flush();
}

const tablist = () => container.querySelector('[role="tablist"]');
const tabs = () => [...container.querySelectorAll('[role="tab"]')];
const title = () => container.querySelector(".study-surface-header strong")?.textContent;

describe("SidebarRight — right panel tab row (W3-4)", () => {
  it("renders four proper ARIA tabs with the current view selected, no aria-hidden", async () => {
    await render({ mode: "chat", rightView: "evidence" });
    expect(tablist()).toBeTruthy();
    expect(tablist().getAttribute("aria-hidden")).toBeNull();
    const t = tabs();
    // Icon-only (panel.width.right, 320-480px, can't fit four full labels
    // at any width -- see SidebarRight.jsx's own comment) -- the label is
    // still discoverable via aria-label/title, not visible text.
    expect(t.map((b) => b.getAttribute("aria-label"))).toEqual(["Bằng chứng", "Gia sư AI", "Dòng thời gian", "Kiến thức"]);
    expect(t[0].getAttribute("aria-selected")).toBe("true");
    expect(t.slice(1).every((b) => b.getAttribute("aria-selected") === "false")).toBe(true);
    // Roving tabindex: only the selected tab is in the normal tab order.
    expect(t[0].tabIndex).toBe(0);
    expect(t.slice(1).every((b) => b.tabIndex === -1)).toBe(true);
  });

  it("clicking a tab calls onRightViewChange with that tab's key", async () => {
    const onRightViewChange = vi.fn();
    await render({ mode: "chat", rightView: "evidence", onRightViewChange });
    const tutorTab = tabs().find((b) => b.getAttribute("aria-label") === "Gia sư AI");
    await act(async () => { tutorTab.click(); });
    expect(onRightViewChange).toHaveBeenCalledTimes(1);
    expect(onRightViewChange).toHaveBeenCalledWith("tutor");
  });

  it("ArrowRight/ArrowLeft move through the tabs (wrapping), Home/End jump to the ends", async () => {
    const onRightViewChange = vi.fn();
    await render({ mode: "chat", rightView: "evidence", onRightViewChange });
    const list = tablist();
    await act(async () => { list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(onRightViewChange).toHaveBeenLastCalledWith("tutor");

    onRightViewChange.mockClear();
    await render({ mode: "chat", rightView: "evidence", onRightViewChange });
    await act(async () => { tablist().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
    expect(onRightViewChange).toHaveBeenLastCalledWith("insights"); // wraps to the last tab

    onRightViewChange.mockClear();
    await render({ mode: "chat", rightView: "tutor", onRightViewChange });
    await act(async () => { tablist().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })); });
    expect(onRightViewChange).toHaveBeenLastCalledWith("insights");
  });

  it("the header title follows rightView (not stuck on 'Bằng chứng câu trả lời')", async () => {
    await render({ mode: "chat", rightView: "evidence" });
    expect(title()).toBe("Bằng chứng câu trả lời");

    await render({ mode: "chat", rightView: "tutor" });
    expect(title()).toBe("Gia sư AI");

    await render({ mode: "chat", rightView: "timeline" });
    expect(title()).toBe("Dòng thời gian");

    await render({ mode: "chat", rightView: "insights" });
    expect(title()).toBe("Kiến thức");
  });

  it("mindmap/summary modes keep their own fixed title and show no tab row (rightView never changes their content)", async () => {
    await render({ mode: "mindmap", rightView: "tutor", mindMapContext: {} });
    expect(title()).toBe("Chi tiết sơ đồ");
    expect(tablist()).toBeNull();

    await render({ mode: "summary", rightView: "tutor" });
    expect(title()).toBe("Nguồn bản tóm tắt");
    expect(tablist()).toBeNull();
  });

  it("the legacy artifact block ('Tạo từ tài liệu') still never renders", async () => {
    await render({ mode: "chat", rightView: "evidence" });
    expect(container.textContent).not.toContain("Tạo từ tài liệu");
  });
});
