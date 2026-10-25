# 05.1 — Visual Grammar Specification: Tokens, Geometry & States

**Author**: Independent Product & Architecture Reviewer (Antigravity / Agy)
**Target Surface**: `MindElixirView.jsx` (`mind-elixir`) and `StudyMapView.jsx` (`react-d3-tree`)
**Design Status**: Normative Visual Specification (Phase B)

---

## 1. Unified Design Tokens (Light & Dark Foundations)

Both engines must consume the application's shared token variables rather than hardcoded hex values or unmapped library defaults.

| Semantic Role | Token Name | Light Theme Value | Dark Theme Value | Contrast Ratio (vs Canvas) |
| :--- | :--- | :--- | :--- | :--- |
| **Canvas Background** | `--bg-base` | `#F4F8FC` | `#15233B` | Base surface |
| **Card / Surface Fill** | `--bg-card` | `#FFFFFF` | `#1B2C49` | Elevated surface |
| **Hover Surface** | `--bg-hover` | `#EBF2FA` | `#23385D` | Interactive feedback |
| **Primary Accent** | `--accent` | `#126CF2` | `#6EA8FF` | `4.8:1` (Light) / `7.1:1` (Dark) |
| **Accent Hover** | `--accent-hover` | `#0059D6` | `#8CB9FF` | Primary button hover |
| **Accent Subtle (Halo)** | `--accent-subtle` | `#EAF3FF` | `#1C3259` | Selection aura / ring |
| **Primary Text (Ink)** | `--text-primary` | `#102A5D` | `#ECE7DB` | `11.5:1` (Light) / `12.2:1` (Dark) |
| **Secondary Text** | `--text-secondary` | `#334E68` | `#C4D1E5` | `7.2:1` (Light) / `8.6:1` (Dark) |
| **Muted Metadata** | `--text-muted` | `#587095` | `#AFC1DD` | `4.6:1` (Light) / `6.2:1` (Dark) |
| **Default Border** | `--border-color` | `#D2DFED` | `#2D3E5D` | Card boundary |
| **Structural Border** | `--border-strong` | `#9BB5D1` | `#41577D` | `3.2:1` (Connector stroke) |
| **Semantic Error** | `--err` | `#F1333A` | `#D86A53` | Distinct from accent |
| **Semantic Provenance**| `--seal` | `#B23A2E` | `#E06D53` | Reserved for citations only |

### Branch Accent Spectrum (Cycled for Major Sections)
MindElixir cycles through branches; StudyMapView can optionally color section clusters. To prevent collision with `--err` and `--seal`, the shared branch palette is strictly calibrated:

```css
/* Shared Safe Branch Palette (8 stems) */
--branch-1: #126CF2; /* Brand Blue */
--branch-2: #E67E22; /* Warm Amber */
--branch-3: #10B981; /* Emerald Green */
--branch-4: #8B5CF6; /* Iris Purple */
--branch-5: #0284C7; /* Ocean Sky */
--branch-6: #D946EF; /* Fuchsia */
--branch-7: #0D9488; /* Deep Teal */
--branch-8: #6366F1; /* Indigo */
```

---

## 2. Four-Tier Node Hierarchy Taxonomy

Documents naturally exhibit hierarchical stratification: **Document (Root) → Chapter/Section → Concept → Detail/Example**. Both engines must visually reflect this hierarchy with consistent proportional sizing and typography.

```
 LEVEL 0: ROOT
 ┌─────────────────────────────────────────────────────────┐
 │  📘 HỆ ĐIỀU HÀNH HIỆN ĐẠI                                │  [Solid Accent Card]
 └────────────────────────────┬────────────────────────────┘
                              │ 2.0px bezier connector
 LEVEL 1: SECTION             ▼
 ┌─────────────────────────────────────────────────────────┐
 │  1. Quản lý Tiến trình & Đa nhiệm                       │  [Bordered Surface Card]
 └─────────────┬─────────────────────────────┬─────────────┘
               │ 1.5px branch connector      │
 LEVEL 2:      ▼                             ▼
 CONCEPT  ┌─────────────────────────┐   ┌─────────────────────────┐
          │  Khái niệm Tiến trình   │   │  Mô hình Đa luồng       │  [Soft Concept Pill]
          └────────────┬────────────┘   └─────────────────────────┘
                       │ 1.2px connector
 LEVEL 3:              ▼
 LEAF     • Không gian địa chỉ ảo, PCB  [Muted Detail / Bullet]
```

### Detailed Node Specifications

