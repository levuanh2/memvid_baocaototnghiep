// Viewer mind-elixir — thay ReactFlow/ELK.
//
// Workspace architecture (approved audit) — this component is now Toolbar +
// Canvas ONLY. It no longer owns a fullscreen overlay, the Knowledge Inspector,
// or any node-selection state: WorkspaceContainer mounts this as the "MindMap"
// tab's content, calls `useMindMapController()` ONCE, and hands this component
// only the pieces it still legitimately owns (the mind-elixir instance
// lifecycle) via the `controller` prop. Inspector reads the SAME controller
// from a sibling slot — one controller, one Inspector, never duplicated.
import { useEffect, useRef, useState, useCallback } from "react";
import MindElixir from "mind-elixir";
// BẮT BUỘC: toàn bộ layout của mind-elixir (me-nodes flex, me-tpc block, gaps)
// nằm trong CSS này — thiếu nó mọi node rơi về display:inline và sơ đồ vỡ hoàn toàn.
import "mind-elixir/style";
import { THEME } from "./mindElixirTheme";
import { recordToMindElixir, mindElixirToRecord } from "../../utils/mindElixirAdapter";
import { attachExpandDecorator } from "../../utils/mindElixirExpandDecorator";
import { attachBranchSelectionMode } from "../../utils/mindmapBranchSelectionMode";
import { nextScale, formatZoom, viewportKeyAction, ZOOM_STEP } from "../../utils/mindmapViewport";
import { validateMindMapRender } from "../../utils/mindmapRenderLifecycle";
import { clearRootOnly, isRootOnly, reapplyRootOnly, setRootOnly } from "../../utils/mindElixirRootOnly";
import { updateMindmap } from "../../utils/api";
import { toast } from "../ui/Toaster";
import { Icon } from "../ui/Icon";
import ExportStudioDialog from "./ExportStudioDialog";
import Spinner from "../ui/Spinner";
import OperationUsage from "../Layout/OperationUsage";
import "./mindmap.css";

// Round 2: moved to mindElixirTheme.js (importing it FROM here inside
// mindmapImageExport.js — needed for the offscreen multi-branch export
// instance — would create MindElixirView -> ExportStudioDialog ->
// mindmapImageExport -> MindElixirView, a cycle). Re-exported (not just
// re-imported) so `theme.test.js`'s existing `import { THEME } from
// "./MindElixirView"` keeps working unchanged.
export { THEME };

// Mind Elixir throws (instead of returning null) when an id belongs to the
// previous map or a currently collapsed branch. Render-time derived UI must
// treat that transient condition as "not selected", especially during A↔B
// switches before the controller's id-keyed effect clears React selection.
// Initial placement on narrow canvases. scaleFit alone shrinks a wide tree to
// ~27% (390px wide canvas: node labels unreadable, the map floats in empty space).
// The fit stays the single initial operation; the scale is then floored at a
// readable size and the root is centred. Horizontal panning covers the rest.
const MOBILE_FIT_MAX_WIDTH = 640;
const MOBILE_READABLE_MIN_SCALE = 0.75;

function applyReadableFloor(mind, el) {
  if (!mind || !el || el.clientWidth > MOBILE_FIT_MAX_WIDTH) return;
  if ((mind.scaleVal ?? 1) >= MOBILE_READABLE_MIN_SCALE) return;
  mind.scale(MOBILE_READABLE_MIN_SCALE);
  mind.toCenter?.();
}

function findTopicSafely(mind, id) {
  if (!mind || !id) return null;
  try { return mind.findEle?.(id) || null; }
  catch { return null; }
}

