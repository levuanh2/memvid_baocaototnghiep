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
import { snapdom } from "@zumer/snapdom";
import { recordToMindElixir, mindElixirToRecord } from "../../utils/mindElixirAdapter";
import { nextScale, formatZoom, viewportKeyAction, ZOOM_STEP } from "../../utils/mindmapViewport";
import { updateMindmap } from "../../utils/api";
import { toast } from "../ui/Toaster";
import { Icon } from "../ui/Icon";
import Spinner from "../ui/Spinner";
import "./mindmap.css";

// Palette nhánh: archival ink hexes (Phòng đọc theme) — trước đây sống ở
// constants.js::BRANCH_COLORS (file đã xoá cùng ReactFlow view ở Task 9).
// Wave 5: this feeds mind-elixir's OWN per-branch line/border coloring
// directly (`theme.palette`, cycled by branch index — see mind-elixir's
// `MindElixir.js` generateMainBranch/`In` function; NOT unstyled-library-
// default gray, contrary to an earlier draft audit — verified by reading
// the actual bundled source, not assumed). The one real fix: the old array
// included `#B23A2E` — the EXACT seal-red value now reserved for
// provenance only (Signature Contract §1) — meaning a mindmap branch could
// already render identically to a citation/provenance signal by pure
// coincidence. Replaced with a muted seal-adjacent tone that reads as the
// same archival-ink family without the collision; forest/bronze slots now
// use the Signature Contract's own exact values for direct consistency.
const PALETTE = ["#126CF2", "#FF9800", "#18B86A", "#8C4DFF", "#F2353A", "#2B9CF3", "#7B61FF", "#16A085"];

