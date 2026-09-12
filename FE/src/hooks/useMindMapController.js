// Workspace architecture — selection controller extracted OUT of MindElixirView
// (approved audit, point 5). Owns node selection, history, pins, and graph
// relations as PURE state/callbacks — no DOM, no mind-elixir instance creation
// (that stays in MindElixirView, which is DOM-bound by nature). Called ONCE by
// whoever owns both the canvas and the Inspector (WorkspaceContainer/MainLayout),
// so both consume the SAME state instead of two copies of it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildGraphIndex, relationsFor, headingPath } from "../utils/mindmapGraph";

export function useMindMapController(data) {
  // The mind-elixir INSTANCE and its sidecar are DOM-bound and created by
  // MindElixirView's own init effect; the controller only needs a place to
  // read them from when `jumpTo`/`goBack`/`goForward` fire. `registerMindInstance`
  // is what MindElixirView calls right after `mind.init(...)`.
  const mindRef = useRef(null);
  const sidecarRef = useRef(new Map());

  const graphIndexRef = useRef({ byId: new Map(), childrenOf: new Map() });
  const historyRef = useRef({ stack: [], index: -1 });
  const [historyVersion, setHistoryVersion] = useState(0);
  const [pinned, setPinned] = useState(() => new Set());
  const [selected, setSelected] = useState(null);

  // New document (or first load) → the graph and the session both restart.
  // Deliberately does NOT reset when the SAME document's mindmap record just
  // gets a new object identity (e.g. after Save) — only `data?.id` changing
  // means a genuinely different mindmap (workspace switching requirement 6).
  useEffect(() => {
    graphIndexRef.current = buildGraphIndex(data);
    historyRef.current = { stack: [], index: -1 };
    setHistoryVersion(0);
    setPinned(new Set());
    setSelected(null);
  }, [data?.id]);

  const pushHistory = useCallback((id) => {
    const h = historyRef.current;
    if (h.stack[h.index] === id) return;
    h.stack = h.stack.slice(0, h.index + 1).concat(id);
    h.index = h.stack.length - 1;
    setHistoryVersion((v) => v + 1);
  }, []);

  // MindElixirView calls this once per mind-elixir init, right after building
  // the sidecar — gives the controller what it needs to drive selectNode/
  // findEle/scrollIntoView without owning the instance itself.
  const registerMindInstance = useCallback((mind, sidecar) => {
    mindRef.current = mind;
    sidecarRef.current = sidecar;
  }, []);

  // MindElixirView's own "selectNodes" bus listener calls this with the raw
  // mind-elixir node list — the ONE place a canvas click (or a programmatic
  // jumpTo, which drives the same bus event) turns into controller state.
  const onNodeSelected = useCallback((nodes) => {
    const n = nodes?.[0];
    if (!n) return;
    const side = sidecarRef.current.get(n.id);
    setSelected({
      id: n.id, title: n.topic, note: side?.note || "", chunkRefs: side?.chunkRefs || [],
      number: side?.number || "", level: side?.level || 0, enrichment: side?.enrichment || [],
    });
    pushHistory(n.id);
  }, [pushHistory]);

  const jumpTo = useCallback((id) => {
    const mind = mindRef.current;
    const tpc = mind?.findEle?.(id);
    if (!tpc) return;
    mind.selectNode(tpc);
    mind.scrollIntoView?.(tpc, true);
  }, []);

  const goBack = useCallback(() => {
    const h = historyRef.current;
    if (h.index <= 0) return;
    h.index -= 1; // BEFORE jumpTo so pushHistory's dedupe no-ops on replay
    jumpTo(h.stack[h.index]);
    setHistoryVersion((v) => v + 1);
  }, [jumpTo]);
  const goForward = useCallback(() => {
    const h = historyRef.current;
    if (h.index >= h.stack.length - 1) return;
    h.index += 1;
    jumpTo(h.stack[h.index]);
    setHistoryVersion((v) => v + 1);
  }, [jumpTo]);

  const togglePin = useCallback(() => {
    setPinned((prev) => {
      const id = selected?.id;
      if (!id) return prev;
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, [selected?.id]);

  const relations = useMemo(() => relationsFor(graphIndexRef.current, selected?.id), [selected?.id]);
  const breadcrumb = useMemo(() => headingPath(graphIndexRef.current, selected?.id), [selected?.id]);
  const recentItems = useMemo(() => {
    const h = historyRef.current;
    const seen = new Set([selected?.id]);
    const out = [];
    for (let i = h.index - 1; i >= 0 && out.length < 8; i--) {
      const id = h.stack[i];
      if (seen.has(id)) continue;
      seen.add(id);
      const n = graphIndexRef.current.byId.get(id);
      if (n) out.push({ id: n.id, title: n.title, number: n.number });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyVersion, selected?.id]);
  const pinnedItems = useMemo(() => (
    Array.from(pinned)
      .map((id) => graphIndexRef.current.byId.get(id))
      .filter(Boolean)
      .map((n) => ({ id: n.id, title: n.title, number: n.number }))
  ), [pinned]);
  const canBack = historyRef.current.index > 0;
  const canForward = historyRef.current.index < historyRef.current.stack.length - 1;
  const isPinned = Boolean(selected?.id && pinned.has(selected.id));

  return {
    // consumed by MindElixirView (canvas):
    registerMindInstance, onNodeSelected, sidecarRef,
    // consumed by KnowledgeInspector (and MindElixirView, for its own toolbar bits if needed):
    selected, relations, breadcrumb, jumpTo, goBack, goForward, togglePin,
    nav: { canBack, canForward, onBack: goBack, onForward: goForward, recent: recentItems, pinned: pinnedItems, isPinned, onTogglePin: togglePin },
  };
}
