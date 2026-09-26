// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import GuidedMindmapDialog from "./GuidedMindmapDialog";

const suggest = vi.fn();
vi.mock("../../utils/api", () => ({ suggestMindmapTopics: (...args) => suggest(...args) }));
vi.mock("../ui/Icon", () => ({ Icon: ({ name }) => <span data-icon={name} /> }));

// The dialog portals to document.body (fix: it must stay visible regardless
// of whether the launching sidebar subtree is hidden -- see GuidedMindmapDialog.jsx).
// So the mount container is just an anchor for the React root; assertions
// query document.body, and cleanup must unmount the root (removing the
// container alone would leave the portaled dialog behind).
let container;
let currentRoot;
afterEach(() => {
  if (currentRoot) act(() => currentRoot.unmount());
  if (container) container.remove();
  container = null; currentRoot = null; suggest.mockReset();
});

function render(props = {}) {
  container = document.createElement("div"); document.body.appendChild(container);
  currentRoot = createRoot(container);
  currentRoot.render(<GuidedMindmapDialog sources={["doc-1"]} onClose={() => {}} onSubmit={() => {}} {...props} />);
  return currentRoot;
}

describe("GuidedMindmapDialog", () => {
  it("loads backend suggestions and submits the guided contract", async () => {
    suggest.mockResolvedValue({ suggestions: [{ id: "topic-1", title: "Pipeline", rationale: "grounded" }] });
    const onSubmit = vi.fn();
    await act(async () => render({ onSubmit }));
    expect(suggest).toHaveBeenCalledWith(["doc-1"]);
    await act(async () => document.body.querySelector("textarea").dispatchEvent(new InputEvent("input", { bubbles: true })));
    await act(async () => document.body.querySelector('button[type="submit"]').click());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ sourceIds: ["doc-1"], preset: "overview", detailLevel: "balanced" }));
  });

  it("keeps the single CTA disabled without a selected source", async () => {
    await act(async () => render({ sources: [] }));
    expect(document.body.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(suggest).not.toHaveBeenCalled();
  });

  it("blocks submit while a selected source is not READY", async () => {
    suggest.mockResolvedValue({ suggestions: [] });
    const onSubmit = vi.fn();
    await act(async () => render({ sources: [{ id: "doc-1", status: "processing" }], onSubmit }));
    expect(document.body.querySelector('button[type="submit"]').disabled).toBe(true);
    await act(async () => document.body.querySelector('button[type="submit"]').click());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows retry when backend topic loading fails", async () => {
    const suggestTopics = vi.fn().mockRejectedValue(new Error("offline"));
    await act(async () => render({ suggestTopics }));
    expect(document.body.textContent).toContain("Không tải được gợi ý");
    expect(document.body.textContent).toContain("Thử lại");
  });

  it("shows the submit loading state without a second CTA", async () => {
    await act(async () => render({ loading: true }));
    expect(document.body.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    expect(document.body.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(document.body.textContent).toContain("Đang tạo");
  });

  it("prevents duplicate submissions from rapid double click", async () => {
    suggest.mockResolvedValue({ suggestions: [] });
    const onSubmit = vi.fn();
    await act(async () => render({ onSubmit }));
    await act(async () => {
      const button = document.body.querySelector('button[type="submit"]');
      button.click();
      button.click();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and restores focus to the opener", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    container = document.createElement("div"); document.body.appendChild(container);
    currentRoot = createRoot(container);
    await act(async () => currentRoot.render(<GuidedMindmapDialog sources={["doc-1"]} onClose={() => currentRoot.render(null)} onSubmit={() => {}} suggestTopics={vi.fn().mockResolvedValue({ suggestions: [] })} />));
    expect(document.activeElement).toBe(document.body.querySelector('[role="dialog"] button'));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  // Regression: the dialog used to render inline inside SidebarRight, so a
  // hidden ancestor (SidebarRight's own aside, hidden when its panel surface
  // isn't active -- e.g. the Mind Map tab header entry point) made the whole
  // dialog invisible (visibility:hidden) despite being mounted, focused, and
  // functional. Portalling to document.body makes visibility independent of
  // wherever GuidedMindmapDialog is rendered from.
  it("portals its content directly onto document.body, independent of the mount container's ancestors", async () => {
    const hiddenAncestor = document.createElement("div");
    hiddenAncestor.style.visibility = "hidden";
    document.body.appendChild(hiddenAncestor);
    container = document.createElement("div");
    hiddenAncestor.appendChild(container);
    currentRoot = createRoot(container);
    suggest.mockResolvedValue({ suggestions: [] });
    await act(async () => currentRoot.render(<GuidedMindmapDialog sources={["doc-1"]} onClose={() => {}} onSubmit={() => {}} />));
    const dialog = document.body.querySelector('[role="dialog"][aria-labelledby="guided-mindmap-title"]');
    expect(dialog).toBeTruthy();
    // The portal target is document.body itself, not the hidden container.
    expect(container.contains(dialog)).toBe(false);
    expect(hiddenAncestor.contains(dialog)).toBe(false);
    hiddenAncestor.remove();
  });
});
