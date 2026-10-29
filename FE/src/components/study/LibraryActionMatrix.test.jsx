// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import LibraryTaskViews from "./LibraryTaskViews";
import StudyDocumentActionRow from "./StudyDocumentActionRow";
import { TASK_VIEW, deriveLearningState } from "../../utils/libraryActionMatrix";

let container;
let root;

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  document.body.innerHTML = "";
  root = null;
  container = null;
  vi.restoreAllMocks();
});

function render(element) {
  container = document.createElement("div");
  container.id = "root";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(element));
}

const rawDoc = {
  document_id: "doc-2",
  title: "Giáo trình Hệ điều hành",
  source_stem: "he-dieu-hanh",
  file_type: "pdf",
  reading_minutes: 12,
  last_opened_at: "2026-10-01T00:00:00Z",
  last_workspace: "review",
  ai: {
    index: "ready",
    summary: { state: "not_generated" },
    quiz: { ready: false },
    review: { latest_attempt_id: "attempt-1" },
  },
};

describe("LibraryTaskViews", () => {
  it("renders the four task intents with projection-derived counts", () => {
    const onChange = vi.fn();
    render(<LibraryTaskViews value={TASK_VIEW.ALL} counts={{ all: 42, continue: 1, needs_quiz: 35, needs_summary: 36 }} onChange={onChange} />);
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons).toHaveLength(4);
    expect(container.textContent).toContain("42");
    expect(container.textContent).toContain("36");
    act(() => buttons[3].click());
    expect(onChange).toHaveBeenCalledWith(TASK_VIEW.NEEDS_SUMMARY);
  });
});

describe("StudyDocumentActionRow", () => {
  it("keeps the row unfocusable and exposes one primary, two quick actions and one complete-tool trigger", () => {
    const onOpen = vi.fn();
    render(<StudyDocumentActionRow doc={deriveLearningState(rawDoc)} view={TASK_VIEW.NEEDS_SUMMARY} onOpen={onOpen} primaryTabIndex={0} />);
    const row = container.querySelector("[data-document-row]");
    expect(row.hasAttribute("tabindex")).toBe(false);
    expect(container.querySelectorAll("[data-primary-action]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-quick-action]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-tools-trigger]")).toHaveLength(1);
    expect(container.querySelector("[data-primary-action]").textContent).toContain("Tạo tóm tắt");
    act(() => container.querySelector("[data-primary-action]").click());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ document_id: "doc-2" }), "summary");
  });

  it("opens the complete desktop tool menu and routes every action through the same callback", () => {
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const onOpen = vi.fn();
    render(<StudyDocumentActionRow doc={deriveLearningState(rawDoc)} view={TASK_VIEW.ALL} onOpen={onOpen} primaryTabIndex={0} />);
    act(() => container.querySelector("[data-tools-trigger]").click());
    const menu = container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menu.querySelectorAll('[data-learning-tool]')).toHaveLength(7);
    expect(menu.querySelector('[data-surface="mindmap"]')).not.toBeNull();
    expect(menu.querySelector('[data-surface="studymap"]')).not.toBeNull();
    expect(menu.querySelectorAll('[data-management-action]')).toHaveLength(4);
    act(() => menu.querySelector('[data-surface="chat"]').click());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ document_id: "doc-2" }), "chat");
  });

  it("closes the desktop menu with Escape and restores focus to its trigger", () => {
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    render(<StudyDocumentActionRow doc={deriveLearningState(rawDoc)} view={TASK_VIEW.ALL} onOpen={() => {}} primaryTabIndex={0} />);
    const trigger = container.querySelector("[data-tools-trigger]");
    act(() => trigger.click());
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("does not collapse unknown progress into missing work", () => {
    const unknown = deriveLearningState({ ...rawDoc, ai: { index: "processing" } });
    render(<StudyDocumentActionRow doc={unknown} view={TASK_VIEW.ALL} onOpen={() => {}} primaryTabIndex={0} />);
    expect(container.textContent).toContain("Trạng thái tóm tắt chưa xác định");
    expect(container.textContent).toContain("Quiz đang xử lý hoặc chưa xác định");
    expect(container.textContent).not.toContain("Chưa có tóm tắt");
  });

  it("uses a portalled modal sheet on mobile and restores trigger focus after Escape", () => {
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    render(<StudyDocumentActionRow doc={deriveLearningState(rawDoc)} view={TASK_VIEW.ALL} onOpen={() => {}} primaryTabIndex={0} />);
    const trigger = container.querySelector("[data-tools-trigger]");
    trigger.focus();
    act(() => trigger.click());
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.hasAttribute("inert")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(container.hasAttribute("inert")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(trigger);
  });

  it("routes a mobile backdrop click only to close, never to a row action", () => {
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const onOpen = vi.fn();
    render(<StudyDocumentActionRow doc={deriveLearningState(rawDoc)} view={TASK_VIEW.ALL} onOpen={onOpen} primaryTabIndex={0} />);
    act(() => container.querySelector("[data-tools-trigger]").click());
    const dialog = document.body.querySelector('[role="dialog"]');
    act(() => dialog.firstElementChild.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
