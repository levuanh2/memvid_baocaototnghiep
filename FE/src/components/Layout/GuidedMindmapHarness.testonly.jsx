// Test-only visual harness. This module is not imported by the production app.
import { useState } from "react";
import GuidedMindmapDialog from "./GuidedMindmapDialog";

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
  return <div data-harness="guided-mindmap" data-state={initialState} data-mobile={mobile} data-theme={dark ? "dark" : "light"} className={`${mobile ? "max-w-[390px] min-h-[844px]" : "max-w-[1440px] min-h-[1024px]"} ${dark ? "dark" : ""} bg-surface-page p-4`}>
    {open && <GuidedMindmapDialog sources={[{ id: "fixture-source", status: "ready" }]} onClose={() => setOpen(false)} onSubmit={() => {}} suggestTopics={state.provider} />}
  </div>;
}
