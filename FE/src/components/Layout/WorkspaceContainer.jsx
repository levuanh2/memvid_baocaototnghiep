// Workspace architecture (approved audit) — the central region that used to be
// bare `<ChatArea/>` now switches between Chat / MindMap / Summary. All three
// panes that have EVER had data stay mounted (toggled via CSS `hidden`, not
// conditional JSX) so:
//   - switching tabs never remounts ChatArea (streaming/history intact),
//   - switching tabs never re-inits mind-elixir or re-fetches the summary,
//   - the mindmap canvas is never recreated by a mode switch (only by a real
//     document/mindmap change — MindElixirView's own effect keys on `data?.id`).
// MindMap/Summary only mount the FIRST time they have data (no point paying
// mind-elixir's init cost before anything's been generated) — once mounted,
// they never unmount for the lifetime of this WorkspaceContainer instance.
import ChatArea from "./ChatArea";
import MindElixirView from "../mindmap/MindElixirView";
import SummaryPane from "./SummaryPane";
import WorkspaceTabs from "./WorkspaceTabs";

const paneClass = (active) => (active ? "flex-1 min-h-0" : "hidden");

export default function WorkspaceContainer({
  mode, onModeChange,
  chatProps, mindmapData, summaryData, controller,
}) {
  const hasMindmap = Boolean(mindmapData?.data);
  const hasSummary = Boolean(summaryData);

  return (
    <div className="flex flex-1 flex-col min-w-0 min-h-0">
      <WorkspaceTabs mode={mode} onChange={onModeChange} hasMindmap={hasMindmap} hasSummary={hasSummary} />

      <div className={paneClass(mode === "chat")}>
        <ChatArea {...chatProps} />
      </div>

      {hasMindmap && (
        <div className={paneClass(mode === "mindmap")}>
          <MindElixirView
            data={mindmapData.data}
            onRegenerate={mindmapData.onRegenerate}
            regenerating={mindmapData.regenerating}
            controller={controller}
          />
        </div>
      )}

      {hasSummary && (
        <div className={paneClass(mode === "summary")}>
          <SummaryPane data={summaryData} />
        </div>
      )}
    </div>
  );
}
