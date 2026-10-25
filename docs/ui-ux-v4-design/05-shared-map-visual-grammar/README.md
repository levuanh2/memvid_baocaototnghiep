# 05 — Shared Map Visual Grammar Spec (Phase B, Agy)

**Author**: Independent Product & Architecture Reviewer (Antigravity / Agy)
**Baseline**: `main` @ `fb0c2f4dec90b6bb8aea62e71e1aa9a63db2a1c3` (incorporates PR #87 & PR #88)
**Target Branch**: `docs/ui-ux-v4-design` in worktree `E:\memvid_NCKH\MemVid_BaoCaoTotNghiep\.worktrees\ui-ux-v4-design`
**Governing Principles**: [`01-option-b-design-principles.md`](../01-option-b-design-principles.md)

---

## 1. Executive Summary & Core Objective

The MemVidX product experience currently suffers from a pronounced **Dual-Engine Map Schism** (identified in Phase A audit as `UX-005`):
- `/app` (Mind Map tab): Powered by `mind-elixir` (custom HTML elements `<me-tpc>`, dynamic CSS variables, branch-colored bezier curves, rich export studio).
- `/app/study/map/:id` (Study Map page): Powered by `react-d3-tree` (pure SVG `<circle>` nodes with unpadded text, hardcoded character truncation at 46 chars, uniform gray links).

Under **Option B**, the architectural decision is clear: **preserve both underlying engines** (Option C engine unification is explicitly deferred to avoid destabilizing the headless export pipeline and database contracts), but **establish a rigorous Shared Visual Grammar**. When a learner moves between the AI Workspace and the Study Center, maps must read as **stylistic dialects of the exact same visual identity**, rather than two alien applications built by disconnected teams.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                OPTION B SHARED MAP GRAMMAR                             │
├───────────────────────────────────────────┬────────────────────────────────────────────┤
│         MindElixirView.jsx (/app)         │      StudyMapView.jsx (/app/study/map)     │
│             [mind-elixir]                 │               [react-d3-tree]              │
├───────────────────────────────────────────┴────────────────────────────────────────────┤
│                       SHARED DESIGN TOKENS & VISUAL FOUNDATION                         │
│  • Surface: Learning Base (--bg-base: #F4F8FC / #15233B) + Dot Grid Canvas             │
│  • Primary Accent: Learning Blue (--accent: #126CF2 / #6EA8FF)                        │
│  • Selection Ring: 2px solid var(--accent) + 3px subtle halo (Fixes muddy green seam)  │
│  • Node Anatomy: Root (Accent) → Section (Card) → Concept (Bordered) → Leaf (Muted)    │
│  • Typography: Sans-serif (Aptos / Segoe UI / Inter) — Georgia reserved for prose      │
│  • Contrast: Connectors ≥ 3:1 against canvas; text ≥ 4.5:1 WCAG AA                    │
│  • Mobile Safety: Min 11px font floor, 44x44px touch targets, Depth-1 default         │
├───────────────────────────────────────────┬────────────────────────────────────────────┤
│           ENGINE-SPECIFIC SPECIALTY       │          ENGINE-SPECIFIC SPECIALTY         │
│  • Multi-branch cubic bezier coloring     │  • Ancestor/descendant lineage focus dim   │
│  • Mind Elixir drag-reorganize & edit     │  • Multi-layout toggle (step, diagonal)    │
│  • Node-detail inspector docked right     │  • Native SVG presentation mode            │
│  • Exact-Node V3 raster/vector export     │  • High-resolution PNG/SVG quick-export    │
└───────────────────────────────────────────┴────────────────────────────────────────────┘
```

---

## 2. Document Suite Structure

This visual grammar specification is organized into three detailed documents:

1. [`visual-grammar-spec.md`](./visual-grammar-spec.md)
   The normative visual tokens, node hierarchy taxonomy, connector geometry, typography rules, state machine (Default, Hover, Selected, Focused, Collapsed, Searching), light/dark token tables, and mobile viewport adaptations.

2. [`before-after-comparison.md`](./before-after-comparison.md)
   Side-by-side concrete BEFORE and AFTER visual breakdowns using an identical canonical study dataset (*"Hệ điều hành: Quản lý Tiến trình & Đa nhiệm"*), comparing DOM attributes, SVG elements, geometry, and rendering metrics.

3. [`engine-boundaries-and-export-guardrails.md`](./engine-boundaries-and-export-guardrails.md)
   Rigorous boundary classification:
   - Shared visual rules (both engines adopt).
   - Engine-specific behavior (retained by design).
   - Features that must stay intentionally different.
   - Known engine incompatibilities.
   - **MindMap V3 Export Fidelity Guardrail**: Deep-dive audit ensuring zero regression to the pixel-perfect export pipeline (`ExportStudioDialog.jsx`, `mindmapImageExport.js`, `pdf_serializer.py`).

---

## 3. High-Priority Migration Seams Closed by this Spec

This specification directly resolves four major visual inconsistencies identified in the Phase A audit and Option B principles:

1. **Selection Ring Token Seam (`UX-006`)**:
   - *Current*: `mindElixirTheme.js` points `--selected: var(--forest)` (`#1F4033`, dark muddy green) and `--accent-color: var(--forest)`.
   - *Spec*: Migrated to `var(--accent)` (`#126CF2` in light mode, `#6EA8FF` in dark mode) with a 3px `var(--accent-subtle)` outer ring.
2. **Typography Schism (`UX-ADJ-009`)**:
   - *Current*: `StudyMapView.jsx` hardcoded `fontFamily: "Spectral, Georgia, serif"` for graph nodes while `MindElixirView.jsx` used system sans-serif.
   - *Spec*: Both engines adopt the shared sans-serif stack (`Aptos, -apple-system, Segoe UI, sans-serif`). Georgia is reserved exclusively for long-form reading prose in Chat and Summary.
3. **Hardcoded Text Slicing (`UX-ADJ-010`)**:
   - *Current*: `StudyMapView.jsx` arbitrarily sliced strings at 46 characters (`nodeDatum.name.slice(0, 46)`), abruptly chopping Vietnamese technical phrases.
   - *Spec*: Structured multiline label bounding box with proportional max-width and tooltip expansion.
4. **Canvas Background Disconnect**:
   - *Current*: MindElixir uses `.me-container` with background options; StudyMapView renders inside an opaque `.surface-card` card.
   - *Spec*: Both canvases share the foundational `var(--bg-base)` background with the standardized 24px subtle dot lattice.