| Level & Role | Semantic Meaning | MindElixir Representation | StudyMapView (SVG) Representation | Typography & Metrics |
| :--- | :--- | :--- | :--- | :--- |
| **Level 0: Root** | Whole Document / Central Subject | Rounded Rect Card (`<me-tpc>`). Fill: `var(--accent)`, Color: `#FFFFFF`, Border: `none`, Radius: `8px`. | Rounded Rect `<rect rx="8" ry="8">` or Anchor Circle (`r: 9px`). Fill: `var(--accent)`. Label: bold white text in badge. | **16px (1rem)**, Weight: `600`, Line-height: `1.25`. Padding: `8px 16px`. |
| **Level 1: Section** | Major Chapters / Primary Outline | Elevated Card (`<me-tpc>`). Fill: `var(--bg-card)`, Color: `var(--text-primary)`, Border: `1px solid var(--border-strong)`, Radius: `6px`. | Outer anchor circle (`r: 7px`, fill: `var(--bg-card)`, stroke: `var(--accent)`, width: `2px`). Text adjacent with protective halo. | **14px (0.875rem)**, Weight: `600`, Line-height: `1.3`. Padding: `6px 12px`. |
| **Level 2: Concept** | Core Principles / Entities | Subtopic Pill (`<me-tpc>`). Fill: `var(--bg-card)`, Color: `var(--text-primary)`, Border: `1px solid var(--border-color)`, Radius: `4px`. | Concept circle (`r: 5px`, fill: `var(--bg-card)`, stroke: `var(--text-muted)`, width: `1.5px`). | **13px (0.8125rem)**, Weight: `500`, Line-height: `1.3`. Padding: `4px 8px`. |
| **Level 3+: Leaf** | Examples, Facts, Citations | Compact text block. Fill: `transparent`, Color: `var(--text-secondary)`, Border-bottom: `1px solid var(--branch-color)`. | Detail circle (`r: 3.5px`, fill: `var(--bg-base)`, stroke: `var(--border-color)`, width: `1.2px`). | **12px (0.75rem)**, Weight: `400`, Line-height: `1.35`. Padding: `2px 6px`. |

---

## 3. Typography & Text Wrapping Rules

### Font Stack Alignment
- **Global Rule**: All graph nodes, labels, and chrome MUST use the application's primary UI sans-serif stack:
  ```css
  font-family: Aptos, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  ```
- **Prose Reservation**: The serif font family (`Spectral, Georgia, serif`) is strictly reserved for long-form reading passages in Chat responses and Summary Pane text. `StudyMapView.jsx` must drop its hardcoded `fontFamily: "Spectral, Georgia, serif"` for graph nodes to restore parity with the workspace.

### Text Wrapping & Truncation
1. **MindElixir (`<me-tpc>`)**:
   - `max-width: 260px;` (desktop) / `180px;` (mobile).
   - `word-break: break-word;` with natural multiline wrap up to 3 lines before subtle ellipsis.
2. **StudyMapView (`<text>` in SVG)**:
   - Eliminate `String(nodeDatum.name).slice(0, 46)`.
   - Calculate text length dynamically. If text exceeds 32 characters, render two `<tspan>` rows:
     ```jsx
     <text x={m.r + 8} y={-4} style={{ fontSize: m.text, fontWeight: m.weight, fill: "var(--text-primary)" }}>
       {line1}
       {line2 && <tspan x={m.r + 8} dy={m.text * 1.2}>{line2}</tspan>}
     </text>
     ```
   - **Text Protection Halo**: In SVG, lines often pass behind text. Retain and standardize the protective halo:
     ```css
     paint-order: stroke;
     stroke: var(--bg-card);
     stroke-width: 3.5px;
     stroke-linejoin: round;
     ```

---

## 4. Connector Geometry & Visual Contrast

| Hierarchy Segment | Geometry Type | Stroke Width | Stroke Color (Light) | Stroke Color (Dark) | Contrast vs Canvas |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Trunk (Root → Section)** | Smooth Cubic Bezier | `2.0px` | `var(--accent)` or `var(--branch-N)` | `var(--accent)` or `var(--branch-N)` | `≥ 4.5:1` |
| **Secondary (Section → Concept)**| Cubic Bezier or Orthogonal Elbow | `1.5px` | `var(--branch-N)` or `var(--border-strong)` | `var(--branch-N)` or `var(--border-strong)` | `≥ 3.2:1` |
| **Leaf (Concept → Detail)** | Smooth Curve or Step Link | `1.2px` | `var(--border-strong)` (`#9BB5D1`) | `var(--border-strong)` (`#41577D`) | `≥ 3.0:1` |

### Critical Invariant for Connectors
- In SVG (`react-d3-tree`), `.study-map__link` must maintain `fill: none` unconditionally to prevent SVG path triangulation blackouts:
  ```css
  .study-map__link {
    fill: none !important;
    stroke: var(--border-strong);
    stroke-width: 1.5px;
    transition: stroke 150ms ease, stroke-width 150ms ease;
  }
  ```

---

## 5. Interaction State Machine

Both engines must visually reflect the same interaction states so user actions feel familiar regardless of whether the user is in `/app` or `/app/study/map/:id`.

