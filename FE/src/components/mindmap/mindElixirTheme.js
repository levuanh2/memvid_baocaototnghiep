// Extracted from MindElixirView.jsx (Round 2 — multi-branch offscreen
// export needs the SAME theme, and importing it from MindElixirView.jsx
// directly would create a cycle: MindElixirView -> ExportStudioDialog ->
// mindmapImageExport -> MindElixirView. MindElixirView.jsx re-exports THEME
// from here so `theme.test.js`'s existing `import { THEME } from
// "./MindElixirView"` keeps working unchanged.
//
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
