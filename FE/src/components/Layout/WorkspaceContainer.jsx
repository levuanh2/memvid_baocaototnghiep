// Workspace architecture (approved audit) — the central region that used to be
// bare `<ChatArea/>` now switches between Chat / MindMap / Summary. All three
// panes that have EVER had data stay mounted (toggled via CSS `hidden`, not
// conditional JSX) so:
//   - switching tabs never remounts ChatArea (streaming/history intact),
//   - switching tabs never re-inits mind-elixir or re-fetches the summary,
//   - the mindmap canvas is never recreated by a mode switch (only by a real
//     document/mindmap change — MindElixirView's own effect keys on `data?.id`).
// MindMap/Summary only mount the real MindElixirView/SummaryPane the FIRST
// time they have data — before that, the mode switch is still fully
// reachable (IA pass, round 5: no more disabled tabs) and shows
// WorkspaceEmptyState with one contextual "Create" CTA instead.
import ChatArea from "./ChatArea";
import MindElixirView from "../mindmap/MindElixirView";
import SummaryPane from "./SummaryPane";
import LessonHeader from "./LessonHeader";
import WorkspaceEmptyState from "./WorkspaceEmptyState";
import { computeReadyCount } from "../../utils/workspaceReadiness";

const paneClass = (active) => (active ? "flex-1 min-h-0" : "hidden");

export default function WorkspaceContainer({
  mode, onModeChange,
  chatProps, mindmapData, summaryData, controller,
  lessonTitle, onMindmapAction, onSummaryAction,
}) {
  const hasMindmap = Boolean(mindmapData?.data);
  const hasSummary = Boolean(summaryData);
  const selectedSources = chatProps?.selectedSources || [];
  const sources = chatProps?.sources || [];
  const readyCount = computeReadyCount(sources, selectedSources);

  return (
    <div className="flex flex-1 flex-col min-w-0 min-h-0">
      <LessonHeader
        title={lessonTitle}
        selectedCount={selectedSources.length}
        readyCount={readyCount}
        mode={mode}
        onModeChange={onModeChange}
      />

      <div className={paneClass(mode === "chat")}>
        <ChatArea {...chatProps} />
      </div>

      <div className={paneClass(mode === "mindmap")}>
        {hasMindmap ? (
          <MindElixirView
            data={mindmapData.data}
            onRegenerate={mindmapData.onRegenerate}
            regenerating={mindmapData.regenerating}
            controller={controller}
          />
        ) : (
          <WorkspaceEmptyState kind="mindmap" selectedCount={selectedSources.length} onCreate={onMindmapAction} />
        )}
      </div>

      <div className={paneClass(mode === "summary")}>
        {hasSummary ? (
          <SummaryPane data={summaryData} />
        ) : (
          <WorkspaceEmptyState kind="summary" selectedCount={selectedSources.length} onCreate={onSummaryAction} />
        )}
      </div>
    </div>
  );
}
