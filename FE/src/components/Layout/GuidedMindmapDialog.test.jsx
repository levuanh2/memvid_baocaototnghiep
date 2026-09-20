// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import GuidedMindmapDialog from "./GuidedMindmapDialog";

const suggest = vi.fn();
vi.mock("../../utils/api", () => ({ suggestMindmapTopics: (...args) => suggest(...args) }));
vi.mock("../ui/Icon", () => ({ Icon: ({ name }) => <span data-icon={name} /> }));

let container;
afterEach(() => { if (container) document.body.removeChild(container); container = null; suggest.mockReset(); });

function render(props = {}) {
  container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  root.render(<GuidedMindmapDialog sources={["doc-1"]} onClose={() => {}} onSubmit={() => {}} {...props} />);
  return root;
}

describe("GuidedMindmapDialog", () => {
  it("loads backend suggestions and submits the guided contract", async () => {
    suggest.mockResolvedValue({ suggestions: [{ id: "topic-1", title: "Pipeline", rationale: "grounded" }] });
    const onSubmit = vi.fn();
    await act(async () => render({ onSubmit }));
    expect(suggest).toHaveBeenCalledWith(["doc-1"]);
    await act(async () => container.querySelector("textarea").dispatchEvent(new InputEvent("input", { bubbles: true })));
    await act(async () => container.querySelector('button[type="submit"]').click());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ sourceIds: ["doc-1"], preset: "overview", detailLevel: "balanced" }));
  });

  it("keeps the single CTA disabled without a selected source", async () => {
    await act(async () => render({ sources: [] }));
    expect(container.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(suggest).not.toHaveBeenCalled();
  });

  it("blocks submit while a selected source is not READY", async () => {
    suggest.mockResolvedValue({ suggestions: [] });
    const onSubmit = vi.fn();
    await act(async () => render({ sources: [{ id: "doc-1", status: "processing" }], onSubmit }));
    expect(container.querySelector('button[type="submit"]').disabled).toBe(true);
    await act(async () => container.querySelector('button[type="submit"]').click());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows retry when backend topic loading fails", async () => {
    const suggestTopics = vi.fn().mockRejectedValue(new Error("offline"));
    await act(async () => render({ suggestTopics }));
    expect(container.textContent).toContain("Không tải được gợi ý");
    expect(container.textContent).toContain("Thử lại");
  });

  it("shows the submit loading state without a second CTA", async () => {
    await act(async () => render({ loading: true }));
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    expect(container.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(container.textContent).toContain("Đang tạo");
  });

  it("closes on Escape and restores focus to the opener", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const root = createRoot(container = document.createElement("div"));
    document.body.appendChild(container);
    await act(async () => root.render(<GuidedMindmapDialog sources={["doc-1"]} onClose={() => root.render(null)} onSubmit={() => {}} suggestTopics={vi.fn().mockResolvedValue({ suggestions: [] })} />));
    expect(document.activeElement).toBe(container.querySelector("button"));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
