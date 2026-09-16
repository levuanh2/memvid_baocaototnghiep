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
const PALETTE = ["#5C6B7A", "#1F4033", "#B5821F", "#8A4A3E", "#4A5A8A", "#A06A3B"];

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
    // Final sprint: root is now typographic (Spectral + bronze rule, see
    // mindmap.css's `!important` override on `.me-container me-root me-tpc`)
    // — these three stay set only because mind-elixir's own stylesheet has
    // no fallback for an undefined var (an invalid declaration would break
    // the rule entirely); their VALUES no longer paint anything, the
    // override always wins.
    "--root-color": "var(--bg-base)",
    "--root-bgcolor": "var(--text-primary)",
    "--root-border-color": "transparent",
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
  const [showRelations, setShowRelations] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);              // readout — nguồn sự thật là bus "scale"
  // Lỗi Lưu/Xuất PNG. Trước đây CHỈ có toast — toast tự tắt sau vài giây, mà lỗi lưu thì
  // map vẫn đang dirty: user quay đi quay lại là mất luôn lý do hỏng, tưởng đã lưu xong.
  // Banner ở lại tới khi tự đóng hoặc tới lần thao tác sau.
  const [errorMsg, setErrorMsg] = useState(null);

  const degraded = Boolean(data?.generator?.degraded);
  const missing = data?.generator?.missing || [];
  // "Tạo lại" đang chạy nền (SidebarRight bơm generating/progress/onCancel vào
  // data) — banner + nút Huỷ ngay trong toolbar.
  const generating = Boolean(data?.generating);

  // (re)init khi đổi record — KHÔNG còn phụ thuộc mount/unmount của một modal:
  // mode switch (Chat ⇄ MindMap) không unmount component này nữa (WorkspaceContainer
  // giữ cả ba mode luôn mounted), nên đây là NƠI DUY NHẤT mind-elixir tái tạo,
  // và chỉ khi `data?.id` thật sự đổi (tài liệu/mindmap khác) — không phải khi
  // chuyển tab.
  useEffect(() => {
    if (!containerRef.current || !data) return;
    setDirty(false);
    setSaving(false);
    setZoom(1);
    setErrorMsg(null);
    const { mindData, sidecar } = recordToMindElixir(data);
    const mind = new MindElixir({
      el: containerRef.current,
      direction: MindElixir.SIDE,
      editable: true,       // gate kéo node (re-parent/đổi thứ tự) — `draggable` đã deprecated
      contextMenu: true,
      toolBar: false,       // toolbar riêng của mình
      keypress: true,
      allowUndo: true,
      // 2 = chuột PHẢI box-select → kéo-TRÁI trên nền = pan canvas (trực quan hơn
      // mặc định bắt Space+kéo).
      mouseSelectionButton: 2,
      theme: THEME,
    });
    mind.init(mindData);
    mindRef.current = mind;
    controller.registerMindInstance(mind, sidecar);
    setZoom(mind.scaleVal || 1);

    // Readout thu phóng. Thư viện fire "scale" (number) ở MỌI đường đổi scale —
    // nút bấm, ctrl+wheel, VÀ scaleFit() (verified dist/MindElixir.js: `fn` kết thúc
    // bằng `this.bus.fire("scale", n)`) — nên chỉ cần nghe một chỗ này.
    // KHÔNG kẹp giá trị ở đây: scaleFit() không đọc scaleMin nên map rất lớn có thể
    // xuống dưới 0.2; kẹp readout sẽ hiện số SAI so với map đang vẽ.
    mind.bus.addListener("scale", (v) => setZoom(v));
    mind.bus.addListener("selectNodes", (nodes) => controller.onNodeSelected(nodes));
    mind.bus.addListener("operation", () => setDirty(true));

    return () => {
      // mind-elixir's own destroy() unregisters the bus listeners above AND the
      // container keydown handler it wires internally (init() -> On()); without
      // it, re-init on a data.id change (e.g. regenerate) would leave the old
      // instance's listeners attached to the same container DOM node, stacking
      // duplicate handlers on every re-init.
      mindRef.current?.destroy?.();
      mindRef.current = null;
      containerRef.current && (containerRef.current.innerHTML = "");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

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
      mind.layout?.();
      mind.linkDiv?.();
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
  // paths as the dark-mode bug above — reproduced live: connectors stay
  // broken indefinitely after switching into the MindMap tab, with nothing
  // to self-correct them (mind-elixir never reruns layout just because a
  // hidden ancestor became visible). A ResizeObserver on the container
  // catches that hidden -> visible transition (display:none -> real size
  // fires a resize entry) and reruns layout()+linkDiv() once genuine
  // geometry exists; the width/height>0 guard skips the initial 0x0 report
  // while still hidden.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const mind = mindRef.current;
      if (!mind) return;
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        mind.layout?.();
        mind.linkDiv?.();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
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
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b flex-shrink-0"
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
        <div className="px-3 py-1.5 text-small flex items-center gap-2 border-b"
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
          <button onClick={resetView} aria-label="Đặt lại khung nhìn" title="Đặt lại khung nhìn (0)" className="icon-btn w-8 h-8">
            <Icon name="RotateCcw" size={14} />
          </button>
          <button onClick={() => mindRef.current?.toCenter()} aria-label="Căn giữa" title="Căn giữa" className="icon-btn w-8 h-8">
            <Icon name="Maximize" size={15} />
          </button>
          <div className="mm-floating-toolbar__sep" aria-hidden="true" />
          {/* Round 8 — Expand/Collapse. Scoped to the selected node's subtree
              when one is selected, else the whole map (see expandCollapseAll
              above for the full public-API feasibility note). */}
          <button onClick={expandAll} aria-label={expandCollapseLabel.expand} title={expandCollapseLabel.expand}
            className="icon-btn w-8 h-8">
            <Icon name="ChevronsUpDown" size={15} />
          </button>
          <button onClick={collapseAll} aria-label={expandCollapseLabel.collapse} title={expandCollapseLabel.collapse}
            className="icon-btn w-8 h-8">
            <Icon name="ChevronsDownUp" size={15} />
          </button>
          <div className="mm-floating-toolbar__sep" aria-hidden="true" />
          <button onClick={() => setShowRelations((v) => !v)} aria-pressed={showRelations}
            aria-label="Bật/tắt quan hệ" title="Quan hệ" className="icon-btn w-8 h-8"
            style={{ color: showRelations ? "var(--text-primary)" : "var(--text-secondary)", opacity: showRelations ? 1 : 0.55 }}>
            <Icon name="Spline" size={15} />
          </button>
          <button onClick={handleExportPng} aria-label="Xuất PNG" title="Xuất PNG" className="icon-btn w-8 h-8">
            <Icon name="Download" size={14} />
          </button>
          {/* Fullscreen (IA pass round 5, item 7) — same native Fullscreen
              API pattern mind-elixir's own built-in toolbar uses internally
              (verified in node_modules/mind-elixir/dist/MindElixir.js:
              `e.el.requestFullscreen()`/`document.exitFullscreen()`), just
              wired to this app's own floating toolbar instead — mind-
              elixir's own toolbar is off (`toolBar: false`) so it doesn't
              double up with this one. Toggles on the map's own wrapper
              (`.mm-canvas-wrap`), not the container ref mind-elixir owns
              (untouched), so this is presentation-only, no library state. */}
          <button onClick={toggleFullscreen} aria-pressed={isFullscreen}
            aria-label={isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}
            title={isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"} className="icon-btn w-8 h-8">
            <Icon name="Expand" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