```
                  ┌──────────────┐
                  │   DEFAULT    │
                  └──────┬───────┘
                         │ pointerenter / focus
                         ▼
                  ┌──────────────┐
       ┌──────────┤    HOVER     ├──────────┐
       │          └──────┬───────┘          │
       │ click           │                  │ (unfocused node)
       ▼                 │                  ▼
┌──────────────┐         │          ┌──────────────┐
│   SELECTED   │         │          │    DIMMED    │ (opacity: 0.22)
│ (Accent Ring)│         │          └──────────────┘
└──────┬───────┘         │
       │ search query    │ search match
       ▼                 ▼
┌─────────────────────────────────┐
│     SEARCH MATCH (Active)       │
│  (Accent ring + dashed border)  │
└─────────────────────────────────┘
```

### State Specifications

1. **Default State**:
   - Clean, full opacity (`1.0`).
   - Fill and stroke match table in §2.
2. **Hover State**:
   - Cursor: `pointer`.
   - Node fill: subtly tinted to `var(--bg-hover)`.
   - Connector stroke: elevates by `+0.5px` with smooth 150ms easing.
3. **Selected State (The Seam Fix)**:
   - Active node receives a prominent Learning Blue outline:
     ```css
     outline: 2px solid var(--accent);
     outline-offset: 2px;
     box-shadow: 0 0 0 3px var(--accent-subtle);
     ```
   - In SVG (`StudyMapView`): `<circle>` stroke switches to `var(--accent)`, `strokeWidth: 3px`, with a dedicated outer aura ring `<circle r={m.r + 4} stroke="var(--accent-subtle)" strokeWidth="3" fill="none" />`.
   - **DEPRECATED**: Dark forest green (`var(--forest)` / `#1F4033`) is completely removed from selection states.
4. **Focused / Lineage State**:
   - When a node is selected/focused, all ancestors up to Root and all direct descendants maintain full opacity (`1.0`).
   - All unrelated sibling subtrees drop to `opacity: 0.22`.
   - Connectors along the active lineage adopt `var(--accent)` with `stroke-width: 2px`.
5. **Collapsed State**:
   - Nodes with collapsed children MUST signal hidden content:
     - MindElixir: Decorated caretaker `<me-epd>` with child count badge and right-pointing chevron.
     - StudyMapView: Inner filled concentric dot `<circle r={Math.max(2, m.r - 3)} fill="var(--accent)" opacity="0.8" />` plus child count text.
6. **Search Matching**:
   - Matching nodes: Outer dashed accent ring `<circle r={m.r + 3} stroke="var(--accent)" strokeDasharray="2 2" strokeWidth="1.2" />`.
   - Active selected match: Solid `strokeWidth: 3.5px` in `var(--accent)`.
7. **Spark Root (Empty/First Load State)**:
   - When no node is selected on a freshly mounted map, the Root node displays an inviting pulse ring:
     ```jsx
     <circle r={m.r + 5} fill="none" stroke="var(--accent)" strokeWidth={1.5}
             opacity={0.55} className="motion-safe:animate-pulse" />
     ```
   - Dismissed immediately upon the user's first click anywhere on the canvas.

---

## 6. Canvas Background & Environmental Texture

To eliminate the disjointed feel where MindElixir is an expansive interactive canvas while StudyMapView is an isolated white box:

- **Canvas Surface**: Both viewports adopt `var(--bg-base)`.
- **Dot Lattice Pattern**:
  ```css
  .shared-map-canvas {
    background-color: var(--bg-base);
    background-image: radial-gradient(circle, var(--border-color) 1px, transparent 1px);
    background-size: 24px 24px;
    background-position: 0 0;
  }
  ```
- **Light/Dark Auto-Inversion**: In dark mode (`html.dark`), `var(--border-color)` shifts from `#D2DFED` to `#2D3E5D`, automatically dimming the lattice dots to preserve comfortable ambient contrast.

---

## 7. Mobile Viewport Adaptations (< 640px)

Small touchscreens (e.g. iPhone 390x844) require distinct geometric compromises to prevent unreadable micro-text or severe viewport occlusion:

1. **Legibility Scale Floor**:
   - MindElixir: `MOBILE_READABLE_MIN_SCALE = 0.75` floor enforced via `applyReadableFloor`.
   - StudyMapView: Responsive scale floor:
     ```javascript
     if (width < 500) {
       setZoom(Math.max(0.65, (width / 500) * 0.8));
     }
     ```
   - Text must never render below an effective rendered size of `11px`.
2. **Initial Collapse Depth**:
   - Both maps default to `initialDepth = 1` on screens `< 768px`. Only Root and Level 1 Sections are rendered initially.
3. **Touch Targets**:
   - Node hit targets on mobile must have a minimum interactive bounding box of `44px × 44px`. In SVG, wrap the node in a transparent `<circle r="22" fill="transparent" />` to capture coarse finger taps reliably.
