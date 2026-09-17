// @vitest-environment jsdom
//
// Regression for round 10 (mockup parity): the approved reference image's
// node panel ends with a full-width primary "Hỏi về nhánh này →" CTA — this
// didn't exist anywhere in the codebase before this round (confirmed via a
// project-wide text search). Added reusing the SAME `onAskAI` pipeline every
// other Learning Action here already calls (no new AI endpoint, no new
// state) — this proves it's wired to that same prop with a sensible prompt,
// not that `onAskAI` itself works (that's pre-existing, unit-tested
// elsewhere as part of the chat pipeline).
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import KnowledgeInspector from "./KnowledgeInspector";

const NODE = { id: "n1", title: "Truy hồi có dẫn chứng", note: "", chunkRefs: [], number: "", level: 0, enrichment: [] };

let container;

afterEach(() => {
  if (container) {
    document.body.removeChild(container);
    container = null;
  }
  vi.restoreAllMocks();
});

describe("KnowledgeInspector 'Hỏi về nhánh này' CTA (round 10)", () => {
  it("renders as a full-width primary button ahead of the Learning Actions grid, and calls onAskAI with the node's title", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAskAI = vi.fn();

    await act(async () => {
      root.render(
        <KnowledgeInspector
          node={NODE} relations={{ parent: null, children: [], prev: null, next: null, siblings: [] }} breadcrumb={[]} documentTitle="Doc" sources={[]} generating={false}
          onNavigate={() => {}} onAskAI={onAskAI} onOpenSource={() => {}}
          nav={{ canBack: false, canForward: false, onBack: () => {}, onForward: () => {}, recent: [], pinned: [], isPinned: false, onTogglePin: () => {} }}
        />
      );
    });

    const cta = Array.from(container.querySelectorAll("button")).find((b) => b.textContent.includes("Hỏi về nhánh này"));
    expect(cta).toBeTruthy();
    expect(cta.className).toMatch(/btn-primary/);
    expect(cta.className).toMatch(/w-full/);

    // Must appear BEFORE "Hành động học tập" in DOM order (footer layout).
    const actionsLabel = Array.from(container.querySelectorAll("div")).find((d) => d.textContent === "Hành động học tập");
    expect(actionsLabel).toBeTruthy();
    expect(cta.compareDocumentPosition(actionsLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await act(async () => { cta.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(onAskAI).toHaveBeenCalledTimes(1);
    expect(onAskAI.mock.calls[0][0]).toContain("Truy hồi có dẫn chứng");
  });
});
