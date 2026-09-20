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
});