// MindElixir.css tiêu thụ đủ bộ var dưới đây KHÔNG có fallback — thiếu var nào
// là declaration đó invalid và spacing/màu sụp đổ. Phải set đủ (guard bằng test
// THEME_REQUIRED_VARS). Màu để dạng var(--token) → tự flip light/dark theo html.dark.
export const THEME = {
  name: "PhongDoc",
  palette: PALETTE,
  cssVar: {
    // hình học — nhịp lề giấy Phòng đọc, card chứ không pill
    "--map-padding": "60px 100px",
    "--main-gap-x": "72px",
    "--main-gap-y": "36px",
    "--node-gap-x": "32px",
    "--node-gap-y": "8px",
    "--root-radius": "8px",
    "--main-radius": "6px",
    "--topic-padding": "4px",
    // Root identity: blue action surface with white type. These values stay
    // explicit because Mind Elixir has no fallback for missing cssVar entries.
    "--root-color": "#FFFFFF",
    "--root-bgcolor": "var(--accent)",
    "--root-border-color": "var(--accent)",
    // section = thẻ giấy nổi, viền đậm
    "--main-color": "var(--text-primary)",
    "--main-bgcolor": "var(--bg-card)",
    "--main-border": "1px solid var(--border-strong)",
    "--main-bgcolor-transparent": "transparent",
    // idea/detail = chữ trần trên nền
    "--color": "var(--text-secondary)",
    "--bgcolor": "transparent",
    // Sprint F: selection is an action/state signal, not provenance — forest
    // ring (Paper & Graphite Signature Contract §1), not seal red. Citation
    // tags (mindmap.css's `.tags span`) stay on `--seal` deliberately; this
    // is the one place in the map that should NOT read as "a citation."
    "--selected": "var(--forest)",
    "--accent-color": "var(--forest)",
    // context-menu panel
    "--panel-color": "var(--text-primary)",
    "--panel-bgcolor": "var(--bg-card)",
    "--panel-border-color": "var(--border-color)",
  },
};

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
  const [showRelations, setShowRelations] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);              // readout — nguồn sự thật là bus "scale"
  // Lỗi Lưu/Xuất PNG. Trước đây CHỈ có toast — toast tự tắt sau vài giây, mà lỗi lưu thì
  // map vẫn đang dirty: user quay đi quay lại là mất luôn lý do hỏng, tưởng đã lưu xong.
  // Banner ở lại tới khi tự đóng hoặc tới lần thao tác sau.
  const [errorMsg, setErrorMsg] = useState(null);
  const [contextOverflowOpen, setContextOverflowOpen] = useState(false);
  const [mapSelectorOpen, setMapSelectorOpen] = useState(false);

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
    el.querySelectorAll(".lines path").forEach((p) => {
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
    mind.layout?.();
    mind.linkDiv?.();
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
    const stillBroken = Array.from(el.querySelectorAll(".lines path"))
      .some((p) => (p.getAttribute("d") || "").includes("NaN"));
    if (stillBroken) return false;
    if (pendingFitRef.current) {
      pendingFitRef.current = false;
      mind.scaleFit?.();
    }
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
    const deadline = (typeof performance !== "undefined" ? performance.now() : Date.now()) + 120000;
    const stop = () => { cancelled = true; pollActiveRef.current = false; if (timer) clearTimeout(timer); };
    const poll = () => {
      if (cancelled) return;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (fitIfReady() || now >= deadline) { pollActiveRef.current = false; return; }
      timer = setTimeout(poll, 16);
    };
    timer = setTimeout(poll, 16);
    return stop;
  }, [fitIfReady]);

  // Create once per mounted viewer. Switching saved maps refreshes this same
  // public Mind Elixir instance instead of rebuilding the canvas.
  useEffect(() => {
    if (!containerRef.current || !data) return;
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
      mind.bus.addListener("operation", () => setDirty(true));
    } else {
      mind.refresh?.(mindData);
      mind.clearHistory?.();
    }
    sanitizeHiddenNaNPaths(containerRef.current);
    controller.registerMindInstance(mind, sidecar);
    setZoom(mind.scaleVal || 1);
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
    return startFitPoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id, startFitPoll]);

  useEffect(() => () => {
    pendingFitRef.current = false;
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
      if (!mind) return;
      mind.changeTheme?.(THEME);
    });
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

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
      if (e.button !== 0 || e.target.closest("me-tpc, me-epd, .mm-floating-toolbar, .mm-legend, .mm-fullscreen-corner")) return;
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
  // Scoped to the selected node's subtree when one is selected (the
  // "targeting only descendants of the selected node" capability), falling
  // back to the map's own root (`mind.nodeData` — a typed, public instance
  // property) for a real "expand/collapse everything".
  const expandCollapseAll = useCallback((isExpand) => {
    const mind = mindRef.current;
    if (!mind) return;
    const targetId = controller?.selected?.id || mind.nodeData?.id;
    if (!targetId) return;
    const topic = mind.findEle?.(targetId);
    if (!topic) return;
    mind.expandNodeAll(topic, isExpand);
  }, [controller]);
  const expandAll = useCallback(() => expandCollapseAll(true), [expandCollapseAll]);
  const collapseAll = useCallback(() => expandCollapseAll(false), [expandCollapseAll]);
  const expandCollapseLabel = controller?.selected?.id
    ? { expand: "Mở rộng nhánh đã chọn", collapse: "Thu gọn nhánh đã chọn" }
    : { expand: "Mở rộng tất cả", collapse: "Thu gọn tất cả" };

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

  const handleExportPng = async () => {
    const mind = mindRef.current;
    // Chụp mind.map (.map-canvas) chứ KHÔNG phải mind.nodes: rule layout then chốt
    // là descendant selector `.map-canvas me-nodes{display:flex}` — clone me-nodes
    // tách khỏi .map-canvas sẽ không match và PNG vỡ (text dồn 1 dòng).
    const target = mind?.map;
    if (!target) return;

    setErrorMsg(null);
    try {
      const backgroundColor =
        getComputedStyle(document.documentElement).getPropertyValue("--bg-base").trim() || "#ECE7DB";
      const result = await snapdom(target, { backgroundColor, scale: 2 });
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const safeTitle = String(data?.title || "mindmap").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60);
      await result.download({ format: "png", filename: `mindmap-${safeTitle}-${date}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Không xuất được PNG: ${message}`);
    }
  };

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
      <div className="mm-context-row">
        <div className="mm-map-selector">
          <button type="button" className="mm-map-selector__trigger" aria-haspopup="listbox"
            aria-expanded={mapSelectorOpen} onClick={() => setMapSelectorOpen((v) => !v)}>
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
        <button type="button" className="mm-context-action" onClick={data.onCreateNew} disabled={data.creating}
          aria-label="Tạo sơ đồ mới" title="Tạo sơ đồ mới"><Icon name="Plus" size={18} /></button>
        <span className={`mm-quality-status ${upgradeRequired || degraded ? "is-warning" : ""}`}>
          <Icon name={upgradeRequired || degraded ? "TriangleAlert" : "BadgeCheck"} size={14} />
          {upgradeRequired ? "Sơ đồ cũ · Nâng cấp" : degraded ? "Thiếu liên kết" : "Đã kiểm tra"}
        </span>
        <button type="button" className="mm-context-link" onClick={onRegenerate} disabled={regenerating || generating}>Tạo lại</button>
        <span className={`mm-saved-status ${dirty ? "is-dirty" : ""}`}>
          <Icon name={dirty ? "Pencil" : "Check"} size={14} /> {dirty ? "Chưa lưu" : "Đã lưu"}
        </span>
        <div className="mm-toolbar-menu-wrap">
          <button type="button" className="mm-overflow-trigger" aria-expanded={contextOverflowOpen} aria-haspopup="menu"
            onClick={() => setContextOverflowOpen((v) => !v)} aria-label="Thêm tùy chọn" title="Thêm tùy chọn"><Icon name="MoreVertical" size={18} /></button>
          {contextOverflowOpen && (
            <div className="mm-toolbar-menu" role="menu">
              {data?.id && data.id !== "preview" && !data.generating && (
                <button role="menuitem" onClick={handleSave} disabled={!dirty || saving}><Icon name="Save" size={14} /> Lưu sơ đồ</button>
              )}
              <button role="menuitem" onClick={resetView}><Icon name="RotateCcw" size={14} /> Đặt lại khung nhìn</button>
              <button role="menuitem" onClick={() => mindRef.current?.toCenter()}><Icon name="Maximize" size={14} /> Căn giữa</button>
              <button role="menuitem" onClick={() => setShowRelations((v) => !v)} aria-pressed={showRelations}><Icon name="Spline" size={14} /> {showRelations ? "Ẩn quan hệ" : "Hiện quan hệ"}</button>
              <button role="menuitem" onClick={handleExportPng}><Icon name="Download" size={14} /> Xuất PNG</button>
            </div>
          )}
        </div>
      </div>
      {/* Generating banner — nút Huỷ ngay trong toolbar */}
      {generating && (
        <div className="px-3 py-1.5 text-small flex items-center gap-2 border-b"
          style={{ color: "var(--text-secondary)", borderColor: "var(--border-color)", background: "var(--bg-elevated)" }}>
          <Spinner size={12} />
          <span>
            Đang tạo lại sơ đồ…{typeof data?.progress === "number" ? ` (${data.progress}%)` : ""}
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
      <div ref={canvasWrapRef} className="relative flex-1 min-h-0 overflow-hidden mm-canvas-wrap">
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
          <div className="mm-floating-toolbar__sep" aria-hidden="true" />
          {/* Round 8 — Expand/Collapse. Scoped to the selected node's subtree
              when one is selected, else the whole map (see expandCollapseAll
              above for the full public-API feasibility note).
              Round 11 (mockup parity) — reordered to sit right after zoom+fit,
              matching the reference image's exact sequence (was after a
              reset/center pair that has no mockup equivalent — those two
              moved after this, not removed; still real, working
              functionality). */}
          <button onClick={expandAll} aria-label={expandCollapseLabel.expand} title={expandCollapseLabel.expand}
            className="icon-btn w-8 h-8">
            <Icon name="ChevronsUpDown" size={15} />
          </button>
          <button onClick={collapseAll} aria-label={expandCollapseLabel.collapse} title={expandCollapseLabel.collapse}
            className="icon-btn w-8 h-8">
            <Icon name="ChevronsDownUp" size={15} />
          </button>
          <div className="mm-floating-toolbar__sep" aria-hidden="true" />
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

      </div>
    </div>
  );
}
