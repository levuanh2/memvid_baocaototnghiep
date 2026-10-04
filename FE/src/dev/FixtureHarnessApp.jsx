// Export Studio fixture harness app (Round 2, section 2) — DEV-ONLY, never
// imported by the shipped app. Renders MindElixirView directly against a
// deterministic local fixture, with NO backend/API call and NO auth:
// `data`/`controller` are built entirely in this file, matching exactly
// what MindElixirView.jsx itself reads from them
// (registerMindInstance/onNodeSelected/selected/sidecarRef — grepped
// directly from the component, not guessed) and nothing else.
//
// This exists because the prior round's attempt to fixture-QA against the
// real production API hit a CORS/connectivity wall from a local dev
// origin — a deterministic, backend-free harness sidesteps that
// entirely, per this round's explicit requirement.
//
// Split out of fixtureHarness.jsx (which just mounts this) to mirror
// main.jsx/App.jsx's own split — a root entry file with no component
// definitions of its own keeps Vite's react-refresh plugin happy.
import { useCallback, useMemo, useRef, useState } from "react";
import MindElixirView from "../components/mindmap/MindElixirView";
import { FIXTURE_MAP_A, FIXTURE_MAP_B, FIXTURE_COLLAPSED_NODE_IDS } from "./mindmapFixtures";

const MAPS = [FIXTURE_MAP_A, FIXTURE_MAP_B];

function useFixtureController() {
  const mindRef = useRef(null);
  const sidecarRef = useRef(new Map());
  const [selected, setSelected] = useState(null);

  const registerMindInstance = useCallback((mind, sidecar) => {
    mindRef.current = mind;
    sidecarRef.current = sidecar;
    // Collapse the fixture's designated branches once, right after this
    // specific mind-elixir instance/sidecar pair is (re)registered (covers
    // both first mount and a later map switch/refresh) -- matches the
    // "collapsed and expanded branches" fixture requirement without
    // needing the record format to carry an `expanded` field (it can't --
    // confirmed in mindElixirAdapter.js, which never sets one). Root node
    // id is always `${mapId}-root` (see mindmapFixtures.js's buildMap).
    const rootId = mind?.nodeData?.id || "";
    const mapId = rootId.endsWith("-root") ? rootId.slice(0, -"-root".length) : rootId;
    // Collapse deepest ids first: fixture ids are hierarchical prefix
    // chains (e.g. "...m2-s0" is a child of "...m2"), so sorting by id
    // length descending collapses children before their ancestors.
    // Collapsing a parent first removes its children from the DOM,
    // making a later findEle() for a child throw ("maybe it's collapsed")
    // instead of finding a real element.
    const ids = [...(FIXTURE_COLLAPSED_NODE_IDS[mapId] || [])].sort((a, b) => b.length - a.length);
    ids.forEach((id) => {
      const topic = mind.findEle?.(id);
      if (topic) mind.expandNode(topic, false);
    });
  }, []);

  const onNodeSelected = useCallback((nodes) => {
    const n = nodes?.[0];
    if (!n) return;
    const side = sidecarRef.current.get(n.id);
    setSelected({ id: n.id, title: n.topic, note: side?.note || "", chunkRefs: side?.chunkRefs || [] });
  }, []);

  const clearSelectedNode = useCallback(() => setSelected(null), []);

  return { registerMindInstance, onNodeSelected, clearSelectedNode, selected, sidecarRef };
}

export default function FixtureHarnessApp() {
  const controller = useFixtureController();
  const [activeMapId, setActiveMapId] = useState(FIXTURE_MAP_A.id);
  const [saveLog, setSaveLog] = useState([]);

  const activeRecord = useMemo(() => MAPS.find((m) => m.id === activeMapId), [activeMapId]);

  const data = useMemo(() => ({
    ...activeRecord,
    mindMaps: MAPS.map((m) => ({ id: m.id, title: m.title, sources: [] })),
    onSelectMap: (m) => setActiveMapId(m.id),
    onCreateNew: () => {},
    // No backend PUT -- record the attempt locally so a test can assert
    // "Save" was clicked without this harness making any network call.
    onSaved: () => setSaveLog((l) => [...l, { at: Date.now(), mapId: activeMapId }]),
    onDirtyChange: () => {},
  }), [activeRecord, activeMapId]);

  return (
    <div style={{ height: "100vh", width: "100vw" }} data-testid="fixture-harness-root"
      data-selected-node={controller.selected?.id || ""} data-save-log={JSON.stringify(saveLog)}>
      <MindElixirView data={data} onRegenerate={() => {}} regenerating={false} controller={controller} />
    </div>
  );
}
