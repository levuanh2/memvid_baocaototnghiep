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
    // root = khối mực (ink), chữ màu giấy
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
  const [showRelations, setShowRelations] = useState(true);
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
      {/* Toolbar — chrome Phòng đọc: kicker mono + tiêu đề Spectral, control là icon-btn */}
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
        <button onClick={() => zoomBy(-ZOOM_STEP)} aria-label="Thu nhỏ" title="Thu nhỏ (−)"
          className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-text-secondary">
          <Icon name="ZoomOut" size={16} />
        </button>
        {/* Readout — vừa là mức thu phóng hiện tại, vừa là affordance dạy user rằng
            canvas là một khung nhìn di chuyển được (không phải ảnh tĩnh). */}
        <button onClick={resetZoom} aria-label="Đặt lại thu phóng" title="Đặt lại thu phóng (100%)"
          className="px-1.5 py-1 rounded hover:bg-[var(--bg-hover)] font-mono text-caption tabular-nums text-text-secondary min-w-[46px]">
          {formatZoom(zoom)}
        </button>
        <button onClick={() => zoomBy(+ZOOM_STEP)} aria-label="Phóng to" title="Phóng to (+)"
          className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-text-secondary">
          <Icon name="ZoomIn" size={16} />
        </button>
        <button onClick={fitView} aria-label="Vừa khung" title="Vừa khung (F)"
          className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-[var(--bg-hover)] text-small text-text-secondary">
          <Icon name="Scan" size={14} /> Vừa khung
        </button>
        <button onClick={resetView} aria-label="Đặt lại khung nhìn" title="Đặt lại khung nhìn (0)"
          className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-[var(--bg-hover)] text-small text-text-secondary">
          <Icon name="RotateCcw" size={14} /> Đặt lại
        </button>
        <button onClick={() => mindRef.current?.toCenter()} aria-label="Căn giữa" title="Căn giữa"
          className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-text-secondary">
          <Icon name="Maximize" size={16} />
        </button>
        <button onClick={() => setShowRelations((v) => !v)} aria-pressed={showRelations}
          aria-label="Bật/tắt quan hệ" title="Quan hệ"
          className="p-1.5 rounded hover:bg-[var(--bg-hover)]"
          style={{ color: showRelations ? "var(--text-primary)" : "var(--text-secondary)", opacity: showRelations ? 1 : 0.5 }}>
          <Icon name="Spline" size={16} />
        </button>
        <button onClick={handleExportPng} aria-label="Xuất PNG" title="Xuất PNG"
          className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-[var(--bg-hover)] text-small text-text-secondary">
          <Icon name="Download" size={14} /> Xuất PNG
        </button>
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
      <div className="relative flex-1 min-h-0 overflow-hidden">
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
      </div>
    </div>
  );
}
