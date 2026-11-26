// @vitest-environment jsdom
// Claude review of P5a: "Đọc đoạn này trong nguồn" sent mind-map citations as kind "studymap"
// (matched on the chunk UUID), but their chunk_id is a global FAISS id (BE mindmap/context.py),
// so the Reader reported every one as stale. They must be sent as kind "index".
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import KnowledgeInspector from "./KnowledgeInspector";

const NODE = { id: "n1", title: "Cung cầu", note: "", chunkRefs: ["42"], sourceStems: ["kinh_te"], number: "", level: 0, enrichment: [] };
let container;
afterEach(() => { if (container) { container.remove(); container = null; } vi.restoreAllMocks(); });

describe("KnowledgeInspector reader citation", () => {
  it("opens the Reader with the FAISS id as an index citation", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onOpenSource = vi.fn();
    await act(async () => {
      root.render(
        <KnowledgeInspector
          node={NODE} relations={{ parent: null, children: [], prev: null, next: null, siblings: [] }} breadcrumb={[]}
          documentTitle="Doc" sources={["kinh_te"]} generating={false}
          backendContext={{ citations: [{ chunk_id: "42", excerpt: "Cung và cầu quyết định giá.", source_id: "kinh_te" }] }}
          onNavigate={() => {}} onAskAI={() => {}} onOpenSource={onOpenSource}
          nav={{ canBack: false, canForward: false, onBack: () => {}, onForward: () => {}, recent: [], pinned: [], isPinned: false, onTogglePin: () => {} }}
        />
      );
    });
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Đọc đoạn này trong nguồn"));
    expect(button).toBeTruthy();
    await act(async () => { button.click(); });
    expect(onOpenSource).toHaveBeenCalledWith("kinh_te", expect.objectContaining({ kind: "index", id: "42" }));
    act(() => root.unmount());
  });
});
