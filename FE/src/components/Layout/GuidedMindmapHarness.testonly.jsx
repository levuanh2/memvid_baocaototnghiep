// Test-only visual harness. This module is not imported by the production app.
import { useState } from "react";
import GuidedMindmapDialog from "./GuidedMindmapDialog";
import SidebarRight from "./SidebarRight";
import { StudyContextProvider } from "../../study/StudyContextProvider";

const FIXTURE_TOPICS = [
  { id: "fixture-process", title: "Triển khai", rationale: "Fixture evidence", evidence_count: 3 },
  { id: "fixture-architecture", title: "Kiến trúc", rationale: "Fixture evidence", evidence_count: 2 },
];

export default function GuidedMindmapHarness({ initialState = "ready", mobile = false, dark = false }) {
  const [open, setOpen] = useState(true);
  const states = {
    ready: { provider: async () => ({ suggestions: FIXTURE_TOPICS }) },
    empty: { provider: async () => ({ suggestions: [] }) },
    error: { provider: async () => { throw new Error("fixture error"); } },
    loading: { provider: () => new Promise(() => {}) },
  };
  const state = states[initialState] || states.ready;
  const inspectorContext = { node: { id: "node-process", title: "Quy trình triển khai", note: "Các bước triển khai được đối chiếu từ tài liệu nguồn.", chunkRefs: ["chunk-1"] }, relations: { parent: null, children: [], prev: null, next: null, siblings: [] }, breadcrumb: [], documentTitle: "Triển khai hệ thống", sources: ["fixture-source"], generating: false, mapMeta: { nodeCount: 8 }, backendContext: { node_id: "node-process", topic: "Quy trình triển khai", explanation: "Các bước triển khai được đối chiếu từ tài liệu nguồn.", citations: [{ source_id: "fixture-source", source_name: "Tài liệu fixture", chunk_id: "chunk-1", excerpt: "Bằng chứng quy trình triển khai." }], relations: [{ target_node_id: "node-release", type: "sequence", label: "tiếp theo" }], missing: [], degraded: false }, nav: { canBack: false, canForward: false, onBack: () => {}, onForward: () => {}, recent: [], pinned: [], isPinned: false, onTogglePin: () => {} }, onNavigate: () => {}, onAskAI: () => {}, onOpenSource: () => {} };
  return <div data-harness="guided-mindmap" data-state={initialState} data-mobile={mobile} data-theme={dark ? "dark" : "light"} className={`${mobile ? "max-w-[390px] min-h-[844px]" : "max-w-[1440px] min-h-[1024px]"} ${dark ? "dark" : ""} bg-surface-page p-4`}>
    {initialState === "workspace" ? (
      <StudyContextProvider><div className="context-inspector-shell w-[340px] h-[900px] ml-auto"><SidebarRight selectedSources={[{ id: "fixture-source", status: "ready" }]} mode="mindmap" mindMapContext={inspectorContext} evidence={null} onHighlight={() => {}} onClose={() => {}} onAskAbout={() => {}} onOpenSource={() => {}} onMindmapDataChange={() => {}} onSummaryDataChange={() => {}} onMindmapLibraryChange={() => {}} onSummaryLibraryChange={() => {}} /></div></StudyContextProvider>
    ) : open && <GuidedMindmapDialog sources={[{ id: "fixture-source", status: "ready" }]} onClose={() => setOpen(false)} onSubmit={() => {}} suggestTopics={state.provider} />}
  </div>;
}