// `data`: the mindmap record + generation-status fields SidebarRight already
// computes (generating/progress/onCancel/onSaved/onDirtyChange) — UNCHANGED
// shape from before this refactor, just no longer wrapped in a portal.
// `controller`: the ONE `useMindMapController()` instance, owned by whoever
// renders both this component and KnowledgeInspector (WorkspaceContainer).
export default function MindElixirView({ data, onRegenerate, regenerating, controller }) {
  const containerRef = useRef(null);
  const mindRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const pendingFitRef = useRef(false);
  const pollActiveRef = useRef(false);
  const renderPollStopRef = useRef(null);
  const [showRelations, setShowRelations] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);              // readout — nguồn sự thật là bus "scale"
  // Lỗi Lưu/Xuất PNG. Trước đây CHỈ có toast — toast tự tắt sau vài giây, mà lỗi lưu thì
  // map vẫn đang dirty: user quay đi quay lại là mất luôn lý do hỏng, tưởng đã lưu xong.
  // Banner ở lại tới khi tự đóng hoặc tới lần thao tác sau.
  const [errorMsg, setErrorMsg] = useState(null);
  const [renderState, setRenderState] = useState("idle");
  const [renderError, setRenderError] = useState(null);
  const [contextOverflowOpen, setContextOverflowOpen] = useState(false);
  const [mapSelectorOpen, setMapSelectorOpen] = useState(false);

  // Escape or any pointer press outside the overflow menu dismisses it. Without
  // this the open menu stays on top of the canvas and the next topic tap lands on
  // one of its items instead of the topic (mobile first-click defect).
  useEffect(() => {
    if (!contextOverflowOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setContextOverflowOpen(false); };
    const onPointer = (e) => { if (!e.target.closest?.(".mm-toolbar-menu-wrap")) setContextOverflowOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [contextOverflowOpen]);
  // Round 8 redesign: expand/collapse state lives on mind-elixir's own live
  // nodeData tree (`node.expanded`), not React state — mirroring it into a
  // separate state value would risk drifting from the real render. This
  // setter is a pure "please re-render, something in that tree changed"
  // bump; the value itself is never read — everything derived from it below
  // (selectedExpanded, selectedHasChildren) re-reads the live tree fresh on
  // every render regardless of what triggered it.
  const [, setExpandTick] = useState(0);

  // Export Studio (Round: Export Studio + expand/collapse redesign).
  const [exportOpen, setExportOpen] = useState(false);
  const [selectionModeActive, setSelectionModeActive] = useState(false);
  const [selectedBranchIds, setSelectedBranchIds] = useState(() => new Set());
  const selectionActiveRef = useRef(false);
  const selectedBranchIdsRef = useRef(selectedBranchIds);
  const branchSelectionHandleRef = useRef(null);

  const degraded = Boolean(data?.generator?.degraded);
  const missing = data?.generator?.missing || [];
  const schemaVersion = Number(data?.schema_version);
  const missingRelations = !Object.prototype.hasOwnProperty.call(data || {}, "relations");
  // "enrichment" is a V2-only per-node field (LLM-added supplementary text).
  // V3 guided nodes never have it (they use note/chunk_refs/node_type
  // instead) -- gating this check to schema_version < 3 fixes every valid,
  // complete V3 map being permanently mislabeled "Sơ đồ cũ · Nâng cấp" below
  // regardless of actual quality (2026-09-24, found via a real production
  // record with real hierarchy/relations still showing the "old map" badge).
  const missingEnrichment = schemaVersion < 3 && Array.isArray(data?.nodes)
    && data.nodes.some((node) => !Object.prototype.hasOwnProperty.call(node || {}, "enrichment"));
  const generatorMissing = Array.isArray(data?.generator?.missing) ? data.generator.missing : [];
  const upgradeRequired = schemaVersion < 2 || missingRelations || missingEnrichment
    || generatorMissing.includes("enrich") || generatorMissing.includes("relations");
  // "Tạo lại" đang chạy nền (SidebarRight bơm generating/progress/onCancel vào
  // data) — banner + nút Huỷ ngay trong toolbar.
  const generating = Boolean(data?.generating);

  // `mind.init()` and `mind.refresh()` (called right below, in the mount
  // effect) both run mind-elixir's own internal layout()->linkDiv()
  // synchronously and unconditionally -- with no container-size check. When
  // this effect runs while the Mind Map pane is still CSS-hidden
  // (WorkspaceContainer keeps every pane mounted, only toggling a `hidden`
  // class -- e.g. right after a page reload lands on Chat), that internal
  // layout computes connector geometry from zero-sized node boxes,
  // producing literal "NaN" in every `.lines path`'s `d` attribute.
  // Reproduced live: reload -> Chat active -> hidden Mind Map pane had 60
  // real nodes / 7 total paths, all 7 "NaN", canvas 0x0 -- sitting in the
  // DOM for however long the user stayed on another tab. `fitIfReady`
  // below already repairs this correctly once the pane becomes visible
  // (confirmed live, NaN->0 within ~0.18-1.6s, no visible broken frame
  // since the pane is `display:none` the whole time) -- that mechanism is
  // untouched here. This only stops the invalid markup from persisting in
  // the meantime: neutralizes it to an empty (harmless, valid) `d` in the
  // SAME tick it's created, instead of leaving "NaN" sitting there
  // indefinitely for anything that reads the DOM while hidden (a screen
  // reader, "Xuất PNG", devtools). A no-op when the pane is already visible
  // (real geometry never produces NaN in the first place).
  const sanitizeHiddenNaNPaths = (el) => {
    if (!el || (el.clientWidth > 0 && el.clientHeight > 0)) return;
    el.querySelectorAll(".lines path, .subLines path").forEach((p) => {
      if ((p.getAttribute("d") || "").includes("NaN")) p.setAttribute("d", "");
    });
  };

  // Returns true once the repair is VERIFIED to have actually worked, false
  // if the caller (the polling loop below) should keep retrying.
  const fitIfReady = useCallback(() => {
    const el = containerRef.current;
    const mind = mindRef.current;
    if (!mind || !el || el.clientWidth <= 0 || el.clientHeight <= 0) return false;
    // 2026-09-24: `scaleFit()` only computes a zoom/pan transform from the
    // node elements' EXISTING offsetWidth/offsetHeight -- it never calls
    // `layout()`/`linkDiv()`, so it cannot repair the broken NaN root-level
    // `.lines` connector paths that `mind.init()` produces when it first ran
    // against this same 0x0 container (verified against mind-elixir's own
    // source: `scaleFit` and `linkDiv` are two separate, unrelated
    // functions). `layout()` recomputes every node's real position from
    // `this.nodeData` (safe, no args, no data loss); `linkDiv()` redraws the
    // connector paths from those positions -- same pair mind-elixir's own
    // `refresh()` runs.
    //
    // NOT gated by pendingFitRef: the first caller to report a positive
    // width/height is not reliably the container's SETTLED size -- it can
    // run mid CSS-transition (the right panel's own
    // `transition-transform duration-200`, tab-switch animations), so a
    // one-shot repair could still run against a transitional, still-wrong
    // size and never get a second chance. layout()+linkDiv() are cheap and
    // idempotent -- mind-elixir already reruns them on every theme toggle --
    // so rerunning them on every qualifying call is safe.
    setRenderState("laying_out");
    if (isRootOnly(mind)) reapplyRootOnly(mind);
    else mind.layout?.();
    setRenderState("linking");
    if (!isRootOnly(mind)) mind.linkDiv?.();
    // 2026-09-24: `el.clientWidth > 0` alone is NOT a reliable readiness
    // signal -- reproduced live: the container reported a real width on the
    // very first poll frame, layout()+linkDiv() ran, and the `.lines` paths
    // were STILL `NaN` (something layout() itself measures internally --
    // e.g. the root topic element's own offsetWidth/offsetHeight, per
    // mind-elixir's source -- was not yet settled even though the outer
    // container's width already was). Verify the actual rendered output
    // instead of trusting the proxy: if any root-level connector path still
    // contains "NaN", the repair did not really take -- report not-ready so
    // the poll keeps retrying on a later frame instead of giving up early.
    setRenderState("validating");
    const validation = validateMindMapRender(el);
    if (!validation.ok) return false;
    if (pendingFitRef.current) {
      pendingFitRef.current = false;
      mind.scaleFit?.();
      applyReadableFloor(mind, el);
    }
    setRenderError(null);
    setRenderState("ready");
    return true;
  }, []);

  // 2026-09-24: starts a single polling loop that keeps calling
  // fitIfReady() -- cheap when not ready (an early-return on clientWidth)
  // -- until it reports success, WHETHER OR NOT the pane is visible yet.
  // This replaced three earlier designs, all tried live and confirmed
  // broken:
  //
  // - A 60-frame (~1s) capped rAF poll: too short. WorkspaceContainer
  //   mounts a pane's content as soon as it HAS data, not when it becomes
  //   the active tab, so the container can stay hidden for however long
  //   the user takes to click into Mind Map -- an unbounded, user-paced
  //   interval, not a brief settling delay.
  // - An IntersectionObserver restarting an uncapped rAF poll on every
  //   "became visible" report: fires REPEATEDLY during the right panel's
  //   own CSS transition, and cancelling + restarting the poll on every
  //   firing kept resetting it before it landed a frame where geometry
  //   was actually correct.
  // - A single continuous, uncapped rAF poll (no observer at all): still
  //   confirmed broken live, and root-caused precisely this time --
  //   `document.visibilityState` was `"hidden"` for the Cloud Browser tab
  //   used for verification (confirmed directly: a bare rAF loop's own
  //   counter stayed at exactly 0 after 5+ real seconds). Chrome fully
  //   SUSPENDS requestAnimationFrame callbacks for a tab it considers
  //   backgrounded -- not throttles, suspends -- so an rAF-driven poll
  //   never ran even once in that environment, while a manual synchronous
  //   `mind.layout(); mind.linkDiv()` call (unaffected by rAF suspension)
  //   fixed it instantly every single time, in every round. `setTimeout`
  //   is throttled in a hidden tab (backed off to ~1s between calls after
  //   a few seconds) but, unlike rAF, is never fully suspended -- it still
  //   reliably fires. Switching to it fixes the exact failure mode that
  //   produced five straight "still broken live" results, and is at least
  //   as good for a real, foreground, visible tab (rAF and a ~16ms
  //   setTimeout both settle within a frame or two there).
  //
  // pollActiveRef guards against a second concurrent poll (e.g. an
  // unrelated re-render) rather than against any specific external
  // trigger. The wall-clock ceiling is generous (2 minutes) purely as a
  // safety valve against looping forever on something permanently,
  // unrecoverably broken.
  // Returns a cleanup function so callers can cancel it (unmount).
  const startFitPoll = useCallback(() => {
    if (pollActiveRef.current) return () => {};
    pollActiveRef.current = true;
    let cancelled = false;
    let timer = null;
    const deadline = (typeof performance !== "undefined" ? performance.now() : Date.now()) + 10000;
    const stop = () => { cancelled = true; pollActiveRef.current = false; if (timer) clearTimeout(timer); if (renderPollStopRef.current === stop) renderPollStopRef.current = null; };
    const poll = () => {
      if (cancelled) return;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (fitIfReady()) { stop(); return; }
      if (now >= deadline) {
        pollActiveRef.current = false;
        renderPollStopRef.current = null;
        setRenderError("Không thể dựng connector trong thời gian cho phép.");
        setRenderState("error");
        return;
      }
      timer = setTimeout(poll, 16);
    };
    timer = setTimeout(poll, 16);
    renderPollStopRef.current = stop;
    return stop;
  }, [fitIfReady]);

  const retryRender = useCallback(() => {
    renderPollStopRef.current?.();
    setRenderError(null);
    setRenderState("waiting_for_size");
    pendingFitRef.current = true;
    renderPollStopRef.current = startFitPoll();
  }, [startFitPoll]);

  // Create once per mounted viewer. Switching saved maps refreshes this same
  // public Mind Elixir instance instead of rebuilding the canvas.
  useEffect(() => {
    if (!containerRef.current || !data) return;
    renderPollStopRef.current?.();
    setRenderState("mounting");
    setRenderError(null);
    setDirty(false);
    setSaving(false);
    setZoom(1);
    setErrorMsg(null);
    const { mindData, sidecar } = recordToMindElixir(data);
    let mind = mindRef.current;
    if (!mind) {
      mind = new MindElixir({
        el: containerRef.current,
        direction: MindElixir.SIDE,
        compact: true,
        editable: true,
        contextMenu: true,
        toolBar: false,
        keypress: true,
        allowUndo: true,
        mouseSelectionButton: 2,
        theme: THEME,
      });
      mind.init(mindData);
      mindRef.current = mind;

      mind.bus.addListener("scale", (v) => setZoom(v));
      mind.bus.addListener("selectNodes", (nodes) => {
        controller.onNodeSelected(nodes);
      });
      mind.bus.addListener("operation", () => {
        setDirty(true);
        reapplyRootOnly(mind);
      });
      // Clicking a per-node caret calls mind-elixir's own `expandNode`,
      // which fires this bus event (dist/MindElixir.js) — but NOT for
      // `expandNodeAll` (verified: no bus.fire in that function). The
      // floating toolbar's own single-branch toggle below calls
      // expandNodeAll directly and bumps expandTick itself right after,
      // so this listener only needs to cover the caret's path.
      mind.bus.addListener("expandNode", () => setExpandTick((v) => v + 1));
    } else {
      clearRootOnly(mind);
      mind.refresh?.(mindData);
      mind.clearHistory?.();
    }
    sanitizeHiddenNaNPaths(containerRef.current);
    controller.registerMindInstance(mind, sidecar);
    setZoom(mind.scaleVal || 1);
    // Round 8: selectedHasChildren/selectedExpanded below are derived at
    // render time from `mindRef.current` — a REF, which doesn't itself
    // trigger a re-render when it's newly populated here. `setZoom` right
    // above usually forces one anyway (mount effect runs before first
    // paint, so `zoom` state is still its initial `1` and `mind.scaleVal`
    // is also 1 -- Object.is(1,1) makes THAT particular setState a no-op
    // bail-out), so it can't be relied on. This one exists purely to
    // guarantee at least one real re-render happens once mindRef is ready,
    // so a node selected before this component finished mounting (or a
    // fresh map switch) doesn't leave the contextual branch toggle
    // permanently absent.
    setExpandTick((v) => v + 1);
    pendingFitRef.current = true;
    // 2026-09-24: a short bounded poll (~1s) is NOT long enough here --
    // reproduced live: WorkspaceContainer mounts every pane's content as
    // soon as it HAS data (not when it becomes the active tab), toggling
    // visibility with a CSS `hidden` (display:none) class on an ancestor.
    // If the map arrives while the user is still on the Chat tab, this
    // effect runs -- and the poll below -- while that ancestor is still
    // hidden, `containerRef.current.clientWidth` stays 0 for as long as the
    // user takes to click into the Mind Map tab (an UNBOUNDED, user-paced
    // interval, not a settling delay), and a 1-second poll exhausts and
    // gives up long before that click ever happens (confirmed live:
    // clientWidth/height were still exactly 0 five real seconds after
    // mount). `startFitPoll` (declared below `fitIfReady`) has no such cap
    // -- it keeps retrying, cheaply, until the pane genuinely becomes
    // visible, however long that takes.
    setRenderState("waiting_for_size");
    renderPollStopRef.current = startFitPoll();
    return () => renderPollStopRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id, startFitPoll]);

  // Round 8 — per-node branch caret a11y (see mindElixirExpandDecorator.js
  // for why this has to be a MutationObserver rather than a one-shot pass:
  // mind-elixir replaces, not mutates, <me-epd> on every internal
  // re-render). The container div itself is created once and persists
  // across map switches (this component's whole "create once, refresh in
  // place" architecture — see the mount effect above), so one observer for
  // the component's lifetime is correct; it doesn't need to re-attach when
  // `data.id` changes.
  useEffect(() => attachExpandDecorator(containerRef.current), []);

  // Export Selection Mode — same "attach once, container persists across
  // map switches" lifecycle as the expand decorator above. `isActiveRef`/
  // `isSelectedFn` read refs kept in sync by the two effects right below,
  // not the raw state values directly: the decorator's own callbacks run
  // from real DOM events (imperative, outside React's render cycle), so
  // they need the CURRENT value at call time, not whatever was captured in
  // this effect's closure when it ran once on mount.
  useEffect(() => {
    const handle = attachBranchSelectionMode(containerRef.current, {
      isActiveRef: selectionActiveRef,
      isSelectedFn: (id) => selectedBranchIdsRef.current.has(id),
      onToggle: (id) => setSelectedBranchIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }),
    });
    branchSelectionHandleRef.current = handle;
    return handle.detach;
  }, []);
  useEffect(() => {
    selectionActiveRef.current = selectionModeActive;
    branchSelectionHandleRef.current?.resync();
  }, [selectionModeActive]);
  useEffect(() => {
    selectedBranchIdsRef.current = selectedBranchIds;
    branchSelectionHandleRef.current?.resync();
  }, [selectedBranchIds]);

  useEffect(() => () => {
    pendingFitRef.current = false;
    renderPollStopRef.current?.();
    mindRef.current?.destroy?.();
    mindRef.current = null;
    containerRef.current && (containerRef.current.innerHTML = "");
  }, []);

  // Sprint I fix (P0-1): mind-elixir merges `THEME.cssVar` with its OWN
  // internal light/dark default palette at `changeTheme()` time based on
  // `this.theme.type` (dist/MindElixir.js ~line 2041) — a ONE-TIME merge done
  // at `mind.init()`, not a live CSS cascade. useTheme.js just toggles
  // `html.dark` with no context/event other components can subscribe to, so
  // toggling dark mode after mount never re-ran that merge — node fills froze
  // at whichever theme was active on first render. A MutationObserver on
  // `<html>`'s class (self-contained here, no app-wide state/context change)
  // re-invokes the library's own public `changeTheme()` so it re-resolves
  // against the CURRENT `html.dark` state.
  //
  // Final QA fix: `changeTheme()` ALONE only updates node fill/text colors —
  // it does not recompute connector paths. On a real multi-branch document
  // (verified live on a real generated graph, not just the small harness
  // dataset earlier passes were checked against), the subLines connectors
  // went stale/NaN after a theme toggle — visible as missing or malformed
  // curves, console errors ("<path> attribute d: Expected number, "M NaN
  // 0..."). mind-elixir's own `refresh()` calls `changeTheme()` THEN
  // `layout()` THEN `linkDiv()` in sequence (dist/MindElixir.js, the
  // function assigned to `refresh`) — that's the real contract; a bare
  // `changeTheme()` call was always incomplete. Not calling `refresh()`
  // itself: it also reassigns `this.nodeData` from its argument and calls
  // `toCenter()`, which would wipe the current tree unless passed a fully
  // reconstructed data object and would recenter the view out from under
  // the user's current pan/zoom — `layout()` + `linkDiv()` alone give the
  // same connector-geometry fix without either side effect.
  useEffect(() => {
    const html = document.documentElement;
    const observer = new MutationObserver(() => {
      const mind = mindRef.current;
      const el = containerRef.current;
      if (!mind || !el) return;
      renderPollStopRef.current?.();
      pendingFitRef.current = false;
      mind.changeTheme?.(THEME);
      if (el.clientWidth <= 0 || el.clientHeight <= 0) {
        setRenderState("waiting_for_size");
        renderPollStopRef.current = startFitPoll();
        return;
      }
      setRenderState("laying_out");
      if (isRootOnly(mind)) reapplyRootOnly(mind);
      else mind.layout?.();
      setRenderState("linking");
      if (!isRootOnly(mind)) mind.linkDiv?.();
      setRenderState("validating");
      if (validateMindMapRender(el).ok) setRenderState("ready");
      else renderPollStopRef.current = startFitPoll();
    });
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [startFitPoll]);

  // Final QA fix (2nd bug, same family): WorkspaceContainer mounts every
  // pane's content as soon as it HAS data, toggling only CSS `hidden`
  // (display:none) to switch tabs — mind-elixir's own effect above doesn't
  // know about that: if the mindmap arrives while the user is still on the
  // Chat tab, `mind.init()` (and its internal first layout()/linkDiv()) runs
  // against a 0x0 container (display:none collapses every descendant's
  // offsetWidth/offsetHeight to 0), producing the exact same NaN subLines
  // paths as the dark-mode bug above.
  //
  // 2026-09-24: this used to be a ResizeObserver, then an
  // IntersectionObserver, both meant to catch the hidden -> visible
  // transition and (re)start the repair poll at that moment. Both were
  // tried live and confirmed broken -- see the long comment on
  // `startFitPoll` above for exactly how. No observer-based "catch the
  // transition" effect exists here anymore: `startFitPoll()` (called once,
  // in the mount effect below) already runs continuously until real
  // geometry exists, regardless of when the pane becomes visible, which
  // makes a separate visibility-detection effect redundant -- one moving
  // part sidesteps needing to correctly time an external signal at all.

  // Background-pan fix: dragging the empty canvas is supposed to move the
  // viewport (constructor sets `mouseSelectionButton: 2` specifically to
  // free the LEFT button for panning, right button for box-select). It
  // never did — confirmed live: `.map-canvas`'s `translate3d(...)` was
  // byte-identical before/after a left-button drag from empty space.
  // Root cause is inside mind-elixir 5.13.0 itself (dist/MindElixir.js,
  // the pointerdown handler `u`): `if (editable && target.className ===
  // "map-container" && button === 0 && pointerType === "mouse") { ptState =
  // BoxSelect; return }` fires UNCONDITIONALLY on left-button-down over the
  // bare canvas, ignoring `mouseSelectionButton` entirely, and returns
  // before the pan-button logic below it (which DOES respect the config)
  // ever runs. `BoxSelect` then has no `pointermove` case in the library's
  // own switch, so it's a silent dead end — no pan, no visible selection
  // box either. Can't patch node_modules. Mind-elixir does expose a public,
  // typed `move(dx, dy, smooth?)` (used internally for wheel-panning, see
  // dist/MindElixir.js `e.move(-deltaX, -deltaY)`) that reads/writes the
  // live `.map-canvas` transform mind-elixir itself later re-parses from
  // the DOM — safe to drive from outside. Attached to the WRAPPER
  // (`canvasWrapRef`, parent of the node mind-elixir binds to) so it fires
  // independently of — not fighting — mind-elixir's own inert BoxSelect
  // branch. Gated to `<me-tpc>` misses (mind-elixir topics are the custom
  // element `<me-tpc>`, not a `.me-tpc` class) so node drag/reparent still
  // goes through mind-elixir's own Drag state untouched.
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    let pan = null;
    const onDown = (e) => {
      // Round 2 real-browser find: without ".mm-selection-bar" here,
      // setPointerCapture(wrap) below hijacks the CLICK that follows a
      // pointerdown on the bar's own buttons — Chromium redirects the
      // synthesized click's target to the captured element (`wrap`)
      // instead of the button, so "Tiếp tục"/"Xóa chọn"/"Hủy" silently do
      // nothing. jsdom doesn't model pointer-capture click redirection, so
      // this was invisible to every jsdom-based test; only caught by
      // driving a real Chromium instance (see e2e-fixture's multi-branch
      // export spec).
      // Same class of bug, same fix, for `me-export-check` (hotfix round):
      // pointerdown/mousedown correctly hit the checkbox (confirmed once
      // mindmap.css's own missing `pointer-events: auto` on it was fixed),
      // but without it excluded HERE too, this same setPointerCapture(wrap)
      // still fires on that pointerdown and hijacks mouseup/click to `wrap`
      // a moment later — the checkbox's own click listener never runs.
      // Real evidence (Playwright event-target log): pointerdown/mousedown
      // target ME-EXPORT-CHECK, then mouseup/click both retarget to the
      // canvas wrap div. The CSS fix alone was necessary but not
      // sufficient; this exclusion is the other half.
      if (e.button !== 0 || e.target.closest("me-tpc, me-epd, me-export-check, .mm-floating-toolbar, .mm-legend, .mm-fullscreen-corner, .mm-selection-bar")) return;
      pan = { x: e.clientX, y: e.clientY, id: e.pointerId };
      wrap.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!pan || e.pointerId !== pan.id) return;
      const dx = e.clientX - pan.x;
      const dy = e.clientY - pan.y;
      pan.x = e.clientX;
      pan.y = e.clientY;
      mindRef.current?.move?.(dx, dy);
    };
    const onUp = (e) => {
      if (!pan || e.pointerId !== pan.id) return;
      wrap.releasePointerCapture?.(e.pointerId);
      pan = null;
    };
    wrap.addEventListener("pointerdown", onDown);
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerup", onUp);
    wrap.addEventListener("pointercancel", onUp);
    return () => {
      wrap.removeEventListener("pointerdown", onDown);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerup", onUp);
      wrap.removeEventListener("pointercancel", onUp);
    };
  }, []);

  // PR#8: thread dirty lên SidebarRight (data.onDirtyChange) — parent cần biết
  // để confirm TRƯỚC khi "Tạo lại" thay thế bản đang sửa (fix thật của known-issue
  // "Tạo lại xong ghi đè chỉnh sửa chưa lưu"). Unmount → báo false (hết phiên sửa).
  useEffect(() => {
    data?.onDirtyChange?.(dirty);
  }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { data?.onDirtyChange?.(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Task 8: explicit Save → PUT /mindmaps/<id>. Only reachable when the button
  // is rendered (data.id real + not "preview" + not generating — see JSX
  // below), so `data.id` is safe to PUT here.
  const handleSave = async () => {
    const mind = mindRef.current;
    // `saving` in the guard: the button's disabled attr alone isn't a guarantee
    // against double invocation (e.g. a queued second click before re-render).
    if (!mind || !dirty || saving) return;
    setSaving(true);
    setErrorMsg(null);   // thử lại → bỏ lỗi lần trước, đừng để banner cũ gây hiểu nhầm
    try {
      const record = mindElixirToRecord(mind.getData(), controller.sidecarRef.current, data);
      const saved = await updateMindmap(data.id, record);
      setDirty(false);
      toast("Đã lưu sơ đồ", { type: "success" });
      data.onSaved?.(saved); // SidebarRight bơm callback để cập nhật list + showModalMap
    } catch (err) {
      // Banner (không phải toast): map còn dirty, lý do hỏng phải ở lại trước mắt user.
      setErrorMsg(`Không lưu được: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Đọc trần/sàn từ CHÍNH instance (mind-elixir 5.13 set `this.scaleMin = 0.2`,
  // `this.scaleMax = 1.4` trong constructor) thay vì hardcode: guard trong `scale()` của
  // thư viện là REJECT chứ không phải clamp —
  //   `if (e < this.scaleMin && e < this.scaleVal || e > this.scaleMax && e > this.scaleVal) return`
  // — nên clamp cũ 0.4–2 vượt trần thật 1.4: nút "Phóng to" im lặng chết ở 1.4 mà không
  // báo gì. Kẹp theo số của instance thì scale() luôn nhận và readout luôn khớp map.
  const zoomBy = useCallback((delta) => {
    const mind = mindRef.current;
    if (!mind) return;
    mind.scale(nextScale(mind.scaleVal, delta, { min: mind.scaleMin, max: mind.scaleMax }));
  }, []);

  // scaleFit() tự căn theo bounding box của nodes (dist: `Ce(this, !0)` — tham số `true`
  // ÉP nhánh căn-theo-nodes bất kể option `alignment`), nên KHÔNG cần truyền
  // `alignment: "nodes"` vào constructor và không đụng gì tới `toCenter()` mặc định.
  // Nó chỉ thu nhỏ, không phóng to quá 100% (`1 / Math.max(1, ...)`).
  // `?.()` phòng version drift: thiếu method thì no-op, không ném trong onClick.
  const fitView = useCallback(() => { mindRef.current?.scaleFit?.(); }, []);

  // toCenter() GIỮ NGUYÊN scaleVal (dist: `pn` vẽ lại transform với `scale(${this.scaleVal})`)
  // → "về khung nhìn gốc" phải gọi CẢ HAI, scale trước rồi mới căn giữa.
  const resetView = useCallback(() => {
    const mind = mindRef.current;
    if (!mind) return;
    mind.scale(1);
    mind.toCenter();
  }, []);

  // Click vào readout = chỉ trả thu phóng về 100%, giữ nguyên vị trí đang xem.
  const resetZoom = useCallback(() => { mindRef.current?.scale(1); }, []);

  // Expand/Collapse (round 8) — Feasibility check before writing any of this
  // (see docs/VISUAL_IDENTITY_WORKSPACE_REDESIGN.md): mind-elixir 5.13's own
  // TYPED public prototype (node_modules/mind-elixir/dist/types/index.d.ts)
  // exposes `expandNodeAll(el: Topic, isExpand?: boolean)`, and its actual
  // implementation (dist/MindElixir.js) captures the target node's screen
  // position, toggles `expanded` on it AND every descendant, re-renders,
  // then calls `this.move()` to put that SAME node back at the SAME screen
  // position — a real, built-in viewport-preserving mechanism, not
  // something bolted on here. Scale/zoom is never touched by it either.
  // `findEle(id)` is the same public lookup `useMindMapController.jumpTo`
  // already uses elsewhere in this codebase — no private DOM querying, no
  // internals poked, no instance rebuild.
  //
  // Deliberately NOT implemented this round: a Layout/orientation control
  // (initLeft/initRight/initSide). Those are equally public and typed, but
  // their own implementation unconditionally ends in `toCenter()` — it
  // recenters the pan position every time (zoom is preserved, verified in
  // the same dist file, but center is not) as an intrinsic part of what a
  // direction change even means, not a side effect avoidable by calling the
  // API differently. That conflicts with this round's explicit "preserve
  // viewport center" bar, and there is no public way to change direction
  // without it — so it's deferred rather than shipped as a control that
  // silently violates that bar. See the epic-closing report for the exact
  // API/version citation.
  //
  // Round 8 REDESIGN (2026-09-28 — Export Studio round): the toolbar used to
  // show two always-present buttons ("Mở rộng"/"Thu gọn") whose LABELS
  // changed based on selection, both still doing the same "selected branch
  // or whole map" scoping. New spec: exactly ONE contextual action, shown
  // only when a node with children is selected — global "expand/collapse
  // everything" and depth presets move to the overflow menu permanently,
  // independent of whatever's currently selected. Two separate helpers
  // below, matching that split; neither invents a new toggle mechanism —
  // both still call mind-elixir's own public `expandNodeAll` (see the
  // feasibility note above this block, unchanged and still accurate for
  // both call sites) or `layout()+linkDiv()` for the depth case, the same
  // side-effect-free re-render pair `fitIfReady` already established.
  //
  // Derived fresh on every render (not memoized): mind-elixir's node tree
  // can change (a caret click, this toolbar's own button) without React
  // knowing on its own — `expandTick`'s only job is forcing a re-render so
  // these reads happen again, not carrying any value itself.
  const selectedId = controller?.selected?.id;
  const selectedTopicEl = findTopicSafely(mindRef.current, selectedId);
  const selectedNodeObj = selectedTopicEl?.nodeObj;
  const selectedHasChildren = Boolean(selectedNodeObj?.children?.length);
  const selectedExpanded = selectedNodeObj?.expanded !== false;

  const toggleSelectedBranch = useCallback(() => {
    const mind = mindRef.current;
    const id = controller?.selected?.id;
    if (!mind || !id) return;
    const topic = findTopicSafely(mind, id);
    const nodeObj = topic?.nodeObj;
    if (!topic || !nodeObj?.children?.length) return;
    mind.expandNodeAll(topic, nodeObj.expanded === false);
    setExpandTick((v) => v + 1); // expandNodeAll fires no bus event of its own
  }, [controller]);

  // True global actions — always target the map's own root regardless of
  // whatever node happens to be selected, unlike toggleSelectedBranch above.
  const expandCollapseWholeMap = useCallback((isExpand) => {
    const mind = mindRef.current;
    if (!mind?.nodeData) return;
    if (!isExpand) {
      controller?.clearSelectedNode?.();
      setRootOnly(mind, true);
      setExpandTick((v) => v + 1);
      return;
    }
    // Leaving root-only restores the exact tree state captured before the
    // presentation collapse, including any independently collapsed branch.
    if (setRootOnly(mind, false)) {
      setExpandTick((v) => v + 1);
      return;
    }
    const topic = mind.findEle?.(mind.nodeData.id);
    if (!topic) return;
    mind.expandNodeAll(topic, isExpand);
    setExpandTick((v) => v + 1);
  }, [controller]);

  // "Mở đến cấp N" — mind-elixir has no native depth-based expand; walks
  // nodeData directly (setExpandedToDepth) and re-renders geometry only,
  // same as the global actions above: no scaleFit, no toCenter, no zoom
  // change.
  const expandToDepth = useCallback((depth) => {
    const mind = mindRef.current;
    if (!mind?.nodeData) return;
    setRootOnly(mind, false);
    const rootTopic = mind.findEle?.(mind.nodeData.id);
    if (!rootTopic) return;
    // Use Mind Elixir's public expandNodeAll for the actual DOM lifecycle.
    // Mutating nodeData followed by layout/linkDiv can leave stale descendant
    // wrappers in older 5.13 builds; expanding everything first, then
    // collapsing each cutoff node, makes the library remove those wrappers and
    // rebuild the corresponding connector groups consistently.
    mind.expandNodeAll?.(rootTopic, true);
    const cutoffIds = [];
    const collect = (node, currentDepth) => {
      if (!node?.children?.length) return;
      if (currentDepth >= depth) {
        cutoffIds.push(node.id);
        return;
      }
      node.children.forEach((child) => collect(child, currentDepth + 1));
    };
    collect(mind.nodeData, 0);
    cutoffIds.forEach((id) => {
      const topic = mind.findEle?.(id);
      if (topic) mind.expandNodeAll?.(topic, false);
    });
    setExpandTick((v) => v + 1);
  }, []);

  // Fullscreen (IA pass round 5) — native Fullscreen API on the canvas
  // wrapper only, no mind-elixir instance state touched. `fullscreenchange`
  // also fires for Esc/browser-chrome exits, so isFullscreen tracks the
  // real DOM state rather than just this button's own clicks.
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else canvasWrapRef.current?.requestFullscreen?.();
  }, []);
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === canvasWrapRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Workspace architecture — there's no more "close" (a workspace tab has
  // nothing to dismiss to); only zoom/view shortcuts remain here. Regenerate's
  // own dirty-confirm (SidebarRight's `confirmRegenerateIfDirty`) still guards
  // the one real data-loss risk, unchanged.
  useEffect(() => {
    const onKey = (e) => {
      // Đang gõ tên node thì editor của mind-elixir đã stopPropagation() mọi keydown
      // (verified dist) nên listener window này vốn không nhận được — guard vẫn giữ để
      // chặn các ô nhập khác và không phụ thuộc chi tiết nội bộ thư viện.
      const ae = document.activeElement;
      const isEditing = Boolean(
        ae && (ae.isContentEditable || ae.closest?.("me-tpc") || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))
      );
      const action = viewportKeyAction(e, { isEditing });
      if (!action) return;   // gồm cả Ctrl/Cmd +/-/0 — nhường keymap sẵn có của mind-elixir
      e.preventDefault();
      if (action === "in") zoomBy(ZOOM_STEP);
      else if (action === "out") zoomBy(-ZOOM_STEP);
      else if (action === "reset") resetView();
      else if (action === "fit") fitView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, resetView, fitView]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden" style={{ background: "var(--bg-base)" }}>
      {/* Toolbar — Sprint Omega: was a bordered row holding both page-identity
          (title) AND every canvas control (zoom/fit/reset/center/relations/
          export) in one flat line — the single busiest chrome strip in the
          map. Canvas controls moved to a floating cluster anchored inside
          the canvas itself (below); this row now holds only what's genuinely
          page-identity: kicker, title, dirty flag, Lưu. Quieter by
          subtraction, not by re-styling what stays. */}
      <div className="hidden flex flex-wrap items-center gap-2 px-3 py-2 border-b flex-shrink-0"
        style={{ borderColor: "var(--border-color)", background: "var(--bg-sidebar)" }}>
        <div className="min-w-0">
          <div className="font-mono text-metadata uppercase" style={{ color: "var(--text-secondary)" }}>
            Sơ đồ tư duy
          </div>
          <div className="font-display text-body font-semibold truncate text-text-primary">
            {data?.title || "Sơ đồ tư duy"}
          </div>
        </div>
        {dirty && <span className="text-caption px-1.5 rounded" style={{ color: "var(--warn)" }}>● chưa lưu</span>}
        <div className="flex-1" />
        {/* Nút Lưu — chỉ hiện khi record đã có id thật trong sqlite (không phải
            "preview" transient) và không đang generating, tránh PUT 404. */}
        {data?.id && data.id !== "preview" && !data.generating && (
          <button onClick={handleSave} disabled={!dirty || saving} aria-label="Lưu sơ đồ"
            className="btn-primary text-small disabled:opacity-40">
            {saving ? "Đang lưu…" : "Lưu"}
          </button>
        )}
      </div>
      {/* Error banner — Lưu/Xuất PNG hỏng. role="alert" để screen reader đọc ngay, không
          phải chờ user mò tới. Đứng trên banner generating/degraded vì đây là thứ user
          vừa bấm và đang chờ kết quả. */}
      {errorMsg && (
        <div role="alert" className="px-3 py-1.5 text-small flex items-center gap-2 border-b flex-shrink-0"
          style={{ color: "var(--err)", borderColor: "var(--border-color)", background: "var(--bg-elevated)" }}>
          <Icon name="TriangleAlert" size={14} />
          <span className="min-w-0 flex-1">{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} aria-label="Đóng thông báo lỗi"
            className="p-0.5 rounded hover:bg-[var(--bg-hover)]">
            <Icon name="X" size={13} />
          </button>
        </div>
      )}
      <div className="artifact-toolbar mm-context-row">
        <div className="mm-map-selector">
          <button type="button" className="mm-map-selector__trigger" aria-haspopup="listbox"
            aria-expanded={mapSelectorOpen} aria-label="Mở thư viện sơ đồ"
            onClick={() => setMapSelectorOpen((v) => !v)}>
            <Icon name="Network" size={16} />
            <span className="mm-map-selector__label">
              <strong>{data?.title || "Sơ đồ tư duy"}</strong>
              <small>{Array.isArray(data?.mindMaps) ? `${data.mindMaps.length} sơ đồ` : "Sơ đồ hiện tại"}</small>
            </span>
            <Icon name="ChevronDown" size={15} />
          </button>
          {mapSelectorOpen && (
            <div className="mm-map-selector__menu" role="listbox" aria-label="Chọn sơ đồ">
              {(data.mindMaps || []).map((map) => (
                <button type="button" role="option" aria-selected={map.id === data.id} key={map.id}
                  className={`mm-map-selector__item ${map.id === data.id ? "is-active" : ""}`}
                  onClick={() => { setMapSelectorOpen(false); data.onSelectMap?.(map); }}>
                  <span>{map.title || "Sơ đồ tư duy"}</span>
                  <small>{map.id === data.id ? "Đang mở" : `${map.sources?.length || 0} tài liệu`}</small>
                </button>
              ))}
              <button type="button" className="mm-map-selector__new" onClick={() => { setMapSelectorOpen(false); data.onCreateNew?.(); }} disabled={data.creating}>
                <Icon name="Plus" size={14} /> Tạo sơ đồ mới
              </button>
            </div>
          )}
        </div>
        <span className={`mm-quality-status ${upgradeRequired || degraded ? "is-warning" : ""}`}>
          <Icon name={upgradeRequired || degraded ? "TriangleAlert" : "BadgeCheck"} size={14} />
          {upgradeRequired ? "Sơ đồ cũ · Nâng cấp" : degraded ? "Thiếu liên kết" : "Đã kiểm tra"}
        </span>
        <button type="button" className="mm-context-link" onClick={onRegenerate} disabled={regenerating || generating}>Tạo lại</button>
        <span className={`mm-saved-status ${dirty ? "is-dirty" : ""}`}>
          <Icon name={dirty ? "Pencil" : "Check"} size={14} /> {dirty ? "Chưa lưu" : "Đã lưu"}
        </span>
        {/* Section 3 — a real header-level entry point (not buried in the
            overflow menu, and not the floating zoom toolbar, which stays
            purely pan/zoom). Text hides at narrow widths via the same
            .mm-context-row responsive rule mm-quality-status/mm-saved-status
            already use — aria-label/title stay regardless. */}
        <OperationUsage usage={data?.__usage || data?.usage} className="mm-operation-usage" />
        <button type="button" className="mm-export-trigger" onClick={() => setExportOpen(true)}
          aria-label="Xuất sơ đồ" title="Xuất sơ đồ">
          <Icon name="Download" size={14} /> <span>Xuất</span>
        </button>
        <div className="mm-toolbar-menu-wrap">
          <button type="button" className="mm-overflow-trigger" aria-expanded={contextOverflowOpen} aria-haspopup="menu"
            onClick={() => setContextOverflowOpen((v) => !v)} aria-label="Thêm tùy chọn" title="Thêm tùy chọn"><Icon name="MoreVertical" size={18} /></button>
          {contextOverflowOpen && (
            <div className="mm-toolbar-menu" role="menu">
              <div className="mm-toolbar-menu__group" role="group" aria-label="Hiển thị">
                <div className="mm-toolbar-menu__heading">Hiển thị</div>
                <button role="menuitem" onClick={() => { setContextOverflowOpen(false); resetView(); }}><Icon name="RotateCcw" size={14} /> Đặt lại khung nhìn</button>
                <button role="menuitem" onClick={() => { setContextOverflowOpen(false); mindRef.current?.toCenter(); }}><Icon name="Maximize" size={14} /> Căn giữa</button>
                <button role="menuitem" onClick={() => { setContextOverflowOpen(false); setShowRelations((v) => !v); }} aria-pressed={showRelations}><Icon name="Spline" size={14} /> {showRelations ? "Ẩn quan hệ" : "Hiện quan hệ"}</button>
              </div>
              <div className="mm-toolbar-menu__group" role="group" aria-label="Cấu trúc">
                <div className="mm-toolbar-menu__heading">Cấu trúc</div>
                <button role="menuitem" onClick={() => { setContextOverflowOpen(false); expandCollapseWholeMap(true); }}><Icon name="ChevronsUpDown" size={14} /> Mở rộng tất cả</button>
                <button role="menuitem" onClick={() => { setContextOverflowOpen(false); expandCollapseWholeMap(false); }}><Icon name="ChevronsDownUp" size={14} /> Thu gọn về chủ đề chính</button>
                <button role="menuitem" onClick={() => { setContextOverflowOpen(false); expandToDepth(2); }}><Icon name="Rows3" size={14} /> Mở đến cấp 2</button>
                <button role="menuitem" onClick={() => { setContextOverflowOpen(false); expandToDepth(3); }}><Icon name="Rows3" size={14} /> Mở đến cấp 3</button>
              </div>
              <div className="mm-toolbar-menu__group" role="group" aria-label="Xuất sơ đồ">
                <div className="mm-toolbar-menu__heading">Xuất sơ đồ</div>
                <button role="menuitem" onClick={() => { setContextOverflowOpen(false); setExportOpen(true); }}><Icon name="Download" size={14} /> Mở Export Studio</button>
              </div>
              <div className="mm-toolbar-menu__group" role="group" aria-label="Tác vụ khác">
                <div className="mm-toolbar-menu__heading">Tác vụ khác</div>
                {data?.id && data.id !== "preview" && !data.generating && (
                  <button role="menuitem" onClick={() => { setContextOverflowOpen(false); handleSave(); }} disabled={!dirty || saving}><Icon name="Save" size={14} /> Lưu sơ đồ</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Generating banner — nút Huỷ ngay trong toolbar. `jobLabel` (real
          pipeline stage, e.g. "Dựng khung xương…") is preferred over the
          generic fallback -- covers both "Tạo lại" and a fresh guided
          generation (see modalMapData's `generating` in SidebarRight.jsx). */}
      {generating && (
        <div className="px-3 py-1.5 text-small flex items-center gap-2 border-b"
          style={{ color: "var(--text-secondary)", borderColor: "var(--border-color)", background: "var(--bg-elevated)" }}>
          <Spinner size={12} />
          <span>
            {data?.jobLabel || "Đang tạo sơ đồ…"}{typeof data?.progress === "number" ? ` (${data.progress}%)` : ""}
            {/* Honest mitigation: when the regenerate finishes, SidebarRight swaps
                the record → this viewer re-inits and dirty edits are discarded.
                Full prevention needs dirty-state plumbing to the parent (tracked
                as a known issue) — for now, at least say so. */}
            {dirty ? " — thay đổi chưa lưu sẽ bị thay thế khi bản mới sẵn sàng." : ""}
          </span>
          {typeof data?.onCancel === "function" && (
            <button onClick={data.onCancel} className="underline" style={{ color: "var(--accent)" }}>
              Huỷ
            </button>
          )}
        </div>
      )}
      {/* Failed banner — P2 fix: a failed generation used to have no
          persistent visible surface at all (only a toast that disappears).
          Never shown while a new attempt is already running. */}
      {!generating && data?.jobError && (
        <div className="px-3 py-1.5 text-small flex items-center gap-2 border-b"
          style={{ color: "var(--warn)", borderColor: "var(--border-color)", background: "var(--bg-elevated)" }}>
          <Icon name="TriangleAlert" size={13} />
          <span className="flex-1">{data.jobError}</span>
          {typeof data.onRetryJob === "function" && (
            <button onClick={data.onRetryJob} className="underline" style={{ color: "var(--accent)" }}>
              Thử lại
            </button>
          )}
        </div>
      )}
      {/* Degraded banner giữ từ v2 — ẩn nút Tạo lại khi đang generate (tránh double-trigger) */}
      {degraded && (
        <div className="hidden px-3 py-1.5 text-small flex items-center gap-2 border-b"
          style={{ color: "var(--warn)", borderColor: "var(--border-color)", background: "var(--bg-elevated)" }}>
          <span>Bản đồ chưa đầy đủ{missing.length ? ` (thiếu: ${missing.join(", ")})` : ""}.</span>
          {!generating && (
            <button onClick={onRegenerate} disabled={regenerating} className="underline">
              {regenerating ? "Đang tạo lại…" : "Tạo lại"}
            </button>
          )}
        </div>
      )}
      {/* Canvas + legend — legend là sibling (cleanup xoá innerHTML của container
          nên không được đặt con React bên trong div ref) */}
      <div ref={canvasWrapRef} className="relative flex-1 min-h-0 overflow-hidden mm-canvas-wrap" data-mindmap-render-state={renderState}>
        {renderState !== "ready" && (
          <div className={`mm-render-overlay ${renderState === "error" ? "is-error" : ""}`} data-testid="mindmap-render-overlay" role={renderState === "error" ? "alert" : "status"} aria-live="polite">
            <div className="mm-render-overlay__card">
              {renderState === "error" ? (
                <>
                  <Icon name="TriangleAlert" size={18} />
                  <span>{renderError || "Không thể dựng sơ đồ."}</span>
                  <button type="button" data-action="retry-mindmap-render" onClick={retryRender}>Thử lại</button>
                </>
              ) : (
                <><Spinner size={14} /><span>Đang dựng sơ đồ…</span></>
              )}
            </div>
          </div>
        )}
        {/* Ref target owns h/w-full (normal flow) — mind-elixir sets el.style.position
            = "relative" inline (verified dist), which defeats `absolute inset-0` (inline
            beats class) and collapses the container to content height, breaking scaleFit
            and leaving dead pan area. w/h-full fills the sized wrapper instead. */}
        <div ref={containerRef} className={`h-full w-full min-h-0 me-container${showRelations ? "" : " me-hide-arrows"}`} />
        <div className="mm-legend" aria-hidden="true">
          <span><span className="swatch" style={{ background: "var(--text-primary)" }} />chủ đề</span>
          <span><span className="swatch" style={{ background: "var(--bg-card)", border: "1px solid var(--border-strong)" }} />mục</span>
          <span><span className="font-mono" style={{ color: "var(--accent)" }}>※</span> có trích đoạn</span>
          <span><span className="dash" />quan hệ</span>
          <span className="mm-legend-hint">kéo node → chuyển nhánh · kéo nền → di chuyển</span>
        </div>
        {/* Sprint Omega — floating canvas controls, opposite corner from the
            legend (bottom-right vs. bottom-left) so neither ever overlaps the
            other. Same buttons, same handlers, same aria-labels, same window
            keydown shortcuts (unchanged above) as when this lived in the top
            toolbar row — only the position and container chrome changed.
            `mm-floating-toolbar` sets its own `pointer-events: auto` so its
            buttons stay clickable while the transparent canvas area under and
            around it keeps receiving pan/drag/click exactly as before; the
            cluster's own small footprint (bottom-right corner only) means it
            can never sit over a node near the map's center or along its main
            branches. Keyboard users are unaffected — Tab order and
            `:focus-visible` are unchanged, only DOM position moved. */}
        <div className="mm-floating-toolbar" role="toolbar" aria-label="Điều khiển sơ đồ">
          <button onClick={() => zoomBy(-ZOOM_STEP)} aria-label="Thu nhỏ" title="Thu nhỏ (−)"
            className="icon-btn w-8 h-8">
            <Icon name="ZoomOut" size={15} />
          </button>
          <button onClick={resetZoom} aria-label="Đặt lại thu phóng" title="Đặt lại thu phóng (100%)"
            className="icon-btn h-8 px-2 font-mono text-caption tabular-nums min-w-[42px]">
            {formatZoom(zoom)}
          </button>
          <button onClick={() => zoomBy(+ZOOM_STEP)} aria-label="Phóng to" title="Phóng to (+)"
            className="icon-btn w-8 h-8">
            <Icon name="ZoomIn" size={15} />
          </button>
          <div className="mm-floating-toolbar__sep" aria-hidden="true" />
          <button onClick={fitView} aria-label="Vừa khung" title="Vừa khung (F)" className="icon-btn w-8 h-8">
            <Icon name="Scan" size={14} />
          </button>
          {/* Round 8 REDESIGN — one contextual branch toggle, shown only
              when a node WITH CHILDREN is selected (never for a leaf, never
              with nothing selected — global expand/collapse now lives
              permanently in the overflow menu, see expandCollapseWholeMap).
              The separator moves inside this block too, so nothing selected
              means no dangling divider with an empty slot after it.
              Round 11 (mockup parity) positioning note (still true): sits
              right after zoom+fit, matching the reference image's sequence. */}
          {selectedHasChildren && (
            <>
              <div className="mm-floating-toolbar__sep" aria-hidden="true" />
              <button onClick={toggleSelectedBranch}
                aria-label={selectedExpanded ? "Thu nhánh" : "Mở nhánh"}
                title={selectedExpanded ? "Thu nhánh" : "Mở nhánh"}
                aria-expanded={selectedExpanded}
                className="icon-btn w-8 h-8">
                <Icon name={selectedExpanded ? "ChevronsDownUp" : "ChevronsUpDown"} size={15} />
              </button>
              <div className="mm-floating-toolbar__sep" aria-hidden="true" />
            </>
          )}
        </div>

        {/* Round 10 (mockup parity) — fullscreen moved OUT of the main
            toolbar into its own standalone bottom-right corner control,
            matching the reference image's separate fullscreen button
            (distinct from the toolbar's fit icon). Same native Fullscreen
            API pattern mind-elixir's own built-in toolbar uses internally
            (verified in node_modules/mind-elixir/dist/MindElixir.js:
            `e.el.requestFullscreen()`/`document.exitFullscreen()`) —
            mind-elixir's own toolbar is off (`toolBar: false`) so it
            doesn't double up with this one. Toggles on the map's own
            wrapper (`.mm-canvas-wrap`), not the container ref mind-elixir
            owns (untouched), so this is presentation-only, no library
            state. */}
        <button onClick={toggleFullscreen} aria-pressed={isFullscreen}
          aria-label={isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}
          title={isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}
          className="mm-fullscreen-corner icon-btn w-8 h-8"
          style={{ background: "color-mix(in srgb, var(--bg-card) 92%, transparent)", border: "1px solid var(--border-color)", boxShadow: "var(--shadow-card)" }}>
          <Icon name="Expand" size={14} />
        </button>

        {/* Export Selection Mode — overlaid on the canvas itself (not the
            floating zoom toolbar, which stays pan/zoom-only), matching
            section 5C's bar exactly: "Đã chọn N nhánh · Xóa chọn · Tiếp tục
            · Hủy". Node-detail-drawer suppression and the checkbox
            affordance live in mindmapBranchSelectionMode.js, driven by
            `selectionActiveRef` — this bar is just its visible chrome. */}
        {selectionModeActive && (
          <div className="mm-selection-bar" role="status" aria-live="polite">
            <span>Đã chọn {selectedBranchIds.size} nhánh</span>
            <span className="mm-selection-bar__sep" aria-hidden="true">·</span>
            <button type="button" disabled={!selectedBranchIds.size} onClick={() => setSelectedBranchIds(new Set())}>Xóa chọn</button>
            <span className="mm-selection-bar__sep" aria-hidden="true">·</span>
            <button type="button" disabled={!selectedBranchIds.size}
              onClick={() => { setSelectionModeActive(false); setExportOpen(true); }}>Tiếp tục</button>
            <span className="mm-selection-bar__sep" aria-hidden="true">·</span>
            <button type="button" onClick={() => { setSelectionModeActive(false); setSelectedBranchIds(new Set()); setExportOpen(true); }}>Hủy</button>
          </div>
        )}
      </div>

      <ExportStudioDialog
        open={exportOpen && !selectionModeActive}
        onClose={() => setExportOpen(false)}
        mind={mindRef.current}
        mapId={data?.id}
        title={data?.title}
        selectedNodeId={controller?.selected?.id}
        selectedBranchIds={selectedBranchIds}
        onRequestBranchSelection={() => { setExportOpen(false); setSelectionModeActive(true); }}
      />
    </div>
  );
}
